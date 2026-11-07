# Paste into HotSpot User Profile > Scripts > On Login.
# Event script: do not /import this file from Terminal.
# Requires unique IPv4 client addresses and visible active-session domain data.
:do {
    :local clientIP [:tostr $address];
    :local clientUser [:tostr $user];
    :local clientMAC [:tostr $"mac-address"];
    :local defaultRate "2M/4M";
    :local blockList "*yes**";
    :local moveToTop false;

    :if (([:typeof [:toip $clientIP]] != "ip") || ($clientUser = "") || ($clientMAC = "")) do={
        :log error "HN27: missing or invalid HotSpot event variables";
        :error "HN27: invalid event";
    };

    :local sessions [/ip hotspot active find where address=$clientIP];
    :if ([:len $sessions] != 1) do={
        :log error ("HN27: expected one active client at " . $clientIP);
        :error "HN27: missing or ambiguous active client";
    };
    :local activeID [:pick $sessions 0];
    :if (([/ip hotspot active get $activeID user] != $clientUser) || ([:tostr [/ip hotspot active get $activeID mac-address]] != $clientMAC)) do={
        :log error ("HN27: active client changed at " . $clientIP);
        :error "HN27: event does not match active client";
    };

    :local rawDomain "";
    :do {
        :set rawDomain [:tostr [/ip hotspot active get $activeID domain]];
    } on-error={
        :set rawDomain "";
    };
    :local rate $rawDomain;
    :local updateFlag "*no**";
    :local separator [:find $rawDomain "|"];
    :if ([:typeof $separator] != "nil") do={
        :set rate [:pick $rawDomain 0 $separator];
        :set updateFlag [:pick $rawDomain ($separator + 1) [:len $rawDomain]];
    };

    :local allowed false;
    :foreach candidate in={"1M/2M";"2M/4M";"3M/6M";"4M/8M";"8M/16M"} do={
        :if ($rate = $candidate) do={ :set allowed true; };
    };
    :if ($allowed = false) do={
        :set rate $defaultRate;
        :log warning ("HN27: missing/unsupported domain at " . $clientIP . "; using " . $defaultRate);
    };

    :local queueName ("HN27-" . $clientIP);
    :local ownerPrefix ("HN27:" . $clientIP . "|");
    :local ownerMarker ($ownerPrefix . $clientMAC . "|" . $clientUser);
    :local ownedQueues [/queue simple find where name=$queueName];
    :if ([:len $ownedQueues] > 1) do={ :error "HN27: ambiguous reserved queue name"; };
    :foreach queueID in=$ownedQueues do={
        :local oldComment [/queue simple get $queueID comment];
        :if (([:pick $oldComment 0 [:len $ownerPrefix]] != $ownerPrefix) || ([/queue simple get $queueID dynamic] = true)) do={
            :log error ("HN27: reserved queue name belongs to another policy: " . $queueName);
            :error "HN27: queue ownership conflict";
        };
    };

    :if ([:len $ownedQueues] = 0) do={
        /queue simple add name=$queueName comment=$ownerMarker target=($clientIP . "/32") parent=none limit-at=0/0 max-limit=$rate queue=default-small/default-small priority=8/8 disabled=no;
    } else={
        /queue simple set [:pick $ownedQueues 0] comment=$ownerMarker target=($clientIP . "/32") parent=none limit-at=0/0 max-limit=$rate queue=default-small/default-small priority=8/8 burst-limit=0/0 burst-threshold=0/0 disabled=no;
    };

    :if ($moveToTop = true) do={
        :local queueID [:pick [/queue simple find where name=$queueName and comment=$ownerMarker] 0];
        :local ordered [/queue simple find];
        :if (([:len $ordered] > 0) && ([:pick $ordered 0] != $queueID)) do={
            /queue simple move $queueID destination=[:pick $ordered 0];
        };
    };

    :local retained false;
    :foreach entryID in=[/ip firewall address-list find where list=$blockList and address=$clientIP] do={
        :local entryComment [/ip firewall address-list get $entryID comment];
        :if ([:pick $entryComment 0 [:len $ownerPrefix]] = $ownerPrefix) do={
            :if (($updateFlag = "*yes**") && ($retained = false)) do={
                /ip firewall address-list set $entryID comment=$ownerMarker;
                :set retained true;
            } else={
                /ip firewall address-list remove $entryID;
            };
        };
    };
    :if (($updateFlag = "*yes**") && ($retained = false)) do={
        /ip firewall address-list add list=$blockList address=$clientIP comment=$ownerMarker;
    };
    :log info ("HN27: queue ready for " . $clientIP . " at " . $rate);
} on-error={
    :log error ("HN27: On Login failed for " . [:tostr $address] . "; inspect event variables, active client and reserved queue");
};
