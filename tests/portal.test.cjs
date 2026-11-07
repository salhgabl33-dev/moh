'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');

const portalRoot = path.resolve(__dirname, '../hotspot');
const source = (name) => fs.readFileSync(path.join(portalRoot, name), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fragment(data = {}, chap) {
  const defaults = { action: 'onLoginStart', loggedIn: 'no', loginUrl: '/login', statusUrl: '/status', logoutUrl: '/logout' };
  const attributes = Object.entries({ ...defaults, ...data }).map(([key, value]) => {
    const name = key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
    return `data-${name}="${encodeURIComponent(String(value))}"`;
  }).join(' ');
  const challenge = chap ? `<script type="text/plain" id="router-chap-id">${chap.id}</script><script type="text/plain" id="router-chap-challenge">${chap.challenge}</script>` : '';
  return `<!doctype html><html><body><div id="router-response" ${attributes}></div>${challenge}</body></html>`;
}

function reply(data, chap) {
  return { ok: true, status: 200, text: async () => fragment(data, chap) };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  const { window } = parseHTML(source('index.html'));
  const document = window.document;
  const values = new Map(Object.entries(options.storage || {}));
  const storage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
  const href = options.href || 'http://hotspot.test/index.html';
  const location = new URL(href);
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  let responder = options.respond || (() => reply());
  function fetch(url, init) {
    const request = { url: new URL(url), init, method: init.method, fields: init.body ? new URLSearchParams(init.body) : null };
    requests.push(request);
    let result;
    try { result = responder(request, requests.length); } catch (error) { result = Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Aborted', 'AbortError'));
      init.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(result).then(resolve, reject).finally(() => init.signal.removeEventListener('abort', abort));
    });
  }
  const context = vm.createContext({
    window, document, location, localStorage: storage,
    navigator: options.navigator || {}, DOMParser: window.DOMParser, URL, URLSearchParams,
    AbortController, DOMException, TypeError, fetch,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    console
  });
  vm.runInContext(source('assets/js/network-config-2027.js'), context);
  Object.assign(window.siteConfig, options.config || {});
  vm.runInContext(source('assets/js/md5-2027.js'), context);
  if (options.initialize) options.initialize(window, document);
  vm.runInContext(source('assets/js/portal-2027.js'), context);
  const $ = (id) => document.getElementById(id);
  function event(id, type) { $(id).dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true })); }
  return {
    $, window, document, requests, values, timers,
    setResponder(next) { responder = next; },
    async settle() { await tick(); },
    async submit(username = 'card-2027', password = '') {
      $('username').value = username;
      $('password').value = password;
      event('login-form', 'submit');
      await tick();
    },
    async click(id) { event(id, 'click'); await tick(); },
    change(id) { event(id, 'change'); },
    fireTimer(delay) {
      const found = Array.from(timers).find(([, timer]) => timer.delay === delay);
      assert.ok(found, `Expected a pending ${delay}ms timer`);
      timers.delete(found[0]);
      found[1].callback();
    }
  };
}

function successRoute(request) {
  if (request.url.pathname === '/status') return reply({ action: 'onStatusQuery', loggedIn: 'yes', username: 'card-2027', bytesIn: '1024', bytesOut: '2048', remainingData: '4096', domain: '2M/4M|*no**' });
  if (request.method === 'POST') return reply({ action: 'onLoggedIn', loggedIn: 'yes' });
  return reply();
}

test('a confirmed cookie session remains visible when its first status refresh fails', async () => {
  const app = harness({ respond: (request) => request.url.pathname === '/status'
    ? { ok: false, status: 503, text: async () => '' }
    : reply({ loggedIn: 'yes', username: 'cookie-card' }) });
  await app.settle();
  assert.equal(app.$('status-panel').hidden, false);
  assert.equal(app.$('login-panel').hidden, true);
  assert.match(app.$('status-message').textContent, /503/);
});

