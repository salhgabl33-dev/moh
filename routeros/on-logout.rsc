# Paste into HotSpot User Profile > Scripts > On Logout.
# Only removes exact resources owned by this user/device event.
:do {
    :local clientIP [:tostr $address];
    :local clientUser [:tostr $user];
    :local clientMAC [:tostr $"mac-address"];
    :local blockList "*yes**";
    :if (([:typeof [:toip $clientIP]] != "ip") || ($clientUser = "") || ($clientMAC = "")) do={
        :error "HN27: invalid logout event";
    };
    :local queueName ("HN27-" . $clientIP);
    :local ownerMarker ("HN27:" . $clientIP . "|" . $clientMAC . "|" . $clientUser);

    :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
        :foreach queueID in=[/queue simple find where name=$queueName and comment=$ownerMarker] do={
            :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
                /queue simple remove $queueID;
            };
        };
        :foreach entryID in=[/ip firewall address-list find where list=$blockList and address=$clientIP and comment=$ownerMarker] do={
            :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
                /ip firewall address-list remove $entryID;
            };
        };
        :log info ("HN27: logout cleanup checked for " . $clientIP);
    } else={
        :log info ("HN27: kept resources for active client at " . $clientIP);
    };
} on-error={
    :log error ("HN27: On Logout cleanup failed for " . [:tostr $address] . "; periodic cleanup may be required");
};
