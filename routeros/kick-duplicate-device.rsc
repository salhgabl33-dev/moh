# Manual repair only. Do NOT put this in On Login or a Scheduler.
# admin-reset can delete MAC cookies, so this is not a roaming mechanism.
# Set the authenticated phone's IP and HotSpot server to retain before running.
:local keepIP "CHANGE-ME";
:local keepServer "CHANGE-ME";
:do {
    :if (([:typeof [:toip $keepIP]] != "ip") || ($keepServer = "CHANGE-ME")) do={ :error "HN27: choose the current phone IP and server first"; };
    :local keep [/ip hotspot active find where address=$keepIP and server=$keepServer];
    :if ([:len $keep] != 1) do={ :error "HN27: selected retained session is missing or ambiguous"; };
    :local keepID [:pick $keep 0];
    :local card [/ip hotspot active get $keepID user];
    :local mac [/ip hotspot active get $keepID mac-address];
    :local removed 0;
    :foreach oldID in=[/ip hotspot active find where user=$card and mac-address=$mac] do={
        :if ($oldID != $keepID) do={
            :local current [/ip hotspot active find where address=$keepIP and server=$keepServer and user=$card and mac-address=$mac];
            :if ([:len $current] != 1) do={ :error "HN27: current session changed; stopped"; };
            :if ([:pick $current 0] != $keepID) do={ :error "HN27: retained session ID changed; stopped"; };
            :if (([/ip hotspot active get $oldID user] = $card) && ([/ip hotspot active get $oldID mac-address] = $mac)) do={
                /ip hotspot active remove $oldID;
                :set removed ($removed + 1);
            };
        };
    };
    :put ("HN27: duplicate sessions removed=" . $removed . ". Native cookies may require a fresh successful login after this manual admin-reset.");
} on-error={ :error "HN27: duplicate cleanup not completed; no wider session selector was used"; };