test('a RouterOS logged-in="no" response keeps the login form visible', async () => {
  const app = harness();
  await app.settle();
  assert.equal(app.$('login-panel').hidden, false);
  assert.equal(app.$('status-panel').hidden, true);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].method, 'GET');
  assert.equal(app.requests[0].url.searchParams.get('var'), 'callBack');
  assert.equal(app.$('connection-label').textContent, 'بوابة الشبكة');
});

test('PAP uses POST body encoding and retains the original speed|block-updates protocol', async () => {
  const app = harness({ respond: successRoute });
  await app.settle();
  assert.equal(app.$('login-domain').value, '2M/4M|*no**');
  const buttons = app.$('speed-options').querySelectorAll('button');
  buttons[3].dispatchEvent(new app.window.Event('click'));
  app.$('data-saver').checked = true;
  app.change('data-saver');
  await app.submit('٧٥a+&=%', 'p+&= %?/');
  const request = app.requests.find((item) => item.method === 'POST');
  assert.ok(request);
  assert.equal(request.fields.get('username'), '75a+&=%');
  assert.equal(request.fields.get('password'), 'p+&= %?/');
  assert.equal(request.fields.get('domain'), '8M/16M|*yes**');
  assert.equal(request.fields.get('popup'), 'true');
  assert.equal(request.url.searchParams.has('username'), false);
  assert.equal(request.url.searchParams.has('password'), false);
  assert.equal(app.$('status-panel').hidden, false);
  assert.equal(app.$('password').value, '');
});

test('RouterOS login failure shows the Arabic error, clears secrets, and permits another attempt', async () => {
  const app = harness({ respond: (request) => request.method === 'POST' ? reply({ action: 'onLoginError', loggedIn: 'no', error: 'invalid password' }) : reply() });
  await app.settle();
  app.$('save-card').checked = true;
  await app.submit('card-2027', 'incorrect-secret');
  assert.match(app.$('login-error').textContent, /كلمة المرور غير صحيحة/);
  assert.equal(app.$('login-error').hidden, false);
  assert.equal(app.$('login-panel').hidden, false);
  assert.equal(app.$('login-submit').disabled, false);
  assert.equal(app.$('password').value, '');
  assert.equal(app.values.has('hala2027.cards'), false);
  app.setResponder(successRoute);
  await app.submit('card-2027', 'correct-secret');
  assert.equal(app.$('status-panel').hidden, false);
});

test('a timed-out login shows an actionable error and releases the form', async () => {
  const pending = deferred();
  const app = harness({ respond: (request) => request.method === 'POST' ? pending.promise : reply() });
  await app.settle();
  await app.submit('card-2027', 'timeout-secret');
  assert.equal(app.$('login-submit').disabled, true);
  app.fireTimer(12000);
  await app.settle();
  assert.match(app.$('login-error').textContent, /انتهت مهلة الاتصال/);
  assert.equal(app.$('login-submit').disabled, false);
  assert.equal(app.$('password').value, '');
  assert.equal(app.$('status-panel').hidden, true);
});

test('unexpected or unsuccessful HTTP responses do not authenticate the client', async () => {
  const app = harness({ respond: (request) => request.method === 'POST' ? { ok: false, status: 503, text: async () => 'Unavailable' } : reply() });
  await app.settle();
  await app.submit();
  assert.match(app.$('login-error').textContent, /503/);
  assert.equal(app.$('status-panel').hidden, true);
  app.setResponder((request) => request.method === 'POST' ? { ok: true, status: 200, text: async () => '<html><body>Wrong router page</body></html>' } : reply());
  await app.submit();
  assert.match(app.$('login-error').textContent, /استجابة الراوتر/);
  assert.equal(app.$('status-panel').hidden, true);
});

