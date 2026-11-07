# Optional System > Scripts body, name HN27-cleanup.
# Run after startup and/or every five minutes using a Scheduler entry.
# Removes only HN27 resources with no active client at the recorded IPv4 address.
:foreach queueID in=[/queue simple find where name~"^HN27-"] do={
    :do {
        :local queueName [/queue simple get $queueID name];
        :local clientIP [:pick $queueName 5 [:len $queueName]];
        :local ownerPrefix ("HN27:" . $clientIP . "|");
        :local entryComment [/queue simple get $queueID comment];
        :if (([:typeof [:toip $clientIP]] = "ip") && ([:pick $entryComment 0 [:len $ownerPrefix]] = $ownerPrefix)) do={
            :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
                /queue simple remove $queueID;
            };
        };
    } on-error={ :log warning "HN27: stale queue changed during cleanup"; };
};
:foreach entryID in=[/ip firewall address-list find where list="*yes**" and comment~"^HN27:"] do={
    :do {
        :local clientIP [:tostr [/ip firewall address-list get $entryID address]];
        :local ownerPrefix ("HN27:" . $clientIP . "|");
        :local entryComment [/ip firewall address-list get $entryID comment];
        :if (([:typeof [:toip $clientIP]] = "ip") && ([:pick $entryComment 0 [:len $ownerPrefix]] = $ownerPrefix)) do={
            :if ([:len [/ip hotspot active find where address=$clientIP]] = 0) do={
                /ip firewall address-list remove $entryID;
            };
        };
    } on-error={ :log warning "HN27: stale address entry changed during cleanup"; };
};
