'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const portalRoot = path.resolve(__dirname, '../hotspot');
const source = (name) => fs.readFileSync(path.join(portalRoot, name), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function editor(extraConfig = {}) {
  const { window } = parseHTML(source('settings-2027.html'));
  const document = window.document;
  const downloads = [];
  class DownloadBlob {
    constructor(parts, options) { this.content = parts.join(''); this.type = options.type; }
  }
  class DownloadURL extends URL {}
  DownloadURL.createObjectURL = (blob) => { downloads.push(blob); return 'blob:editor-test'; };
  DownloadURL.revokeObjectURL = () => {};
  const context = vm.createContext({ window, document, URL: DownloadURL, Blob: DownloadBlob, setTimeout: () => 1, Set, console });
  vm.runInContext(source('assets/js/network-config-2027.js'), context);
  Object.assign(window.siteConfig, extraConfig);
  vm.runInContext(source('assets/js/settings-2027.js'), context);
  const $ = (id) => document.getElementById(id);
  return {
    $, document, window, downloads,
    click(id) { $(id).dispatchEvent(new window.Event('click', { cancelable: true })); },
    async importFile(file) {
      Object.defineProperty($('import-json'), 'files', { value: [file], configurable: true });
      $('import-json').dispatchEvent(new window.Event('change'));
      await tick();
    }
  };
}

test('the settings editor exports valid JavaScript and JSON while retaining additional network fields', () => {
  const app = editor({ customSettings: { retain: true } });
  app.$('site-name').value = 'شبكة جديدة';
  app.click('download-js');
  assert.equal(app.downloads.length, 1);
  const exported = vm.createContext({ window: {} });
  vm.runInContext(app.downloads[0].content, exported);
  assert.equal(exported.window.siteConfig.siteName, 'شبكة جديدة');
  assert.equal(exported.window.siteConfig.customSettings.retain, true);
  assert.equal(exported.window.siteConfig.packages.length, 6);
  app.click('download-json');
  assert.equal(app.downloads.length, 2);
  const json = JSON.parse(app.downloads[1].content);
  assert.equal(json.siteName, 'شبكة جديدة');
  assert.equal(json.customSettings.retain, true);
  assert.equal(app.$('editor-status').dataset.error, 'false');
});

test('the editor rejects executable service URLs and hidden default speeds before exporting', () => {
  const app = editor();
  app.$('stream-url').value = 'javascript:alert(1)';
  app.click('download-js');
  assert.equal(app.downloads.length, 0);
  assert.match(app.$('editor-status').textContent, /http/);
  app.$('stream-url').value = 'http://10.0.0.1/live';
  const selected = app.document.querySelectorAll('#speed-rows [data-key=default]');
  const visible = app.document.querySelectorAll('#speed-rows [data-key=visible]');
  selected.forEach((input) => { input.checked = false; });
  selected[0].checked = true;
  visible[0].checked = false;
  app.click('download-js');
  assert.equal(app.downloads.length, 0);
  assert.match(app.$('editor-status').textContent, /افتراضية/);
  visible[0].checked = true;
  app.click('download-js');
  assert.equal(app.downloads.length, 1);
});

test('generated configuration escapes HTML script delimiters and rejects incomplete packages', () => {
  const app = editor();
  app.$('site-name').value = 'شبكة </script><script>alert(1)</script>';
  app.click('download-js');
  assert.equal(app.downloads.length, 1);
  assert.equal(app.downloads[0].content.includes('</script>'), false);
  assert.match(app.downloads[0].content, /\\u003c/);
  const before = app.document.querySelectorAll('#package-rows .editor-row').length;
  app.click('add-package');
  assert.equal(app.document.querySelectorAll('#package-rows .editor-row').length, before + 1);
  app.click('download-json');
  assert.equal(app.downloads.length, 1);
  assert.match(app.$('editor-status').textContent, /اسم وسعر/);
  app.document.querySelector('#package-rows .editor-row:last-child .remove').dispatchEvent(new app.window.Event('click'));
  app.click('download-json');
  assert.equal(app.downloads.length, 2);
});

test('a downloaded JSON backup can be imported and edited without executing code', async () => {
  const app = editor();
  app.$('site-name').value = 'النسخة الاحتياطية';
  app.click('download-json');
  const json = app.downloads[0].content;
  app.$('site-name').value = 'تعديل مؤقت';
  await app.importFile({ name: 'network-config-2027.json', size: Buffer.byteLength(json), text: async () => json });
  assert.equal(app.$('site-name').value, 'النسخة الاحتياطية');
  assert.match(app.$('editor-status').textContent, /تم استيراد/);
  assert.equal(app.downloads.length, 1);
  app.click('download-js');
  assert.equal(app.downloads.length, 2);
});

test('the editor refuses JavaScript imports and oversized files without reading their content', async () => {
  const app = editor();
  let reads = 0;
  const read = async () => { reads++; return 'window.siteConfig = {};'; };
  await app.importFile({ name: 'config.js', size: 20, text: read });
  assert.match(app.$('editor-status').textContent, /JSON فقط/);
  await app.importFile({ name: 'config.json', size: 262145, text: read });
  assert.match(app.$('editor-status').textContent, /256/);
  assert.equal(reads, 0);
  assert.equal(app.downloads.length, 0);
});

test('payment guide visibility and wallet network code round-trip through settings exports', () => {
  const app = editor({ imageV: true, paymentNetworkCode: '20810' });
  assert.equal(app.$('banner-visible').checked, true);
  assert.equal(app.$('payment-network-code').value, '20810');
  app.$('payment-network-code').value = '702027';
  app.click('download-json');
  let config = JSON.parse(app.downloads[0].content);
  assert.equal(config.imageV, true);
  assert.equal(config.paymentNetworkCode, '702027');
  app.$('payment-network-code').value = 'bad-code';
  app.click('download-js');
  assert.equal(app.downloads.length, 1);
  assert.match(app.$('editor-status').textContent, /كود شبكة/);
  app.$('banner-visible').checked = false;
  app.click('download-json');
  assert.equal(app.downloads.length, 2);
  config = JSON.parse(app.downloads[1].content);
  assert.equal(config.imageV, false);
});
