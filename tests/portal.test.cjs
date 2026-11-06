const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const QRCode = require('qrcode');
const root = path.join(__dirname, '../hotspot');
let checks = 0;

function open({ page = 'login.html', preview = false, chap = false, blocked = false, error = '', account = '123456789', before } = {}) {
  let html = fs.readFileSync(path.join(root, preview ? 'preview.html' : page), 'utf8')
    .replace(/\$\(if chap-id\)[\s\S]*?\$\(endif\)/g, '')
    .replaceAll('$(link-login-only)', 'http://router.test/login')
    .replaceAll('$(link-orig)', 'http://example.test/')
    .replaceAll('$(link-logout)', 'http://router.test/logout')
    .replaceAll('$(link-login)', 'http://router.test/login')
    .replaceAll('$(error)', error)
    .replaceAll('$(username)', account)
    .replaceAll('$(logged-in)', 'yes')
    .replaceAll('$(domain)', '4M/8M|*yes**')
    .replaceAll('$(remain-bytes-total)', '1048576')
    .replaceAll('$(bytes-out)', '2097152')
    .replaceAll('$(bytes-in)', '1024');
  const dom = new JSDOM(html, { url: 'http://router.test/', runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  if (blocked) {
    w.Storage.prototype.getItem = function () { throw Error('denied'); };
    w.Storage.prototype.setItem = function () { throw Error('denied'); };
  }
  for (const file of ['portal-config.js', 'assets/chap.js', 'assets/jsqr.js']) {
    w.eval(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  if (chap) w.hotspotChap = { id: '\x01', challenge: '\x00\x80challenge' };
  if (before) before(w, d);
  w.eval(fs.readFileSync(path.join(root, 'assets/portal.js'), 'utf8'));
  return { w, d, close: () => w.close() };
}

function submit(d) {
  const event = new d.defaultView.Event('submit', { bubbles: true, cancelable: true });
  d.getElementById('login-form').dispatchEvent(event);
  return event;
}

function selectSpeed(w, d, index) {
  const radio = d.querySelectorAll('.speed-choice input')[index];
  radio.checked = true;
  radio.dispatchEvent(new w.Event('change', { bubbles: true }));
  return radio.value;
}

function qrPixels(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const scale = 5, margin = 4, width = (qr.modules.size + margin * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - margin, col = Math.floor(x / scale) - margin;
    const black = row >= 0 && col >= 0 && row < qr.modules.size && col < qr.modules.size && qr.modules.get(row, col);
    const index = (y * width + x) * 4;
    data[index] = data[index + 1] = data[index + 2] = black ? 0 : 255;
    data[index + 3] = 255;
  }
  return { data, width, height: width };
}

async function testQR(text, expected, failingNative = false) {
  const { w, d, close } = open();
  try {
    const pixels = qrPixels(text);
    w.URL.createObjectURL = () => 'blob:local-test';
    w.URL.revokeObjectURL = () => {};
    w.Image = class {
      constructor() { this.naturalWidth = pixels.width; this.naturalHeight = pixels.height; }
      set src(value) { queueMicrotask(() => this.onload()); }
    };
    w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData() { return pixels; } });
    if (failingNative) w.BarcodeDetector = class { async detect() { throw Error('unavailable on HTTP'); } };
    d.getElementById('scan').click();
    const input = d.querySelector('.scan-input');
    Object.defineProperty(input, 'files', { value: [new w.File(['local-image'], 'card.png', { type: 'image/png' })] });
    input.dispatchEvent(new w.Event('change'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(d.getElementById('card').value, expected);
    assert.equal(d.getElementById('auth-password').value, '');
    assert.equal(d.getElementById('sheet').open, false);
    assert.equal(d.getElementById('submit').disabled, false, 'QR only fills the username; it does not log in');
    checks++;
  } finally { close(); }
}

async function main() {
  {
    const { w, d, close } = open({ preview: true });
    assert.equal(d.querySelectorAll('input[type="password"]').length, 0, 'No visible password control');
    assert.equal(d.querySelectorAll('[name="password"]').length, 1);
    assert.equal(d.querySelector('[name="password"]').type, 'hidden');
    assert.equal(d.querySelectorAll('.speed-choice input').length, 4);
    assert.equal(d.querySelector('.speed-choice input:checked').value, '2M/4M');
    assert.equal(d.getElementById('domain').value, '2M/4M|*no**');
    d.querySelector('[data-open="packages"]').click();
    assert.equal(d.querySelectorAll('.package').length, 6);
    assert.match(d.getElementById('sheet-content').textContent, /200 ريال/);
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(d.getElementById('sheet').open, false);
    d.querySelector('[data-open="sales"]').click();
    assert.match(d.getElementById('sheet-content').textContent, /البقالات/);
    d.getElementById('close-sheet').click();
    d.querySelector('[data-open="help"]').click();
    assert(!d.getElementById('sheet-content').textContent.includes('كلمة المرور'));
    d.getElementById('close-sheet').click();
    d.getElementById('card').value = '١٢۳ ٤۵';
    d.getElementById('card').dispatchEvent(new w.Event('input'));
    assert.equal(d.getElementById('card').value, '12345');
    assert.equal(submit(d).defaultPrevented, true);
    assert.match(d.getElementById('toast').textContent, /معاينة/);
    assert.equal(w.localStorage.getItem('hala.portal.v2.cards'), null);
    assert.equal(w.localStorage.getItem('hala.portal.v2.options'), null);
    assert(d.body.classList.contains('dark'));
    d.getElementById('theme').click();
    assert.equal(d.body.classList.contains('dark'), false);
    assert.equal(d.getElementById('theme').getAttribute('aria-pressed'), 'false');
    checks++; close();
  }

  // Every available speed, both update flags, and both router authentication modes.
  for (const chap of [false, true]) for (const updates of [false, true]) for (let speed = 0; speed < 4; speed++) {
    const { w, d, close } = open({ chap });
    d.getElementById('card').value = '١٢٣&xyz';
    d.getElementById('auth-password').value = 'must-never-be-sent';
    d.getElementById('remember').checked = true;
    const value = selectSpeed(w, d, speed);
    d.getElementById('updates').checked = updates;
    d.getElementById('updates').dispatchEvent(new w.Event('change'));
    assert.equal(submit(d).defaultPrevented, false);
    const payload = new URLSearchParams(new w.FormData(d.getElementById('login-form')));
    assert.equal(payload.get('domain'), value + '|' + (updates ? '*yes**' : '*no**'));
    assert.equal(payload.get('username'), '123&xyz');
    assert.equal(d.getElementById('login-form').method, 'post');
    assert.equal(w.localStorage.getItem('hala.portal.v2.cards'), null, 'Do not save unconfirmed logins');
    assert.equal(JSON.parse(w.sessionStorage.getItem('hala.portal.v2.pending-login')).card, '123&xyz');
    const expectedPassword = chap ? crypto.createHash('md5').update(Buffer.from('\x01\x00\x80challenge', 'latin1')).digest('hex') : '';
    assert.equal(payload.get('password'), expectedPassword, 'Username-only auth must use an empty password');
    assert.notEqual(payload.get('password'), payload.get('username'));
    assert(!JSON.stringify(w.localStorage).includes('must-never-be-sent'));
    w.dispatchEvent(new w.Event('pageshow'));
    assert.equal(d.getElementById('auth-password').value, '');
    assert.equal(d.getElementById('submit').disabled, false);
    assert.equal(submit(d).defaultPrevented, false);
    assert.equal(d.getElementById('auth-password').value, expectedPassword, 'Retry must not hash a previous digest');
    checks++; close();
  }
  {
    const { w, d, close } = open({ blocked: true });
    d.getElementById('card').value = '123';
    d.getElementById('remember').checked = true;
    assert.equal(submit(d).defaultPrevented, false);
    assert.match(d.getElementById('toast').textContent, /لا يسمح/);
    checks++; close();
  }
  {
    const { w, d, close } = open({ error: 'invalid username or password' });
    assert.equal(d.getElementById('login-error').hidden, false);
    assert.match(d.getElementById('login-error').textContent, /رقم الكرت غير صحيح/);
    checks++; close();
  }
  {
    const { w, d, close } = open({ before(w) {
      w.localStorage.setItem('hala.portal.v2.options', JSON.stringify({ speed: '8M/16M', updates: true }));
      w.localStorage.setItem('hala.portal.v2.cards', JSON.stringify(['123456', '987654']));
    } });
    assert.equal(d.querySelector('.speed-choice input:checked').value, '8M/16M');
    assert.equal(d.getElementById('domain').value, '8M/16M|*yes**');
    d.getElementById('saved').click();
    d.querySelector('.saved-card').click();
    assert.equal(d.getElementById('card').value, '123456');
    assert.equal(d.getElementById('remember').checked, true);
    d.getElementById('remember').checked = false;
    submit(d);
    assert.deepEqual(JSON.parse(w.localStorage.getItem('hala.portal.v2.cards')), ['123456', '987654']);
    const confirmed = open({ page: 'status.html', account: '123456', before(next) {
      next.localStorage.setItem('hala.portal.v2.cards', w.localStorage.getItem('hala.portal.v2.cards'));
      next.sessionStorage.setItem('hala.portal.v2.pending-login', w.sessionStorage.getItem('hala.portal.v2.pending-login'));
    } });
    assert.deepEqual(JSON.parse(confirmed.w.localStorage.getItem('hala.portal.v2.cards')), ['987654']);
    confirmed.close();
    checks++; close();
  }
  for (const setup of [
    w => { w.portalConfig.speeds = []; },
    w => { w.portalConfig.speeds.forEach(speed => { speed.visible = false; }); }
  ]) {
    const { d, close } = open({ before: setup });
    d.getElementById('card').value = '123';
    assert.equal(d.getElementById('submit').disabled, true);
    assert.equal(submit(d).defaultPrevented, true);
    checks++; close();
  }
  {
    const { d, close } = open({ chap: true, before(w) { delete w.hotspotMD5; } });
    d.getElementById('card').value = '123';
    assert.equal(submit(d).defaultPrevented, true);
    assert.equal(d.getElementById('auth-password').value, '');
    checks++; close();
  }
  {
    const { w, d, close } = open({ before(w) { w.portalConfig.updateBlockingEnabled = false; } });
    d.getElementById('card').value = '123';
    d.getElementById('updates').checked = true;
    submit(d);
    assert.equal(d.getElementById('domain').value, '2M/4M|*no**');
    checks++; close();
  }
  {
    const { d, close } = open({ page: 'status.html' });
    assert.equal(d.getElementById('account-card').textContent, '1234••••');
    assert.equal(d.getElementById('account-speed').textContent, 'سرعة عالية');
    assert.match(d.querySelector('.stat-feature').textContent, /ميجابايت/);
    assert.equal(d.querySelector('form').action, 'http://router.test/logout');
    checks++; close();
  }
  {
    const { w, d, close } = open({ page: 'logout.html' });
    w.localStorage.setItem('hala.portal.v2.cards', JSON.stringify(['123456']));
    d.getElementById('forget').click();
    assert.deepEqual(JSON.parse(w.localStorage.getItem('hala.portal.v2.cards')), []);
    checks++; close();
  }
  // Follow actual submit -> authenticated status transitions with tab-local pending state.
  function loginIntoWallet(card, cards, remember = true, statusAccount = card) {
    const login = open({ before(w) { w.localStorage.setItem('hala.portal.v2.cards', JSON.stringify(cards)); } });
    login.d.getElementById('card').value = card;
    login.d.getElementById('remember').checked = remember;
    assert.equal(submit(login.d).defaultPrevented, false);
    assert.deepEqual(JSON.parse(login.w.localStorage.getItem('hala.portal.v2.cards')), cards);
    const confirmed = open({ page: 'status.html', account: statusAccount, before(w) {
      w.localStorage.setItem('hala.portal.v2.cards', login.w.localStorage.getItem('hala.portal.v2.cards'));
      w.sessionStorage.setItem('hala.portal.v2.pending-login', login.w.sessionStorage.getItem('hala.portal.v2.pending-login'));
    } });
    const result = JSON.parse(confirmed.w.localStorage.getItem('hala.portal.v2.cards'));
    assert.equal(confirmed.w.sessionStorage.getItem('hala.portal.v2.pending-login'), null);
    login.close(); confirmed.close(); return result;
  }
  {
    let cards = [];
    for (const card of ['100001', '100002', '100003', '100004', '100005', '100006']) cards = loginIntoWallet(card, cards);
    assert.deepEqual(cards, ['100006', '100005', '100004', '100003', '100002']);
    cards = loginIntoWallet('100004', cards);
    assert.deepEqual(cards, ['100004', '100006', '100005', '100003', '100002']);
    assert.deepEqual(loginIntoWallet('100007', cards, true, 'other-account'), cards);
    const wallet = open({ before(w) { w.localStorage.setItem('hala.portal.v2.cards', JSON.stringify(cards)); } });
    assert.equal(wallet.d.getElementById('remember').checked, true);
    assert.equal(wallet.d.getElementById('wallet-count').textContent, '5/5');
    wallet.d.getElementById('saved').click();
    assert.equal(wallet.d.querySelectorAll('.saved-card').length, 5);
    assert.equal(wallet.d.querySelector('.wallet-number').textContent, '100004');
    wallet.d.querySelector('.wallet-remove').click();
    assert.equal(wallet.d.getElementById('wallet-count').textContent, '4/5');
    assert.equal(wallet.d.querySelectorAll('.saved-card').length, 4);
    wallet.d.querySelector('.saved-card').click();
    assert.equal(wallet.d.getElementById('card').value, '100006');
    assert.equal(wallet.d.getElementById('submit').disabled, false);
    wallet.d.getElementById('saved').click();
    wallet.d.querySelector('#sheet-content > .secondary').click();
    assert.deepEqual(JSON.parse(wallet.w.localStorage.getItem('hala.portal.v2.cards')), []);
    wallet.close(); checks++;
  }
  {
    const pending = JSON.stringify({card: '123456', remember: true, time: Date.now()});
    const failed = open({ error: 'invalid username or password', before(w) {
      w.sessionStorage.setItem('hala.portal.v2.pending-login', pending);
    } });
    assert.equal(failed.w.sessionStorage.getItem('hala.portal.v2.pending-login'), null);
    assert.equal(failed.w.localStorage.getItem('hala.portal.v2.cards'), null);
    failed.close(); checks++;
  }
  {
    const legacy = {usernames: ['100001','100002','100003','100004','100005','100006'], passwords: ['legacy-secret']};
    const wallet = open({before(w) { w.localStorage.setItem('usernamesAndPasswords', JSON.stringify(legacy)); }});
    assert.deepEqual(JSON.parse(wallet.w.localStorage.getItem('hala.portal.v2.cards')), ['100006','100005','100004','100003','100002']);
    assert(!wallet.w.localStorage.getItem('hala.portal.v2.cards').includes('legacy-secret'));
    wallet.close();
    const cleared = open({before(w) {
      w.localStorage.setItem('hala.portal.v2.cards', '[]');
      w.localStorage.setItem('usernamesAndPasswords', JSON.stringify(legacy));
    }});
    assert.deepEqual(JSON.parse(cleared.w.localStorage.getItem('hala.portal.v2.cards')), [], 'Never restore a wallet the owner emptied');
    cleared.close(); checks++;
  }
  {
    const expired = open({page:'status.html', before(w) {
      w.sessionStorage.setItem('hala.portal.v2.pending-login', JSON.stringify({card:'123456789',remember:true,time:Date.now()-16*60*1000}));
    }});
    assert.equal(expired.w.localStorage.getItem('hala.portal.v2.cards'), null);
    expired.close(); checks++;
  }
  await testQR('١٢٣٤٥٦', '123456');
  await testQR('http://router.test/login?username=123%26ABC&password=ignored', '123&ABC', true);
  await testQR(JSON.stringify({ username: '987654', password: 'do-not-use-this' }), '987654');

  const { w, close } = open();
  for (const value of ['', 'abc', 'message digest', '\x01password\x00\x80\xff', 'x'.repeat(1000)]) {
    assert.equal(w.hotspotMD5(value), crypto.createHash('md5').update(Buffer.from(value, 'latin1')).digest('hex'));
  }
  checks++; close();

  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    let depth = 0;
    for (const token of html.matchAll(/\$\((if\b[^)]*|endif)\)/g)) {
      depth += token[1] === 'endif' ? -1 : 1;
      assert(depth >= 0);
    }
    assert.equal(depth, 0);
    const dom = new JSDOM(html);
    const ids = [...dom.window.document.querySelectorAll('[id]')].map(element => element.id);
    assert.equal(new Set(ids).size, ids.length, file + ': duplicate IDs');
    dom.window.close();
    for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (match[1].startsWith('assets/') || match[1] === 'portal-config.js') {
        assert(fs.existsSync(path.join(root, match[1])), match[1]);
      }
    }
  }
  checks++;
  console.log(`PASS: ${checks} scenarios including all speeds/PAP/CHAP/update flags, empty passwords, retries, real offline QR decoding, preview isolation, storage, status and templates.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
