# HN27_ROAMING_VERSION=2027.3
# One common On Login for hashedSpeed, default and UM10USER.
# Keeps normal roaming free from admin-reset / automatic session eviction.
:do {
    :local clientIP [:tostr $address];
    :local clientUser [:tostr $user];
    :local clientMAC [:tostr $"mac-address"];
    :local defaultRate "2M/4M";
    :local allowedRates {"1M/3M";"2M/4M";"2M/6M";"5M/10M";"10M/20M"};
    :local blockList "*yes**";
    :local preferenceList "HN27-PREFS";
    :local preferenceLifetime 30d;
    :local maxSavedChoices 10000;
    :local moveToTop false;
    :local adoptLegacyQueues true;
    :local migrateLegacyUpdateEntries false;
    :local queueKind "default-small/default-small";

    :if (([:typeof [:toip $clientIP]] != "ip") || ($clientUser = "") || ([:len $clientMAC] != 17) || !($clientMAC~"^[0-9A-Fa-f:]+$")) do={
        :error "HN27: invalid HotSpot event identity";
    };
    :if ([:len [/queue type find where name="SPEED"]] = 1) do={
        :set queueKind "SPEED/SPEED";
    };
    :local sessions [/ip hotspot active find where address=$clientIP];
    :if ([:len $sessions] != 1) do={ :error "HN27: missing or ambiguous active client"; };
    :local activeID [:pick $sessions 0];
    :if (([/ip hotspot active get $activeID user] != $clientUser) || ([:tostr [/ip hotspot active get $activeID mac-address]] != $clientMAC)) do={
        :error "HN27: active client does not match event";
    };

    :local preferenceKey ("HN27P:" . $clientMAC . ":" . [:convert $clientUser from=raw to=hex] . ":");
    :local preferenceIDs [/ip firewall address-list find where list=$preferenceList and comment~("^" . $preferenceKey)];
    :local rawDomain "";
    :do { :set rawDomain [:tostr [/ip hotspot active get $activeID domain]]; } on-error={ :set rawDomain ""; };
    :local rate $defaultRate;
    :local updateFlag "*no**";
    :local validChoice false;
    :local separator [:find $rawDomain "|"];
    :if ([:typeof $separator] != "nil") do={
        :local requestedRate [:pick $rawDomain 0 $separator];
        :local requestedFlag [:pick $rawDomain ($separator + 1) [:len $rawDomain]];
        :foreach candidate in=$allowedRates do={
            :if ($requestedRate = $candidate) do={ :set rate $candidate; :set validChoice true; };
        };
        :if (($validChoice = true) && (($requestedFlag = "*yes**") || ($requestedFlag = "*no**"))) do={ :set updateFlag $requestedFlag; };
    };
    :if ($validChoice = false) do={
        :foreach preferenceID in=$preferenceIDs do={
            :local memo [/ip firewall address-list get $preferenceID comment];
            :if (($validChoice = false) && ([:pick $memo 0 [:len $preferenceKey]] = $preferenceKey)) do={
                :local choice [:pick $memo [:len $preferenceKey] [:len $memo]];
                :local cut [:find $choice "|"];
                :if ([:typeof $cut] != "nil") do={
                    :local rememberedRate [:pick $choice 0 $cut];
                    :local rememberedFlag [:pick $choice ($cut + 1) [:len $choice]];
                    :foreach candidate in=$allowedRates do={
                        :if (($rememberedRate = $candidate) && (($rememberedFlag = "*yes**") || ($rememberedFlag = "*no**"))) do={
                            :set rate $candidate; :set updateFlag $rememberedFlag; :set validChoice true;
                        };
                    };
                };
            };
        };
    };
    :if ($validChoice = false) do={ :log warning ("HN27: no valid domain or remembered choice at " . $clientIP . "; using " . $defaultRate); };

    :local queueName ("HN27-" . $clientIP);
    :local ownerPrefix ("HN27:" . $clientIP . "|");
    :local ownerMarker ($ownerPrefix . $clientMAC . "|" . $clientUser);
    :local ownedQueues [/queue simple find where name=$queueName];
    :if ([:len $ownedQueues] > 1) do={ :error "HN27: duplicate reserved queue"; };
    :foreach queueID in=$ownedQueues do={
        :local oldComment [/queue simple get $queueID comment];
        :if (([:pick $oldComment 0 [:len $ownerPrefix]] != $ownerPrefix) || ([/queue simple get $queueID dynamic] = true)) do={ :error "HN27: reserved queue ownership conflict"; };
    };

    :local legacyQueues [/queue simple find where name=$clientIP];
    :if ([:len $legacyQueues] > 0) do={
        :if (([:len $legacyQueues] != 1) || ([:len $ownedQueues] != 0) || ($adoptLegacyQueues = false)) do={ :error "HN27: overlapping legacy queue; review this client"; };
        :local legacyID [:pick $legacyQueues 0];
        :local legacyComment [/queue simple get $legacyID comment];
        :local legacyTarget [:tostr [/queue simple get $legacyID target]];
        :local legacyKind [:tostr [/queue simple get $legacyID queue]];
        :local legacyMarks [/queue simple get $legacyID packet-marks];
        :if ((($legacyComment != "Cards") && ($legacyComment != "10-USERS") && ($legacyComment != "HALA-HS-SPEED")) || (($legacyTarget != $clientIP) && ($legacyTarget != ($clientIP . "/32"))) || (($legacyKind != "SPEED/SPEED") && ($legacyKind != "sfq/sfq")) || ([:tostr [/queue simple get $legacyID parent]] != "none") || ([:len $legacyMarks] != 0) || ([/queue simple get $legacyID dynamic] = true)) do={
            :error "HN27: protected legacy queue";
        };
        /queue simple set $legacyID name=$queueName comment=$ownerMarker;
        :set ownedQueues [/queue simple find where name=$queueName and comment=$ownerMarker];
    };
    :if ([:len $ownedQueues] = 0) do={
        /queue simple add name=$queueName comment=$ownerMarker target=($clientIP . "/32") parent=none limit-at=0/0 max-limit=$rate queue=$queueKind priority=8/8 disabled=no;
    } else={
        /queue simple set [:pick $ownedQueues 0] comment=$ownerMarker target=($clientIP . "/32") parent=none limit-at=0/0 max-limit=$rate queue=$queueKind priority=8/8 burst-limit=0/0 burst-threshold=0/0 disabled=no;
    };
    :if ($moveToTop = true) do={
        :local queueID [:pick [/queue simple find where name=$queueName and comment=$ownerMarker] 0];
        :local ordered [/queue simple find];
        :if (([:len $ordered] > 0) && ([:pick $ordered 0] != $queueID)) do={ /queue simple move $queueID destination=[:pick $ordered 0]; };
    };

    :local retained false;
    :foreach entryID in=[/ip firewall address-list find where list=$blockList and address=$clientIP] do={
        :local entryComment [/ip firewall address-list get $entryID comment];
        :if ((($entryComment = "HALA-HS-UPDATES") || (($migrateLegacyUpdateEntries = true) && ($entryComment = ""))) && ([/ip firewall address-list get $entryID dynamic] = false)) do={
            /ip firewall address-list set $entryID comment=$ownerMarker;
            :set entryComment $ownerMarker;
        };
        :if ([:pick $entryComment 0 [:len $ownerPrefix]] = $ownerPrefix) do={
            :if (($updateFlag = "*yes**") && ($retained = false)) do={
                /ip firewall address-list set $entryID comment=$ownerMarker; :set retained true;
            } else={ /ip firewall address-list remove $entryID; };
        } else={ :log warning ("HN27: older unowned update-list entry retained at " . $clientIP); };
    };
    :if (($updateFlag = "*yes**") && ($retained = false)) do={ /ip firewall address-list add list=$blockList address=$clientIP comment=$ownerMarker; };

    # Reconnect preference memory only: no password, authorization or quota bypass.
    # Timeout entries are RAM state and disappear on router reboot.
    :foreach preferenceID in=$preferenceIDs do={
        :local memo [/ip firewall address-list get $preferenceID comment];
        :if ([:pick $memo 0 [:len $preferenceKey]] = $preferenceKey) do={ /ip firewall address-list remove $preferenceID; };
    };
    :if (([:len $preferenceKey] < 220) && ([:len [/ip firewall address-list find where list=$preferenceList]] < $maxSavedChoices)) do={
        /ip firewall address-list add list=$preferenceList address=$clientIP comment=($preferenceKey . $rate . "|" . $updateFlag) timeout=$preferenceLifetime;
    };
    :log info ("HN27: roaming-safe login ip=" . $clientIP . " speed=" . $rate);
} on-error={
    :log error ("HN27: On Login failed for " . [:tostr $address] . "; inspect current client, domain and queue ownership");
};
