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
const defaultLogin = read('on-login-default.rsc');
const multiLogin = read('on-login-UM10USER.rsc');
const legacyLogout = read('on-logout-200-safe.rsc');
const scripts = { login, logout, cleanup, defaultLogin, multiLogin, legacyLogout, verify: read('verify-readonly.rsc') };

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
  const array = /:foreach candidate in=\{([^}]+)\}/.exec(login);
  assert.ok(array);
  const rates = [...array[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(rates, Array.from(window.siteConfig.speedOptions, (speed) => speed.value));
  assert.equal(rates.includes('0/0'), false);
  assert.match(login, /:local defaultRate "1024k\/3072k"/);
});

test('login requires event identity and checks the unique active client before applying a rate', () => {
  for (const variable of ['$address', '$user', '$"mac-address"']) assert.ok(login.includes(variable));
  assert.match(login, /\[:len \$sessions\] != 1/);
  assert.match(login, /get \$activeID user\] != \$clientUser/);
  assert.match(login, /get \$activeID mac-address\]\] != \$clientMAC/);
  assert.match(login, /:set rate \$defaultRate/);
  assert.match(login, /limit-at=0\/0 max-limit=\$rate/);
});

test('logout deletion queries require queue ownership and the precise user/device marker', () => {
  assert.match(logout, /ownerMarker \("HN27:" \. \$clientIP \. "\|" \. \$clientMAC \. "\|" \. \$clientUser\)/);
  assert.match(logout, /queue simple find where name=\$queueName and comment=\$ownerMarker/);
  assert.match(logout, /address-list find where list=\$blockList and address=\$clientIP and comment=\$ownerMarker/);
  assert.equal((logout.match(/hotspot active find where address=\$clientIP/g) || []).length, 3);
});

test('script mutations stay inside owned queues and address lists rather than resetting router state', () => {
  for (const code of [login, logout, cleanup, legacyLogout]) {
    assert.doesNotMatch(code, /\/ip firewall (?:filter|nat|mangle)\b/);
    assert.doesNotMatch(code, /\/tool user-manager|\/user-manager|reset-counters|remove \[find\]/);
    for (const line of code.split('\n').filter((line) => /\/.*\bremove\b/.test(line))) {
      assert.match(line.trim(), /^\/(?:queue simple|ip firewall address-list|ip hotspot active) remove \$(?:queueID|entryID|sessionID);$/);
    }
  }
  assert.match(login, /:local blockList "\*yes\*\*"/);
  assert.match(login, /:local moveToTop false/);
  assert.match(login, /:if \(\$moveToTop = true\)/);
  assert.match(login, /:local singleSessionPerUser false/);
  assert.match(login, /:if \(\$singleSessionPerUser = true\)/);
  assert.match(login, /find where user=\$clientUser and address!=\$clientIP/);
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

test('the actual export integration preserves SPEED type, narrow legacy adoption and per-profile session policy', () => {
  assert.match(login, /queue type find where name="SPEED"/);
  assert.match(login, /:set queueKind "SPEED\/SPEED"/);
  assert.match(login, /:local migrateLegacyUpdateEntries false/);
  assert.match(login, /\$legacyComment != "Cards"/);
  assert.match(login, /\$legacyComment != "10-USERS"/);
  assert.match(login, /\$legacyKind != "SPEED\/SPEED"/);
  assert.match(login, /queue simple set \$legacyID name=\$queueName comment=\$ownerMarker/);
  assert.equal(defaultLogin.replace(/^# For[^\n]*\n/, '').replace(':local singleSessionPerUser true;', ':local singleSessionPerUser false;'), login);
  assert.equal(multiLogin.replace(/^# For[^\n]*\n/, ''), login);
  assert.match(legacyLogout, /name=\$legacyName and comment="SPEED"/);
  assert.match(legacyLogout, /list="dis_update" and address=\$clientIP and comment=\$clientUser/);
});
