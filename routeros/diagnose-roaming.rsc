# Read-only diagnosis. Optionally set phoneIP to the phone's subscriber address.
# The printed results contain local client identifiers; inspect privately.
:local phoneIP "";
:put ("HN27: HotSpot server count=" . [:len [/ip hotspot find]]);
:foreach profileName in={"hsprof1";"hsprof2"} do={
    :local profiles [/ip hotspot profile find where name=$profileName];
    :if ([:len $profiles] = 1) do={
        :local id [:pick $profiles 0];
        :put ("HN27: profile=" . $profileName . " RADIUS=" . [/ip hotspot profile get $id use-radius] . " methods=" . [:tostr [/ip hotspot profile get $id login-by]] . " http-cookie=" . [:tostr [/ip hotspot profile get $id http-cookie-lifetime]]);
    };
};
:foreach profileName in={"hashedSpeed";"default";"UM10USER"} do={
    :local profiles [/ip hotspot user profile find where name=$profileName];
    :if ([:len $profiles] = 1) do={
        :local id [:pick $profiles 0];
        :put ("HN27: user-profile=" . $profileName . " add-mac-cookie=" . [/ip hotspot user profile get $id add-mac-cookie] . " mac-timeout=" . [:tostr [/ip hotspot user profile get $id mac-cookie-timeout]] . " shared=" . [:tostr [/ip hotspot user profile get $id shared-users]]);
    };
};
:if ($phoneIP = "") do={
    :put "HN27: set phoneIP in this read-only file to identify that phone's actual HotSpot server/interface.";
} else={
    :local sessions [/ip hotspot active find where address=$phoneIP];
    :if ([:len $sessions] = 1) do={
        :local id [:pick $sessions 0];
        :local mac [/ip hotspot active get $id mac-address];
        :local serverName [/ip hotspot active get $id server];
        :local servers [/ip hotspot find where name=$serverName];
        :put ("HN27: phone-server=" . $serverName . " interface=" . [/ip hotspot get [:pick $servers 0] interface] . " server-profile=" . [/ip hotspot get [:pick $servers 0] profile]);
        :put ("HN27: phone host entries=" . [:len [/ip hotspot host find where mac-address=$mac]] . " active entries=" . [:len [/ip hotspot active find where mac-address=$mac]] . " native cookies=" . [:len [/ip hotspot cookie find where mac-address=$mac]]);
    } else={ :put "HN27: phone has no unique active session; no scope inferred."; };
};
