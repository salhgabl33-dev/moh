'use strict';

// Static review guards only: this does not interpret or execute RouterOS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, 'routeros', name), 'utf8');
const login = read('on-login.rsc');
const logout = read('on-logout.rsc');
const cleanup = read('cleanup-stale.rsc');
const hashedLogin = read('on-login-hashedSpeed.rsc');
const defaultLogin = read('on-login-default.rsc');
const multiLogin = read('on-login-UM10USER.rsc');
const legacyLogout = read('on-logout-200-safe.rsc');
const configure = read('configure-roaming.rsc');
const diagnose = read('diagnose-roaming.rsc');
const manualKick = read('kick-duplicate-device.rsc');
const scripts = { login, logout, cleanup, hashedLogin, defaultLogin, multiLogin, legacyLogout, configure, diagnose, manualKick, verify: read('verify-readonly.rsc') };

// Remove comments without treating a # inside a RouterOS string as a comment.
const executable = (code) => {
  let result = '';
  let quoted = false;
  let comment = false;
  let escaped = false;
  for (const character of code) {
    if (comment) {
      if (character === '\n') { comment = false; result += character; }
      continue;
    }
    if (!quoted && character === '#') { comment = true; continue; }
    result += character;
    if (escaped) { escaped = false; continue; }
    if (quoted && character === '\\') { escaped = true; continue; }
    if (character === '"') quoted = !quoted;
  }
  return result;
};

test('RouterOS sources have balanced strings and command/block delimiters', () => {
  for (const [name, code] of Object.entries(scripts)) {
    const stack = [];
    let quoted = false;
    let comment = false;
    let escaped = false;
    for (const character of code) {
      if (comment) { if (character === '\n') comment = false; continue; }
      if (escaped) { escaped = false; continue; }
      if (quoted && character === '\\') { escaped = true; continue; }
      if (character === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (character === '#') { comment = true; continue; }
      if ('([{'.includes(character)) stack.push(character);
      if (')]}'.includes(character)) assert.equal(stack.pop(), { ')': '(', ']': '[', '}': '{' }[character], name);
    }
    assert.equal(quoted, false, name + ': unterminated string');
    assert.deepEqual(stack, [], name + ': unmatched delimiter');
  }
});

test('the router rate whitelist exactly matches the five real portal configuration values', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'hotspot/assets/js/network-config-2027.js'), 'utf8'), { window });
  const array = /:local allowedRates \{([^}]+)\}/.exec(login);
  assert.ok(array);
  const rates = [...array[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rates, ['1M/3M', '2M/4M', '2M/6M', '5M/10M', '10M/20M']);
  assert.deepEqual(rates, Array.from(window.siteConfig.speedOptions, (speed) => speed.value));
  assert.equal(rates.includes('0/0'), false);
  assert.match(login, /:local defaultRate "2M\/4M"/);
  assert.equal(window.siteConfig.speedOptions.find((speed) => speed.default).value, '2M/4M');
});

test('login requires event identity and checks the unique active client before applying a rate', () => {
  for (const variable of ['$address', '$user', '$"mac-address"']) assert.ok(login.includes(variable));
  assert.match(login, /\[:len \$sessions\] != 1/);
  assert.match(login, /get \$activeID user\] != \$clientUser/);
  assert.match(login, /get \$activeID mac-address\]\] != \$clientMAC/);
  assert.match(login, /:local rate \$defaultRate/);
  assert.match(login, /limit-at=0\/0 max-limit=\$rate/);
});

