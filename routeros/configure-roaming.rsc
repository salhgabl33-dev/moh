# Operator-run setup on CCR2116 / RouterOS 7.25.
# Upload the whole routeros folder first, then import this file.
# Backs up relevant profiles locally. Treat those backup exports as private.
:do {
    :local directory "routeros/";
    :local serverProfileName "hsprof1";
    :local versionMarker "HN27_ROAMING_VERSION=2027.3";
    :local serverProfiles [/ip hotspot profile find where name=$serverProfileName];
    :if ([:len $serverProfiles] != 1) do={ :error "HN27: expected RADIUS server profile hsprof1; run diagnosis first"; };
    :local serverProfile [:pick $serverProfiles 0];
    :if ([/ip hotspot profile get $serverProfile use-radius] != true) do={ :error "HN27: selected server profile is not RADIUS-enabled; stopped without changing it"; };
    :if ([/ip hotspot profile get $serverProfile radius-accounting] != true) do={ :error "HN27: RADIUS accounting must already be enabled; review the quota policy first"; };
    :local methods [:tostr [/ip hotspot profile get $serverProfile login-by]];
    :if (!(($methods~"(^|[,;])cookie([,;]|$)") && ($methods~"(^|[,;])mac-cookie([,;]|$)"))) do={ :error "HN27: native cookie methods not already enabled; review login policy first"; };

    :local logoutFiles [/file find where name=($directory . "on-logout.rsc")];
    :if ([:len $logoutFiles] != 1) do={ :error "HN27: upload routeros/on-logout.rsc before setup"; };
    :local logoutCode [/file get [:pick $logoutFiles 0] contents];
    :if ([:find $logoutCode $versionMarker] = nil) do={ :error "HN27: wrong logout version"; };
    :foreach profileName in={"hashedSpeed";"default"} do={
        :if ([:len [/ip hotspot user profile find where name=$profileName]] != 1) do={ :error ("HN27: required user profile missing: " . $profileName); };
    };
    :foreach profileName in={"hashedSpeed";"default";"UM10USER"} do={
        :if ([:len [/ip hotspot user profile find where name=$profileName]] = 1) do={
            :local files [/file find where name=($directory . "on-login-" . $profileName . ".rsc")];
            :if ([:len $files] != 1) do={ :error ("HN27: missing login file for " . $profileName); };
            :local code [/file get [:pick $files 0] contents];
            :if ([:find $code $versionMarker] = nil) do={ :error ("HN27: wrong login version for " . $profileName); };
        };
    };

    :if ([:len [/file find where name="HN27-user-profiles-before-roaming.rsc"]] = 0) do={
        /ip hotspot user profile export file="HN27-user-profiles-before-roaming";
    };
    :if ([:len [/file find where name="HN27-server-profiles-before-roaming.rsc"]] = 0) do={
        /ip hotspot profile export file="HN27-server-profiles-before-roaming";
    };
    :foreach profileName in={"hashedSpeed";"default";"UM10USER"} do={
        :local profiles [/ip hotspot user profile find where name=$profileName];
        :if ([:len $profiles] = 1) do={
            :local files [/file find where name=($directory . "on-login-" . $profileName . ".rsc")];
            :local code [/file get [:pick $files 0] contents];
            /ip hotspot user profile set [:pick $profiles 0] on-login=$code on-logout=$logoutCode add-mac-cookie=yes mac-cookie-timeout=30d idle-timeout=none session-timeout=0s;
        };
    };
    /ip hotspot profile set $serverProfile http-cookie-lifetime=30d;
    :log info "HN27: native-cookie settings applied to hsprof1 and roaming-safe events installed; quotas and topology retained";
    :put "HN27: setup complete for existing RADIUS service hsprof1. hsprof2, DHCP, VLANs and User Manager were not changed.";
} on-error={
    :log error "HN27: roaming setup stopped; inspect preflight/files. Earlier successful settings may need restoration from local profile exports.";
    :error "HN27: setup not confirmed";
};
