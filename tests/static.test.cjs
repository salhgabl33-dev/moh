'use strict';

// Portable source checks and a small template-token emulator.
// This does not run RouterOS, a browser, CSS layout, or a real HotSpot session.
// Run from any directory: node --test tests/static.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const bundle = path.resolve(__dirname, '..');
const portal = path.join(bundle, 'hotspot');
const read = (relative) => fs.readFileSync(path.join(portal, relative), 'utf8');
const callbacks = ['login.html', 'alogin.html', 'status.html', 'logout.html', 'error.html'];
const required = [...callbacks, 'index.html', 'redirect.html', 'rlogin.html'];

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(filename) : [filename];
  });
}

function attributes(source) {
  const result = Object.create(null);
  const pattern = /([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(pattern)) {
    assert.equal(result[match[1]], undefined, `duplicate attribute: ${match[1]}`);
    result[match[1]] = (match[2] ?? match[3]).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return result;
}

function tags(source) {
  return [...source.matchAll(/<([a-z][a-z\d:-]*)\b([^<>]*?)\/?\s*>/gi)]
    .map((match) => ({ name: match[1].toLowerCase(), attrs: attributes(match[2]) }));
}

function condition(expression, values) {
  const equality = /^(\S+)\s*==\s*"([^"]*)"$/.exec(expression);
  if (equality) return String(values[equality[1]] ?? '') === equality[2];
  assert.match(expression, /^[a-z][a-z\d-]*$/i, `unsupported emulator condition: ${expression}`);
  return Boolean(values[expression]);
}

function renderTemplate(source, values) {
  let output = '';
  let cursor = 0;
  const stack = [];
  const active = () => stack.every((frame) => frame.condition);
  for (const match of source.matchAll(/\$\(([^)]+)\)/g)) {
    if (active()) output += source.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const token = match[1].trim();
    if (token.startsWith('if ')) {
      stack.push({ condition: condition(token.slice(3), values), usedElse: false });
    } else if (token === 'else') {
      assert.ok(stack.length, 'else without if');
      const current = stack.at(-1);
      assert.equal(current.usedElse, false, 'duplicate else');
      current.condition = !current.condition;
      current.usedElse = true;
    } else if (token === 'endif') {
      assert.ok(stack.length, 'endif without if');
      stack.pop();
    } else if (active()) {
      const escaped = token.endsWith('-esc');
      const name = escaped ? token.slice(0, -4) : token;
      const value = String(values[name] ?? '');
      output += escaped ? encodeURIComponent(value) : value;
    }
  }
  if (active()) output += source.slice(cursor);
  assert.equal(stack.length, 0, 'unclosed template condition');
  assert.doesNotMatch(output, /\$\(/, 'unexpanded template token');
  return output;
}

function responseFrom(source) {
  const responses = tags(source).filter((tag) => tag.attrs.id === 'router-response');
  assert.equal(responses.length, 1, 'one router-response per rendered callback');
  return responses[0].attrs;
}

const sample = {
  var: 'callBack',
  error: '',
  'logged-in': 'no',
  username: 'CARD-12"<&/عربي',
  ip: '192.0.2.23',
  domain: '2M/4M|*yes**',
  'link-login-only': 'http://hotspot.example/login',
  'link-status': 'http://hotspot.example/status',
  'link-logout': 'http://hotspot.example/logout',
  'link-orig': 'https://example.org/?a=1&b="value"',
  'bytes-in': '128',
  'bytes-out': '4096',
  'remain-bytes-total': '0',
  'session-time-left': '1h2m',
  uptime: '3m4s',
  'chap-id': '',
  'chap-challenge': ''
};

test('required RouterOS filenames and complete local entry points exist', () => {
  for (const filename of [...required, 'preview.html', 'settings-2027.html', 'dash.html']) {
    assert.ok(fs.existsSync(path.join(portal, filename)), `${filename} missing`);
    assert.match(read(filename), /<!doctype html>/i, `${filename} needs HTML doctype`);
  }
});

test('all router template conditionals balance in callback and navigation modes', () => {
  for (const filename of required) {
    for (const varValue of ['', 'callBack']) {
      for (const errorValue of ['', 'invalid password']) {
        renderTemplate(read(filename), { ...sample, var: varValue, error: errorValue });
      }
    }
  }
});

test('login callbacks distinguish errors and expose encoded routing metadata', () => {
  for (const errorValue of ['', 'invalid password: "<&\nعربي']) {
    const rendered = renderTemplate(read('login.html'), { ...sample, error: errorValue });
    const result = responseFrom(rendered);
    assert.equal(result['data-action'], errorValue ? 'onLoginError' : 'onLoginStart');
    assert.equal(result['data-logged-in'], 'no');
    for (const [attribute, variable] of Object.entries({
      'data-login-url': 'link-login-only', 'data-status-url': 'link-status',
      'data-logout-url': 'link-logout', 'data-dst': 'link-orig',
      'data-username': 'username', 'data-ip': 'ip', 'data-domain': 'domain'
    })) assert.equal(decodeURIComponent(result[attribute]), sample[variable], attribute);
    assert.equal(decodeURIComponent(result['data-error']), errorValue);
    assert.equal(tags(rendered).some((tag) => tag.name === 'meta' && tag.attrs['http-equiv'] === 'refresh'), false);
  }
});