test('hashedSpeed, default and UM10USER all use the same roaming-safe login body', () => {
  assert.match(login, /^# HN27_ROAMING_VERSION=2027\.3$/m);
  for (const code of [hashedLogin, defaultLogin, multiLogin]) {
    assert.equal(code.replace(/^# For[^\n]*\n/, ''), login);
  }
});

test('normal login, logout and cleanup never evict clients or change native authentication state', () => {
  for (const code of [login, logout, cleanup, legacyLogout]) {
    const source = executable(code);
    assert.doesNotMatch(source, /\/ip hotspot active (?:remove|login)\b/);
    assert.doesNotMatch(source, /\/ip hotspot cookie (?:remove|add|set)\b/);
    assert.doesNotMatch(source, /\/ip hotspot ip-binding (?:add|set)\b/);
    assert.doesNotMatch(source, /\/ip hotspot user (?:add|set)\b/);
    assert.doesNotMatch(source, /singleSessionPerUser|admin-reset/);
  }
});

test('native reconnection preferences are keyed to the authenticated user and device', () => {
  assert.match(login, /:local preferenceList "HN27-PREFS"/);
  assert.match(login, /:local preferenceKey \("HN27P:" \. \$clientMAC \. ":" \. \[:convert \$clientUser from=raw to=hex\] \. ":"\)/);
  assert.match(login, /find where list=\$preferenceList and comment~\("\^" \. \$preferenceKey\)/);
  assert.ok(login.indexOf('active client does not match event') < login.indexOf(':local preferenceKey'));
  assert.ok(login.indexOf(':local preferenceKey') < login.indexOf(':local preferenceIDs'));
  assert.match(login, /\[:pick \$memo 0 \[:len \$preferenceKey\]\] = \$preferenceKey/);
  assert.match(login, /:if \(\$validChoice = false\) do=\{\s*:foreach preferenceID in=\$preferenceIDs/);
  assert.match(login, /:foreach candidate in=\$allowedRates do=\{\s*:if \(\(\$rememberedRate = \$candidate\) && \(\(\$rememberedFlag = "\*yes\*\*"\) \|\| \(\$rememberedFlag = "\*no\*\*"\)\)\)/);
});

test('saved choices have bounded expiring memory and cannot authorize a client', () => {
  assert.match(login, /:local preferenceLifetime 30d/);
  assert.match(login, /:local maxSavedChoices 10000/);
  assert.match(login, /\[:len \$preferenceKey\] < 220/);
  assert.match(login, /\[:len \[\/ip firewall address-list find where list=\$preferenceList\]\] < \$maxSavedChoices/);
  assert.match(login, /address-list add list=\$preferenceList address=\$clientIP comment=\(\$preferenceKey \. \$rate \. "\|" \. \$updateFlag\) timeout=\$preferenceLifetime/);
  assert.match(login, /:foreach preferenceID in=\$preferenceIDs do=\{\s*:local memo \[\/ip firewall address-list get \$preferenceID comment\];\s*:if \(\[:pick \$memo 0 \[:len \$preferenceKey\]\] = \$preferenceKey\) do=\{ \/ip firewall address-list remove \$preferenceID;/);
  for (const code of [login, logout, cleanup]) {
    assert.doesNotMatch(executable(code), /password|\/system scheduler|\/ip hotspot ip-binding|\/ip hotspot active login/);
  }
  for (const code of [logout, cleanup]) assert.doesNotMatch(executable(code), /HN27-PREFS|preferenceID|preferenceList/);
});

test('logout deletion queries require queue ownership and the precise user/device marker', () => {
  assert.match(logout, /ownerMarker \("HN27:" \. \$clientIP \. "\|" \. \$clientMAC \. "\|" \. \$clientUser\)/);
  assert.match(logout, /queue simple find where name=\$queueName and comment=\$ownerMarker/);
  assert.match(logout, /address-list find where list=\$blockList and address=\$clientIP and comment=\$ownerMarker/);
  assert.equal((logout.match(/hotspot active find where address=\$clientIP/g) || []).length, 3);
});

test('event script mutations stay inside owned queues and address lists', () => {
  for (const code of [login, logout, cleanup, legacyLogout]) {
    assert.doesNotMatch(code, /\/ip firewall (?:filter|nat|mangle)\b/);
    assert.doesNotMatch(code, /\/tool user-manager|\/user-manager|reset-counters|remove \[find\]/);
    for (const [command] of executable(code).matchAll(/\/[a-z][^;\n]*?\bremove\b[^;\n]*;/g)) {
      assert.match(command, /^\/(?:queue simple|ip firewall address-list) remove \$(?:queueID|entryID|preferenceID);$/);
    }
  }
  assert.match(login, /:local blockList "\*yes\*\*"/);
  assert.match(login, /:local moveToTop false/);
  assert.match(login, /:if \(\$moveToTop = true\)/);
  assert.doesNotMatch(executable(login), /\/ip hotspot active remove/);
});

test('periodic cleanup identifies its namespace and checks for active clients before deletion', () => {
  assert.match(cleanup, /name~"\^HN27-"/);
  assert.match(cleanup, /\[:pick \$queueName 5 \[:len \$queueName\]\]/);
  assert.equal((cleanup.match(/\[:pick \$entryComment 0 \[:len \$ownerPrefix\]\] = \$ownerPrefix/g) || []).length, 2);
  assert.equal((cleanup.match(/hotspot active find where address=\$clientIP/g) || []).length, 2);
});

test('the verification commands are read-only and the guide identifies the user hardware and limits', () => {
  const commands = scripts.verify.split('\n').filter((line) => line.startsWith('/'));
  assert.equal(commands.length, 4);
  for (const command of commands) assert.match(command, /\bprint\b/);
  const guide = read('README-AR.md');
  for (const word of ['CCR2116', 'RB1100x4', 'RouterOS 7', 'RouterOS 6', 'RADIUS', 'FastTrack', 'Mikrotik-Rate-Limit']) assert.ok(guide.includes(word), word);
  assert.ok(guide.includes('لم تُنفّذ على راوتر فعلي'));
});

test('legacy queue migration requires an exact IP, recognized ownership and a simple static queue', () => {
  assert.match(login, /queue type find where name="SPEED"/);
  assert.match(login, /:set queueKind "SPEED\/SPEED"/);
  assert.match(login, /:local migrateLegacyUpdateEntries false/);
  assert.match(login, /\$legacyComment != "Cards"/);
  assert.match(login, /\$legacyComment != "10-USERS"/);
  assert.match(login, /\$legacyComment != "HALA-HS-SPEED"/);
  assert.match(login, /\$legacyTarget != \$clientIP/);
  assert.match(login, /\$legacyTarget != \(\$clientIP \. "\/32"\)/);
  assert.match(login, /\$legacyKind != "SPEED\/SPEED"/);
  assert.match(login, /\$legacyKind != "sfq\/sfq"/);
  assert.match(login, /get \$legacyID parent\]\] != "none"/);
  assert.match(login, /\[:len \$legacyMarks\] != 0/);
  assert.match(login, /get \$legacyID dynamic\] = true/);
  assert.match(login, /\[:len \$legacyQueues\] != 1/);
  assert.match(login, /\[:len \$ownedQueues\] != 0/);
  assert.match(login, /queue simple set \$legacyID name=\$queueName comment=\$ownerMarker/);
  assert.match(login, /\$entryComment = "HALA-HS-UPDATES"/);
});

test('the separate profile-200 cleanup keeps its existing queue and update-list contract', () => {
  assert.match(legacyLogout, /name=\$legacyName and comment="SPEED"/);
  assert.match(legacyLogout, /list="dis_update" and address=\$clientIP and comment=\$clientUser/);
});

test('roaming configuration requires the existing RADIUS service and native cookie methods', () => {
  const source = executable(configure);
  assert.match(source, /:local serverProfileName "hsprof1"/);
  assert.match(source, /hotspot profile find where name=\$serverProfileName/);
  assert.match(source, /\[:len \$serverProfiles\] != 1/);
  assert.match(source, /hotspot profile get \$serverProfile use-radius\] != true/);
  assert.match(source, /hotspot profile get \$serverProfile radius-accounting\] != true/);
  assert.ok(source.indexOf('use-radius] != true') < source.indexOf('/ip hotspot user profile set'));
  assert.match(source, /cookie\(\[,;\]\|\$\)/);
  assert.match(source, /mac-cookie\(\[,;\]\|\$\)/);
  assert.match(source, /\/ip hotspot profile set \$serverProfile http-cookie-lifetime=30d;/);
  assert.doesNotMatch(source, /login-by\s*=|use-radius\s*=/);
  assert.doesNotMatch(source, /\/ip hotspot profile set[^;\n]*hsprof2/);
});

test('profile migration validates versioned source files and backs up profiles before changes', () => {
  const source = executable(configure);
  assert.match(source, /:local directory "routeros\/"/);
  assert.match(source, /:local versionMarker "HN27_ROAMING_VERSION=2027\.3"/);
  assert.match(source, /file find where name=\(\$directory \. "on-logout\.rsc"\)/);
  assert.match(source, /\[:find \$logoutCode \$versionMarker\] = nil/);
  assert.match(logout, /HN27_ROAMING_VERSION=2027\.3/);
  assert.match(source, /file find where name=\(\$directory \. "on-login-" \. \$profileName \. "\.rsc"\)/);
  assert.match(source, /\[:find \$code \$versionMarker\] = nil/);
  assert.match(source, /profileName in=\{"hashedSpeed";"default";"UM10USER"\}/);
  assert.match(source, /on-login=\$code on-logout=\$logoutCode add-mac-cookie=yes mac-cookie-timeout=30d idle-timeout=none session-timeout=0s/);
  const firstWrite = source.indexOf('/ip hotspot user profile set');
  for (const command of [
    '/ip hotspot user profile export file="HN27-user-profiles-before-roaming"',
    '/ip hotspot profile export file="HN27-server-profiles-before-roaming"'
  ]) {
    assert.ok(source.includes(command), command);
    assert.ok(source.indexOf(command) < firstWrite, command + ': backup must precede changes');
  }
  assert.ok(source.indexOf('wrong login version') < source.indexOf('/ip hotspot user profile export'));
  assert.doesNotMatch(source, /show-sensitive|\/ip hotspot active remove|kick-duplicate-device|\/import\b/);
});

test('the configuration helper retains quota, shared-user and network policy', () => {
  const source = executable(configure);
  assert.doesNotMatch(source, /shared-users\s*=|keepalive-timeout\s*=|rate-limit\s*=|limit-bytes|reset-counters/);
  assert.doesNotMatch(source, /Mikrotik-(?:Group|Rate-Limit)|\/radius\b|\/user-manager\b|\/tool user-manager\b/);
  assert.doesNotMatch(source, /\/ip (?:address|pool|dhcp-server|firewall)|\/interface (?:bridge|vlan)/);
  const writes = [...source.matchAll(/\/(?:ip|interface|system|tool|file|radius|user-manager) [^;\n]*?\b(?:set|add|remove|move|enable|disable)\b[^;\n]*;/g)].map(([command]) => command);
  assert.equal(writes.length, 2);
  assert.match(writes[0], /^\/ip hotspot user profile set \[:pick \$profiles 0\]/);
  assert.match(writes[1], /^\/ip hotspot profile set \$serverProfile /);
});

test('roaming diagnosis reads actual phone scope without changing the router', () => {
  const source = executable(diagnose);
  assert.match(source, /:local phoneIP ""/);
  assert.match(source, /hotspot active find where address=\$phoneIP/);
  assert.match(source, /\[:len \$sessions\] = 1/);
  assert.match(source, /hotspot active get \$id server/);
  assert.match(source, /hotspot find where name=\$serverName/);
  assert.match(source, /hotspot get \[:pick \$servers 0\] interface/);
  assert.match(source, /hotspot get \[:pick \$servers 0\] profile/);
  const commands = source.replace(/"(?:\\.|[^"\\])*"/g, '""');
  assert.doesNotMatch(commands, /\/[a-z][a-z-]*(?:[ \t]+[a-z][a-z-]*)*[ \t]+(?:set|add|remove|export|move|enable|disable|reset-counters)(?=[ \t;\]\r\n])/);
});

