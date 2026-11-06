(function () {
  'use strict';

  var config = window.portalConfig || {};
  var preview = document.body.dataset.preview === 'true';
  var memoryKey = 'hala.portal.v2.cards';
  var preferenceKey = 'hala.portal.v2.options';
  var toastTimer;
  var reconnectTimer;
  var $ = function (id) { return document.getElementById(id); };

  function read(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch (error) { return fallback; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { return false; }
  }

  function notify(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').hidden = true; }, 6000);
  }

  function node(tag, text, className) {
    var element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function array(value) { return Array.isArray(value) ? value : []; }

  function safeUrl(value) {
    try {
      var url = new URL(value, location.href);
      return /^(https?:)$/.test(url.protocol) ? url.href : '#';
    } catch (error) { return '#'; }
  }

  function normalize(value) {
    return value.replace(/[٠-٩۰-۹]/g, function (digit) {
      var index = '٠١٢٣٤٥٦٧٨٩'.indexOf(digit);
      return String(index === -1 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) : index);
    }).replace(/\s/g, '');
  }

  function dialog(title) {
    $('sheet-title').textContent = title;
    $('sheet-content').replaceChildren();
    if (!$('sheet').open) {
      if (typeof $('sheet').showModal === 'function') $('sheet').showModal();
      else $('sheet').setAttribute('open', '');
    }
    return $('sheet-content');
  }

  function closeDialog() {
    if (typeof $('sheet').close === 'function') $('sheet').close();
    else $('sheet').removeAttribute('open');
  }

  function list(items, parent) {
    var ul = node('ul', undefined, 'info-list');
    array(items).forEach(function (item) { ul.appendChild(node('li', item)); });
    parent.appendChild(ul);
  }

  function openSection(section) {
    var box;
    if (section === 'packages') {
      box = dialog('باقة لكل يوم');
      var grid = node('div', undefined, 'packages');
      array(config.packages).forEach(function (pack) {
        var card = node('article', undefined, 'package');
        card.appendChild(node('h3', pack.title));
        card.appendChild(node('strong', pack.price));
        card.appendChild(node('p', 'البيانات: ' + pack.size));
        card.appendChild(node('p', 'وقت الاستخدام: ' + pack.time));
        card.appendChild(node('p', 'السرعة: ' + pack.speed));
        grid.appendChild(card);
      });
      box.appendChild(grid);
      box.appendChild(node('p', config.offers || '', 'sheet-note'));
    } else if (section === 'sales') {
      box = dialog('كرتك قريب منك');
      list(config.salesPoints, box);
    } else {
      box = dialog('اتصالك يبدأ من هنا');
      box.appendChild(node('p', 'اختر السرعة التي تناسبك، ثم أدخل رقم الكرت فقط واضغط «دخول الإنترنت».', 'sheet-note'));
      list(config.notes, box);
      box.appendChild(node('p', 'لحفظ رقم الكرت فعّل «حفظ الكرت على جهازي». لا تستخدم الحفظ على جهاز مشترك.'));
      box.appendChild(node('p', 'لتغيير السرعة بعد الدخول، سجّل الخروج ثم اختر سرعتك الجديدة وادخل بالكرت نفسه.'));
      if (config.externalTvUrl) {
        var link = node('a', 'التلفزيون عبر الإنترنت ↗', 'secondary');
        link.href = safeUrl(config.externalTvUrl);
        link.rel = 'noopener';
        link.target = '_blank';
        box.appendChild(link);
      }
    }
  }

  document.querySelectorAll('[data-name]').forEach(function (element) {
    element.textContent = config.siteName || 'هلا نت';
  });
  document.title = (config.siteName || 'هلا نت') + ' | اتصال على كيفك';
  if ($('announcement')) $('announcement').textContent = config.announcement || '';
  if ($('stream')) $('stream').href = safeUrl(config.streamUrl);

  var savedTheme = read('hala.portal.v2.dark', null);
  var dark = typeof savedTheme === 'boolean' ? savedTheme : config.defaultTheme === 'dark';
  document.body.classList.toggle('dark', dark);
  $('theme').setAttribute('aria-pressed', String(dark));
  $('theme').addEventListener('click', function () {
    var enabled = document.body.classList.toggle('dark');
    this.setAttribute('aria-pressed', String(enabled));
    write('hala.portal.v2.dark', enabled);
  });

  document.querySelectorAll('[data-open]').forEach(function (button) {
    button.addEventListener('click', function () { openSection(button.dataset.open); });
  });
  $('close-sheet').addEventListener('click', closeDialog);
  $('sheet').addEventListener('click', function (event) {
    if (event.target !== $('sheet')) return;
    var rect = $('sheet').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && $('sheet').open) closeDialog();
  });

  if ($('forget')) $('forget').addEventListener('click', function () {
    if (write(memoryKey, [])) notify('تم حذف الكروت المحفوظة من هذا المتصفح');
    else notify('تعذّر تعديل تخزين المتصفح. احذف بيانات الموقع من إعدادات المتصفح.');
  });

  document.querySelectorAll('[data-bytes]').forEach(function (element) {
    var raw = element.dataset.bytes;
    var value = Number(raw);
    if (!raw || !isFinite(value) || value < 0) { element.textContent = 'غير محدد'; return; }
    var units = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت', 'تيرابايت'];
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    element.textContent = value.toLocaleString('ar', { maximumFractionDigits: 1 }) + ' ' + units[unit];
  });
  document.querySelectorAll('[data-time-left]').forEach(function (element) {
    if (!element.textContent.trim()) element.textContent = 'غير محدد';
  });
  if ($('account-card')) {
    var account = $('account-card').textContent;
    $('account-card').textContent = account.slice(0, 4) + '••••';
  }

  if ($('account-speed')) {
    var domainSpeed = $('account-speed').dataset.domain.split('|')[0];
    var currentSpeed = array(config.speeds).find(function (speed) { return speed.value === domainSpeed; });
    $('account-speed').textContent = currentSpeed ? currentSpeed.name : 'غير محدد';
  }

  var form = $('login-form');
  if (!form) return;

  var speeds = array(config.speeds).filter(function (speed) {
    return speed && speed.visible !== false && typeof speed.value === 'string' && speed.value.length > 0;
  });
  var preference = read(preferenceKey, {});
  if (!preference || typeof preference !== 'object') preference = {};
  var selected = speeds.find(function (speed) { return speed.value === preference.speed; }) ||
    speeds.find(function (speed) { return speed.default; }) || speeds[0];

  function syncDomain() {
    $('domain').value = $('speed').value + '|' +
      (config.updateBlockingEnabled !== false && $('updates').checked ? '*yes**' : '*no**');
  }

  speeds.forEach(function (speed, index) {
    var label = node('label', undefined, 'speed-choice');
    var input = node('input');
    input.type = 'radio';
    input.name = 'portal-speed';
    input.value = speed.value;
    input.id = 'speed-choice-' + index;
    input.checked = speed === selected;
    var tile = node('span', undefined, 'speed-tile');
    var copy = node('span', undefined, 'speed-copy');
    copy.appendChild(node('strong', speed.name));
    var value = node('small', speed.value);
    value.dir = 'ltr';
    copy.appendChild(value);
    tile.appendChild(copy);
    var indicator = node('span', undefined, 'speed-indicator');
    indicator.setAttribute('aria-hidden', 'true');
    tile.appendChild(indicator);
    label.appendChild(input);
    label.appendChild(tile);
    $('speed-options').appendChild(label);
    input.addEventListener('change', function () { $('speed').value = this.value; syncDomain(); });
  });
  $('speed').value = selected ? selected.value : '';
  $('updates').checked = !!preference.updates;
  if (config.updateBlockingEnabled === false) $('updates').closest('details').hidden = true;
  $('updates').addEventListener('change', syncDomain);
  syncDomain();
  $('submit').disabled = !speeds.length;
  if (!speeds.length) notify('لم يتم إعداد سرعات الشبكة. يرجى مراجعة المسؤول.');

  $('card').addEventListener('input', function () { this.value = normalize(this.value); });

  $('saved').addEventListener('click', function () {
    var box = dialog('كروتك المحفوظة');
    var cards = array(read(memoryKey, [])).filter(function (card) { return typeof card === 'string'; });
    if (!cards.length) box.appendChild(node('p', 'لا توجد كروت محفوظة. فعّل «حفظ الكرت على جهازي» عند الدخول.'));
    cards.forEach(function (card) {
      var button = node('button', card.slice(0, 4) + '•••• · استخدام الكرت', 'saved-card');
      button.type = 'button';
      button.addEventListener('click', function () {
        $('card').value = card;
        $('remember').checked = true;
        closeDialog();
        $('card').focus();
      });
      box.appendChild(button);
    });
    var clear = node('button', 'حذف جميع الكروت', 'secondary');
    clear.type = 'button';
    clear.addEventListener('click', function () {
      var ok = write(memoryKey, []);
      closeDialog();
      notify(ok ? 'تم حذف الكروت المحفوظة' : 'تعذّر الحذف. احذف بيانات الموقع من إعدادات المتصفح.');
    });
    box.appendChild(clear);
  });

  function cardFromQR(raw) {
    var text = raw.trim();
    var card = text;
    try {
      var url = new URL(text);
      card = url.searchParams.get('username') || url.searchParams.get('card') || '';
    } catch (error) {
      if (text.charAt(0) === '{') {
        var data = JSON.parse(text);
        card = data.username || data.card || '';
      }
    }
    // Cards are usernames only. Password fields in old QR codes are intentionally ignored.
    if (typeof card !== 'string' && typeof card !== 'number') throw Error('Invalid card');
    card = normalize(String(card));
    if (!card || card.length > 128) throw Error('Invalid card');
    return card;
  }

  function imageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(Error('Invalid image')); };
      image.src = url;
    });
  }

  async function decodeQR(file) {
    if (file.size > 15 * 1024 * 1024) throw Error('Image too large');
    var image = await imageFromFile(file);
    if ('BarcodeDetector' in window) {
      try {
        var results = await new BarcodeDetector({ formats: ['qr_code'] }).detect(image);
        if (results.length) return results[0].rawValue;
      } catch (error) { /* The local decoder below also works on HTTP captive portals. */ }
    }
    if (typeof window.jsQR !== 'function') throw Error('QR decoder unavailable');
    var scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    var context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw Error('Canvas unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    var pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    var result = window.jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
    if (!result) throw Error('No QR found');
    return result.data;
  }

  $('scan').addEventListener('click', function () {
    var box = dialog('امسح كرتك');
    box.appendChild(node('p', 'التقط صورة واضحة لكود QR أو اختر صورة من جهازك. تُقرأ الصورة محلياً دون رفعها إلى خادم.', 'sheet-note'));
    var input = node('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.className = 'scan-input';
    input.setAttribute('aria-label', 'اختر صورة كود الكرت أو التقطها');
    box.appendChild(input);
    var result = node('p', 'بعد القراءة راجع رقم الكرت، ثم اضغط دخول الإنترنت.');
    result.setAttribute('role', 'status');
    box.appendChild(result);
    input.addEventListener('change', async function () {
      if (!input.files[0]) return;
      input.disabled = true;
      result.textContent = 'جارٍ قراءة الكرت…';
      try {
        $('card').value = cardFromQR(await decodeQR(input.files[0]));
        closeDialog();
        $('card').focus();
        notify('تمت قراءة رقم الكرت. اختر سرعتك ثم اضغط دخول الإنترنت.');
      } catch (error) {
        result.textContent = 'تعذّرت القراءة. اختر صورة أوضح بحجم أقل من 15 ميجابايت، أو أدخل الرقم يدوياً.';
      } finally { input.disabled = false; }
    });
  });

  var error = $('login-error');
  var message = error.textContent.trim();
  if (message && !message.includes('$(')) {
    var translations = [
      [/invalid username|invalid password|not found/i, 'رقم الكرت غير صحيح. راجع الرقم وحاول مجدداً.'],
      [/simultaneous|no more sessions/i, 'هذا الكرت مستخدم على جهاز آخر.'],
      [/uptime limit|no more online time/i, 'انتهى وقت الكرت.'],
      [/traffic limit|transfer limit/i, 'انتهى رصيد الكرت.'],
      [/no valid profile/i, 'انتهت صلاحية الكرت.']
    ];
    translations.some(function (translation) {
      if (translation[0].test(message)) { message = translation[1]; return true; }
      return false;
    });
    error.textContent = message;
    error.hidden = false;
  }

  function restoreSubmit() {
    clearTimeout(reconnectTimer);
    $('auth-password').value = '';
    $('submit').disabled = !speeds.length;
    $('submit').querySelector('span').textContent = 'دخول الإنترنت';
    $('submit').removeAttribute('aria-busy');
  }

  form.addEventListener('submit', function (event) {
    $('card').value = normalize($('card').value);
    $('auth-password').value = '';
    if (!$('card').value) { event.preventDefault(); $('card').focus(); return; }
    if (preview) {
      event.preventDefault();
      notify('هذه معاينة فقط. الدخول الفعلي برقم الكرت متاح من داخل شبكة الهوتسبوت.');
      return;
    }
    if (!speeds.some(function (speed) { return speed.value === $('speed').value; })) {
      event.preventDefault(); notify('اختر سرعة متاحة.'); return;
    }
    if (!form.getAttribute('action') || form.getAttribute('action').includes('$(')) {
      event.preventDefault(); notify('افتح صفحة الدخول من داخل شبكة الهوتسبوت.'); return;
    }
    syncDomain();
    write(preferenceKey, { speed: $('speed').value, updates: $('updates').checked });
    var cards = array(read(memoryKey, [])).filter(function (card) {
      return typeof card === 'string' && card !== $('card').value;
    });
    if ($('remember').checked) cards.unshift($('card').value);
    if (!write(memoryKey, cards.slice(0, 5)) && $('remember').checked) {
      notify('المتصفح لا يسمح بحفظ الكرت، سيستمر تسجيل الدخول.');
    }
    // Username-only accounts have an EMPTY password, never a copy of the card number.
    if (window.hotspotChap) {
      if (typeof window.hotspotMD5 !== 'function') {
        event.preventDefault(); notify('تعذّر تحميل ملف تسجيل الدخول. حدّث الصفحة وحاول مجدداً.'); return;
      }
      $('auth-password').value = window.hotspotMD5(window.hotspotChap.id + window.hotspotChap.challenge);
    }
    $('submit').disabled = true;
    $('submit').setAttribute('aria-busy', 'true');
    $('submit').querySelector('span').textContent = 'جارٍ الاتصال…';
    reconnectTimer = setTimeout(restoreSubmit, 12000);
  });
  window.addEventListener('pageshow', restoreSubmit);
})();
