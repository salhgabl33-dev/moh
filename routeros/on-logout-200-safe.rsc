# Optional replacement for profile 200 On Logout only.
# Keeps that profile's legacy user:IP queue and dis_update contract.
:do {
    :local clientIP [:tostr $address];
    :local clientUser [:tostr $user];
    :if (([:typeof [:toip $clientIP]] != "ip") || ($clientUser = "")) do={
        :error "HN27: invalid profile-200 logout event";
    };
    :local legacyName ($clientUser . ":" . $clientIP);
    :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
        :foreach queueID in=[/queue simple find where name=$legacyName and comment="SPEED"] do={
            :local target [:tostr [/queue simple get $queueID target]];
            :if ((($target = $clientIP) || ($target = ($clientIP . "/32"))) && ([/queue simple get $queueID dynamic] = false)) do={
                :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
                    /queue simple remove $queueID;
                };
            };
        };
        :foreach entryID in=[/ip firewall address-list find where list="dis_update" and address=$clientIP and comment=$clientUser] do={
            :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
                /ip firewall address-list remove $entryID;
            };
        };
    };
} on-error={
    :log warning ("HN27: profile-200 cleanup failed for " . [:tostr $address]);
};