test('manual duplicate repair retains the chosen phone and never targets an entire card alone', () => {
  const source = executable(manualKick);
  assert.match(source, /:local keepIP "CHANGE-ME"/);
  assert.match(source, /:local keepServer "CHANGE-ME"/);
  assert.match(source, /\[:typeof \[:toip \$keepIP\]\] != "ip"/);
  assert.match(source, /\$keepServer = "CHANGE-ME"/);
  assert.match(source, /find where address=\$keepIP and server=\$keepServer/);
  assert.match(source, /\[:len \$keep\] != 1/);
  assert.match(source, /:local card \[\/ip hotspot active get \$keepID user\]/);
  assert.match(source, /:local mac \[\/ip hotspot active get \$keepID mac-address\]/);
  assert.match(source, /:foreach oldID in=\[\/ip hotspot active find where user=\$card and mac-address=\$mac\]/);
  assert.match(source, /:if \(\$oldID != \$keepID\)/);
  const stillCurrent = 'find where address=$keepIP and server=$keepServer and user=$card and mac-address=$mac';
  assert.ok(source.indexOf(stillCurrent) < source.indexOf('/ip hotspot active remove $oldID'));
  assert.match(source, /\[:pick \$current 0\] != \$keepID/);
  assert.match(source, /hotspot active get \$oldID user\] = \$card/);
  assert.match(source, /hotspot active get \$oldID mac-address\] = \$mac/);
  assert.match(source, /admin-reset/);
  const removes = [...source.matchAll(/\/[a-z][^;\n]*?\bremove\b[^;\n]*;/g)].map(([command]) => command);
  assert.deepEqual(removes, ['/ip hotspot active remove $oldID;']);
  for (const code of [login, logout, cleanup, configure]) assert.doesNotMatch(executable(code), /kick-duplicate-device|\/ip hotspot active remove/);
});