test('status maps RouterOS bytes-in to upload and bytes-out to download, distinguishing zero from unknown', async () => {
  let remaining = '0';
  const app = harness({ respond: (request) => request.url.pathname === '/status'
    ? reply({ action: 'onStatusQuery', loggedIn: 'yes', username: '123456789', ip: '10.0.0.27', bytesIn: '1048576', bytesOut: '2097152', remainingData: remaining, remainingTime: '', uptime: '1h2m', domain: '2M/4M|*no**' })
    : reply({ loggedIn: 'yes', username: '123456789' }) });
  await app.settle();
  assert.equal(app.$('status-upload').textContent, '1.0 ميجابايت');
  assert.equal(app.$('status-download').textContent, '2.0 ميجابايت');
  assert.equal(app.$('status-remaining-data').textContent, '0 بايت');
  assert.equal(app.$('status-remaining-time').textContent, 'غير محدد');
  assert.equal(app.$('status-username').textContent.includes('12345'), false);
  assert.equal(app.$('status-ip').textContent, '10.0.0.27');
  remaining = '';
  await app.click('refresh-status');
  assert.equal(app.$('status-remaining-data').textContent, 'غير محدد');
  remaining = '-1';
  await app.click('refresh-status');
  assert.equal(app.$('status-remaining-data').textContent, 'غير متاح');
});

test('card saving is opt-in, occurs after successful authentication, and stores usernames only', async () => {
  const pending = deferred();
  const app = harness({ storage: { usernamesAndPasswords: '{"usernames":["legacy"],"passwords":["legacy-secret"]}' }, respond: (request) => request.method === 'POST' ? pending.promise : successRoute(request) });
  await app.settle();
  assert.equal(app.values.has('usernamesAndPasswords'), false);
  app.$('save-card').checked = true;
  await app.submit('saved-card', 'do-not-store-this');
  assert.equal(app.values.has('hala2027.cards'), false);
  pending.resolve(reply({ action: 'onLoggedIn', loggedIn: 'yes' }));
  await app.settle();
  assert.deepEqual(JSON.parse(app.values.get('hala2027.cards')), ['saved-card']);
  assert.equal(Array.from(app.values.values()).join('').includes('do-not-store-this'), false);
  assert.equal(app.$('saved-cards-row').hidden, false);
});

test('successful login without opt-in does not save a card or password', async () => {
  const app = harness({ respond: successRoute });
  await app.settle();
  await app.submit('unsaved-card', 'never-store');
  assert.equal(app.values.has('hala2027.cards'), false);
});

test('CHAP decodes octal and hexadecimal bytes before hashing with the actual MD5 implementation', async () => {
  const chap = { id: String.raw`\001`, challenge: String.raw`\000\177\200\377\x0a` };
  const password = 'pass+&=42';
  const app = harness({ respond: (request) => request.method === 'POST' ? reply({ action: 'onLoginError', error: 'invalid password' }) : reply({}, chap) });
  await app.settle();
  await app.submit('chap-card', password);
  const request = app.requests.find((item) => item.method === 'POST');
  const input = Buffer.concat([Buffer.from([1]), Buffer.from(password, 'latin1'), Buffer.from([0, 127, 128, 255, 10])]);
  assert.equal(request.fields.get('password'), crypto.createHash('md5').update(input).digest('hex'));
  assert.notEqual(request.fields.get('password'), password);
  assert.equal(request.fields.get('domain'), '2M/4M|*no**');
});

test('pasting a username-only QR clears any password left by a previous card without navigating or logging in', async () => {
  const app = harness();
  await app.settle();
  app.$('password').value = 'stale-secret';
  app.$('qr-input').value = 'next-card';
  await app.click('qr-apply');
  assert.equal(app.$('username').value, 'next-card');
  assert.equal(app.$('password').value, '');
  assert.equal(app.$('qr-input').value, '');
  assert.equal(app.requests.length, 1);
  app.$('qr-input').value = 'https://unknown.example/?username=qr-user&password=a%2Bb%26c';
  await app.click('qr-apply');
  assert.equal(app.$('username').value, 'qr-user');
  assert.equal(app.$('password').value, 'a+b&c');
  assert.equal(app.$('password-fields').hidden, false);
  assert.equal(app.requests.length, 1);
});

test('blank and unsafe optional service URLs hide their links', async () => {
  const app = harness({ config: { moba: '', estr: 'javascript:alert(1)' } });
  await app.settle();
  assert.equal(app.$('stream-link').hidden, true);
  assert.equal(app.$('lounge-link').hidden, true);
});

