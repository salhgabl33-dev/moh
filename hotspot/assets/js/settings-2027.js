/* Hala Net 2027: local configuration editor. No remote writes or dynamic code evaluation. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var initial = window.siteConfig;
  var base = {};
  var sequence = 0;
  var fields = {
    siteName: 'site-name', location: 'location', textSlider1: 'intro', offers: 'offers',
    welcomeMessage: 'welcome-message', supportPhone: 'support-phone', countryCode: 'country-code',
    moba: 'stream-url', estr: 'lounge-url', refreshSeconds: 'refresh-seconds', requestTimeoutMs: 'request-timeout',
    paymentNetworkCode: 'payment-network-code'
  };

  function status(message, error) {
    var node = $('editor-status');
    node.textContent = message;
    node.dataset.error = error ? 'true' : 'false';
    if (error) node.focus();
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function field(row, key, label, value, options) {
    options = options || {};
    var wrapper = element('label');
    var input = document.createElement('input');
    input.type = options.type || 'text';
    input.id = 'setting-' + (++sequence);
    input.dataset.key = key;
    input.value = value == null ? '' : String(value);
    input.maxLength = options.maxLength || 150;
    if (options.dir) input.dir = options.dir;
    wrapper.htmlFor = input.id;
    wrapper.appendChild(element('span', '', label));
    wrapper.appendChild(input);
    row.appendChild(wrapper);
    return input;
  }
  function check(parent, key, label, checked, type) {
    var wrapper = element('label');
    var input = document.createElement('input');
    input.type = type || 'checkbox';
    input.dataset.key = key;
    input.id = 'setting-' + (++sequence);
    input.checked = Boolean(checked);
    if (type === 'radio') input.name = 'default-speed';
    wrapper.htmlFor = input.id;
    wrapper.appendChild(input);
    wrapper.appendChild(element('span', '', label));
    parent.appendChild(wrapper);
    return input;
  }
  function removeButton(row, name) {
    var button = element('button', 'editor-button remove', 'حذف');
    button.type = 'button';
    button.setAttribute('aria-label', 'حذف ' + name);
    button.addEventListener('click', function () { row.remove(); });
    return button;
  }
  function addSpeed(speed) {
    speed = speed || { name: '', value: '', default: false, visible: true };
    var row = element('div', 'editor-row speed');
    row._source = clone(speed);
    field(row, 'name', 'اسم السرعة', speed.name);
    field(row, 'value', 'قيمة الرفع / التنزيل', speed.value, { dir: 'ltr', maxLength: 40 });
    var options = element('div', 'row-options');
    check(options, 'visible', 'ظاهرة', speed.visible !== false);
    check(options, 'default', 'افتراضية', speed.default, 'radio');
    options.appendChild(removeButton(row, 'السرعة'));
    row.appendChild(options);
    $('speed-rows').appendChild(row);
    return row;
  }
  function addPackage(pkg) {
    pkg = pkg || {};
    var row = element('div', 'editor-row package');
    row._source = clone(pkg);
    field(row, 'title', 'اسم الباقة', pkg.title);
    field(row, 'price', 'السعر', pkg.price);
    field(row, 'size', 'حجم البيانات', pkg.size);
    field(row, 'time', 'مدة الاستخدام', pkg.time);
    field(row, 'speed', 'وصف السرعة', pkg.speed);
    row.appendChild(removeButton(row, 'الباقة'));
    $('package-rows').appendChild(row);
    return row;
  }
  function validateObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ملف الإعدادات يجب أن يحتوي على كائن JSON.');
    if (typeof value.siteName !== 'string' || !value.siteName.trim()) throw new Error('اسم الشبكة مطلوب في ملف JSON.');
    if (!Array.isArray(value.speedOptions) || !value.speedOptions.length || value.speedOptions.length > 30) throw new Error('يجب أن يحتوي الملف على 1 إلى 30 خيار سرعة.');
    if (!Array.isArray(value.packages) || value.packages.length > 100) throw new Error('قائمة الباقات غير صالحة أو كبيرة جداً.');
    value.speedOptions.forEach(function (speed) {
      if (!speed || typeof speed !== 'object' || typeof speed.name !== 'string' || typeof speed.value !== 'string') throw new Error('تنسيق خيارات السرعة غير صالح.');
    });
    value.packages.forEach(function (pkg) {
      if (!pkg || typeof pkg !== 'object' || typeof pkg.title !== 'string' || typeof pkg.price !== 'string') throw new Error('كل باقة يجب أن تحتوي على اسم وسعر نصيين.');
    });
    ['salesPoints', 'note'].forEach(function (key) {
      if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some(function (item) { return typeof item !== 'string'; }))) throw new Error('قائمة نقاط البيع أو التعليمات غير صالحة.');
    });
    return value;
  }
  function load(config) {
    validateObject(config);
    base = clone(config);
    Object.keys(fields).forEach(function (key) {
      var fallback = key === 'refreshSeconds' ? 15 : key === 'requestTimeoutMs' ? 12000 : '';
      $(fields[key]).value = config[key] == null ? fallback : config[key];
    });
    $('welcome-visible').checked = Boolean(config.welcomeMessageV);
    $('banner-visible').checked = Boolean(config.imageV);
    $('sales-points').value = (config.salesPoints || []).join('\n');
    $('network-notes').value = (config.note || []).join('\n');
    $('speed-rows').replaceChildren();
    $('package-rows').replaceChildren();
    config.speedOptions.forEach(addSpeed);
    config.packages.forEach(addPackage);
    $('generated-code').value = '';
    document.title = 'محرر إعدادات ' + config.siteName + ' · 2027';
  }
  function rows(container) {
    return Array.prototype.map.call($(container).children, function (row) {
      var data = { ...row._source };
      Array.prototype.forEach.call(row.querySelectorAll('[data-key]'), function (input) {
        data[input.dataset.key] = input.type === 'checkbox' || input.type === 'radio' ? input.checked : input.value.trim();
      });
      return data;
    });
  }
  function lines(id) { return $(id).value.split(/\r?\n/).map(function (text) { return text.trim(); }).filter(Boolean); }
  function serviceURL(value, label) {
    if (!value) return;
    try {
      var url = new URL(value);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('invalid');
    } catch (_) { throw new Error(label + ': استخدم رابط http أو https كاملاً بدون بيانات دخول.'); }
  }
  function read() {
    var result = { ...base };
    Object.keys(fields).forEach(function (key) { result[key] = $(fields[key]).value.trim(); });
    if (!result.siteName) throw new Error('أدخل اسم الشبكة قبل التنزيل.');
    if (result.siteName.length > 80) throw new Error('اسم الشبكة يجب ألا يتجاوز 80 حرفاً.');
    serviceURL(result.moba, 'رابط البث المباشر');
    serviceURL(result.estr, 'رابط الاستراحة');
    if (result.supportPhone && !/^[+\d()\s-]{3,30}$/.test(result.supportPhone)) throw new Error('تحقق من رقم هاتف الدعم.');
    if (result.countryCode && !/^\+?\d{1,5}$/.test(result.countryCode)) throw new Error('مفتاح الدولة يجب أن يتكون من أرقام، مثال 967.');
    result.refreshSeconds = Number(result.refreshSeconds);
    result.requestTimeoutMs = Number(result.requestTimeoutMs);
    if (!Number.isInteger(result.refreshSeconds) || result.refreshSeconds < 5 || result.refreshSeconds > 300) throw new Error('فترة تحديث الحالة يجب أن تكون بين 5 و300 ثانية.');
    if (!Number.isInteger(result.requestTimeoutMs) || result.requestTimeoutMs < 3000 || result.requestTimeoutMs > 30000) throw new Error('مهلة الطلب يجب أن تكون بين 3000 و30000 مللي ثانية.');
    result.welcomeMessageV = $('welcome-visible').checked;
    result.imageV = $('banner-visible').checked;
    if(result.imageV && !/^\d{1,20}$/.test(result.paymentNetworkCode)) throw new Error('أدخل كود شبكة صحيحاً لمحفظة شلن.');
    result.salesPoints = lines('sales-points');
    result.note = lines('network-notes');
    result.speedOptions = rows('speed-rows');
    result.packages = rows('package-rows');
    validateObject(result);
    var visible = result.speedOptions.filter(function (speed) { return speed.visible; });
    if (!visible.length) throw new Error('اختر سرعة ظاهرة واحدة على الأقل.');
    var defaults = result.speedOptions.filter(function (speed) { return speed.default; });
    if (defaults.length !== 1 || !defaults[0].visible) throw new Error('اختر سرعة افتراضية واحدة واجعلها ظاهرة.');
    var values = new Set();
    result.speedOptions.forEach(function (speed) {
      if (!speed.name.trim()) throw new Error('كل سرعة تحتاج إلى اسم.');
      if (!/^(?:0\/0|[1-9]\d*[kKmM]\/[1-9]\d*[kKmM])$/.test(speed.value)) throw new Error('قيمة السرعة غير صالحة: استخدم صيغة مثل 2M/4M أو 512K/1M.');
      if (values.has(speed.value.toUpperCase())) throw new Error('توجد قيم سرعة مكررة.');
      values.add(speed.value.toUpperCase());
    });
    result.packages.forEach(function (pkg) {
      if (!pkg.title.trim() || !pkg.price.trim()) throw new Error('كل باقة تحتاج إلى اسم وسعر.');
    });
    return result;
  }
  function stringify(config) {
    return JSON.stringify(config, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  }
  function script(config) { return '/* Hala Net Hotspot 2027 — editable network configuration */\nwindow.siteConfig = ' + stringify(config) + ';\n'; }
  function validated() {
    try {
      var config = read();
      $('generated-code').value = script(config);
      status('الإعدادات صالحة. راجع الملف ثم استبدله في مجلد أصول البوابة بعد التنزيل.', false);
      return config;
    } catch (error) { status(error.message, true); return null; }
  }
  function download(content, name, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  $('settings-form').addEventListener('submit', function (event) { event.preventDefault(); validated(); });
  $('add-speed').addEventListener('click', function () { addSpeed().querySelector('input').focus(); });
  $('add-package').addEventListener('click', function () { addPackage().querySelector('input').focus(); });
  $('preview-config').addEventListener('click', validated);
  $('download-js').addEventListener('click', function () {
    var config = validated();
    if (config) download(script(config), 'network-config-2027.js', 'text/javascript;charset=utf-8');
  });
  $('download-json').addEventListener('click', function () {
    var config = validated();
    if (config) download(stringify(config) + '\n', 'network-config-2027.json', 'application/json;charset=utf-8');
  });
  $('import-json').addEventListener('change', async function () {
    var file = this.files && this.files[0];
    if (!file) return;
    try {
      if (file.size > 262144) throw new Error('ملف الإعدادات أكبر من الحد المسموح (256 كيلوبايت).');
      if (!/\.json$/i.test(file.name)) throw new Error('اختر نسخة JSON فقط. لا يتم تشغيل ملفات JavaScript داخل المحرر.');
      var config = JSON.parse(await file.text());
      validateObject(config);
      load(config);
      status('تم استيراد الإعدادات إلى المحرر فقط. راجع الحقول ثم نزّل الملف المحدّث.', false);
    } catch (error) { status('تعذر الاستيراد: ' + error.message, true); }
    this.value = '';
  });
  try { load(initial); } catch (error) { status('تعذر تحميل الإعدادات الأصلية: ' + error.message, true); }
}());