test('CHAP challenge is present only when provided and stays in inert text nodes', () => {
  const withoutChap = renderTemplate(read('login.html'), sample);
  assert.doesNotMatch(withoutChap, /id="router-chap-/);
  const values = { ...sample, 'chap-id': '\\001', 'chap-challenge': '\\000\\123\\377' };
  const withChap = renderTemplate(read('login.html'), values);
  for (const [id, value] of [['router-chap-id', values['chap-id']], ['router-chap-challenge', values['chap-challenge']]]) {
    const matches = [...withChap.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter((match) => attributes(match[1]).id === id);
    assert.equal(matches.length, 1);
    assert.equal(attributes(matches[0][1]).type, 'text/plain');
    assert.equal(matches[0][2], value);
  }
});

test('status preserves counters including zero versus unspecified remaining data', () => {
  for (const remaining of ['0', '', '1048576']) {
    const rendered = renderTemplate(read('status.html'), { ...sample, 'logged-in': 'yes', 'remain-bytes-total': remaining });
    const result = responseFrom(rendered);
    assert.equal(result['data-action'], 'onStatusQuery');
    assert.equal(result['data-logged-in'], 'yes');
    assert.equal(result['data-remaining-data'], remaining);
    assert.equal(result['data-bytes-in'], '128');
    assert.equal(result['data-bytes-out'], '4096');
    assert.equal(decodeURIComponent(result['data-domain']), '2M/4M|*yes**');
    assert.equal(decodeURIComponent(result['data-remaining-time']), '1h2m');
  }
});

test('success, logout and error callbacks use explicit actions', () => {
  for (const [filename, action] of [['alogin.html', 'onLoggedIn'], ['logout.html', 'onLoggedOut'], ['error.html', 'onLoginError']]) {
    const rendered = renderTemplate(read(filename), sample);
    assert.equal(responseFrom(rendered)['data-action'], action);
    assert.equal(tags(rendered).some((tag) => tag.name === 'meta' && tag.attrs['http-equiv'] === 'refresh'), false);
  }
});

test('normal router navigation refreshes to the local portal, callbacks do not', () => {
  for (const filename of callbacks) {
    const rendered = renderTemplate(read(filename), { ...sample, var: '' });
    const refreshes = tags(rendered).filter((tag) => tag.name === 'meta' && tag.attrs['http-equiv'] === 'refresh');
    assert.equal(refreshes.length, 1, filename);
    assert.match(refreshes[0].attrs.content, /^0;\s*url=index\.html\?portal=/i);
  }
});

test('untrusted callback text cannot create elements or additional attributes', () => {
  const hostile = '"><img id="injected" src="x" onerror="alert(1)">\\\n% & عربي';
  for (const filename of callbacks) {
    const rendered = renderTemplate(read(filename), { ...sample, username: hostile, error: hostile, domain: hostile });
    const result = responseFrom(rendered);
    assert.equal(tags(rendered).some((tag) => tag.attrs.id === 'injected' || tag.attrs.onerror), false, filename);
    if (result['data-username'] !== undefined) assert.equal(decodeURIComponent(result['data-username']), hostile);
    if (result['data-error'] !== undefined) assert.equal(decodeURIComponent(result['data-error']), hostile);
  }
});

test('rendered HTML has unique IDs and valid accessible/internal references', () => {
  for (const filename of ['index.html', 'settings-2027.html', ...callbacks]) {
    const html = renderTemplate(read(filename), sample);
    const elements = tags(html);
    const ids = new Set();
    for (const element of elements) {
      if (!element.attrs.id) continue;
      assert.equal(ids.has(element.attrs.id), false, `${filename}: duplicate id ${element.attrs.id}`);
      ids.add(element.attrs.id);
    }
    for (const element of elements) {
      for (const name of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby']) {
        for (const reference of (element.attrs[name] ?? '').trim().split(/\s+/).filter(Boolean)) {
          assert.ok(ids.has(reference), `${filename}: ${name} references missing #${reference}`);
        }
      }
      const href = element.attrs.href ?? element.attrs['xlink:href'];
      if (href?.startsWith('#') && href.length > 1) assert.ok(ids.has(href.slice(1)), `${filename}: missing fragment ${href}`);
    }
  }
});

test('all static HTML and CSS asset references exist inside the bundle', () => {
  function checkReference(filename, reference) {
    if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference) || reference.includes('$(')) return;
    const pathname = reference.split(/[?#]/, 1)[0];
    if (!pathname || pathname.startsWith('/')) return;
    const resolved = path.resolve(path.dirname(filename), decodeURIComponent(pathname));
    assert.ok(resolved.startsWith(portal + path.sep), `asset escapes portal: ${reference}`);
    assert.ok(fs.existsSync(resolved), `${path.relative(portal, filename)}: missing ${reference}`);
  }
  for (const filename of filesBelow(portal)) {
    if (filename.endsWith('.html')) {
      for (const element of tags(fs.readFileSync(filename, 'utf8'))) {
        for (const name of ['src', 'href', 'xlink:href', 'poster']) checkReference(filename, element.attrs[name]);
      }
    } else if (filename.endsWith('.css')) {
      for (const match of fs.readFileSync(filename, 'utf8').matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) checkReference(filename, match[1]);
    }
  }
});

test('all shipped JavaScript parses without executing it', () => {
  for (const filename of filesBelow(portal).filter((filename) => filename.endsWith('.js'))) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(filename, 'utf8'), { filename }), path.relative(portal, filename));
  }
});

test('documentation preserves the original router script reference as a review-only artifact', () => {
  const reference = path.join(bundle, 'docs/reference/router-scripts-original.txt');
  assert.ok(fs.existsSync(reference), 'copy the original page.txt to docs/reference/router-scripts-original.txt before packaging');
  const readme = fs.readFileSync(path.join(bundle, 'README-AR.md'), 'utf8');
  assert.ok(readme.includes('docs/reference/router-scripts-original.txt'));
  assert.ok(readme.includes('للمختص فقط'));
  assert.ok(readme.includes('لم يتوفر راوتر MikroTik فعلي'));
  assert.ok(readme.includes('لم يُنفّذ تحقق بصري بالمتصفح'));
});