test('preview mode clearly labels demonstration data and never contacts the router or saves cards', async () => {
  const app = harness({ href: 'http://hotspot.test/index.html?preview=1', respond: () => { throw new Error('Preview must not fetch'); } });
  await app.settle();
  assert.match(app.$('portal-notice').textContent, /تجريبية/);
  app.$('save-card').checked = true;
  await app.submit('demo-card', 'demo-secret');
  assert.match(app.$('connection-label').textContent, /معاينة/);
  assert.match(app.$('status-message').textContent, /لم يتم إنشاء اتصال/);
  assert.equal(app.requests.length, 0);
  assert.equal(app.values.has('hala2027.cards'), false);
  await app.click('logout-button');
  assert.equal(app.$('login-panel').hidden, false);
  assert.equal(app.requests.length, 0);
});

test('a stale status response cannot reopen a session after a successful logout', async () => {
  const pendingStatus = deferred();
  let statusCount = 0;
  const app = harness({ respond: (request) => {
    if (request.url.pathname === '/logout') return reply({ action: 'onLoggedOut', loggedIn: 'no' });
    if (request.url.pathname === '/status') {
      statusCount++;
      if (statusCount === 2) return pendingStatus.promise;
      return successRoute(request);
    }
    return successRoute(request);
  } });
  await app.settle();
  await app.submit();
  await app.click('refresh-status');
  assert.equal(statusCount, 2);
  await app.click('logout-button');
  assert.equal(app.$('login-panel').hidden, false);
  pendingStatus.resolve(reply({ action: 'onStatusQuery', loggedIn: 'yes', username: 'stale-session', bytesOut: '999999' }));
  await app.settle();
  assert.equal(app.$('login-panel').hidden, false);
  assert.equal(app.$('status-panel').hidden, true);
  assert.match(app.$('portal-notice').textContent, /قطع الاتصال/);
  const logoutRequest = app.requests.find((item) => item.url.pathname === '/logout');
  assert.equal(logoutRequest.method, 'POST');
});

test('logout-and-forget erases saved cards only after the router confirms disconnection', async () => {
  let allowLogout = false;
  const app = harness({ storage: { 'hala2027.cards': '["card-2027"]' }, respond: (request) => request.url.pathname === '/logout'
    ? reply({ action: 'onLoggedOut', loggedIn: allowLogout ? 'no' : 'yes' }) : successRoute(request) });
  await app.settle();
  await app.submit();
  await app.click('logout-forget-button');
  assert.equal(app.values.has('hala2027.cards'), true);
  assert.equal(app.$('status-panel').hidden, false);
  allowLogout = true;
  await app.click('logout-forget-button');
  assert.equal(app.values.has('hala2027.cards'), false);
  assert.equal(app.$('login-panel').hidden, false);
  const requests = app.requests.filter((item) => item.url.pathname === '/logout');
  assert.ok(requests.every((request) => request.url.searchParams.get('erase-cookie') === 'yes'));
});

test('a camera stream arriving after pagehide is stopped without opening video or scanning', async () => {
  const pendingCamera = deferred();
  let stopped = 0;
  let detected = 0;
  let played = 0;
  let requested = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped++; } }] };
  const app = harness({
    navigator: { mediaDevices: { getUserMedia: () => { requested++; return pendingCamera.promise; } } },
    initialize(window, document) {
      window.isSecureContext = true;
      window.BarcodeDetector = class { async detect() { detected++; return []; } };
      document.getElementById('qr-video').play = async () => { played++; };
    }
  });
  await app.settle();
  await app.click('scan-card');
  assert.equal(requested, 1);
  app.window.dispatchEvent(new app.window.Event('pagehide'));
  pendingCamera.resolve(stream);
  await app.settle();
  assert.equal(stopped, 1);
  assert.equal(detected, 0);
  assert.equal(played, 0);
  assert.equal(app.$('qr-video').hidden, true);
  assert.equal(app.$('qr-video').srcObject, null);
  assert.equal(Array.from(app.timers.values()).some((timer) => timer.delay === 350 || timer.delay === 45000), false);
});
