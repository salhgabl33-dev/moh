(function () {
  "use strict";
  var config = window.siteConfig || {};
  var $ = function (id) { return document.getElementById(id); };
  var text = function (id, value) { if ($(id)) $(id).textContent = value; };
  var visible = function (id, show) { if ($(id)) $(id).hidden = !show; };
  var on = function (id, event, handler) { if ($(id)) $(id).addEventListener(event, handler); };
  var store = {
    get: function (key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set: function (key, value) { try { localStorage.setItem(key, value); } catch (_) {} },
    remove: function (key) { try { localStorage.removeItem(key); } catch (_) {} }
  };
  // Remove password records left by the previous template; never migrate secrets.
  store.remove("usernamesAndPasswords");
  ["password", "username", "speed"].forEach(function (key) {
    document.cookie = key + "=; Max-Age=0; path=/; SameSite=Lax";
  });
  var preview = new URLSearchParams(location.search).get("preview") === "1" || location.protocol === "file:";
  var state = { loggedIn: false, busy: false, timer: null, polling: false, epoch: 0, selectedSpeed: "", username: "", chapId: "", challenge: "", loginUrl: "/login", statusUrl: "/status", logoutUrl: "/logout", dst: "" };
  var actions = ["onLoginStart", "onLoginError", "onLoggedIn", "onLoggedOut", "onStatusQuery"];
  var speeds = (config.speedOptions || []).filter(function (s) { return s.visible && /^\d+(?:\.\d+)?[kKmM]?\/\d+(?:\.\d+)?[kKmM]?$/.test(s.value); });
  var initialSpeed = speeds.find(function (s) { return s.default; }) || speeds[0];
  state.selectedSpeed = initialSpeed ? initialSpeed.value : "";
  function node(tag, className, value) {
    var item = document.createElement(tag);
    if (className) item.className = className;
    if (value !== undefined) item.textContent = value;
    return item;
  }
  function safeLink(value) {
    if(typeof value !== "string" || !value.trim()) return "";
    try { var url = new URL(value, location.href); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ""; } catch (_) { return ""; }
  }
  function normalizeCard(value) {
    return value.replace(/[٠-٩]/g,function (digit) { return String(digit.charCodeAt(0)-1632); }).replace(/[۰-۹]/g,function (digit) { return String(digit.charCodeAt(0)-1776); }).replace(/\s/g,"");
  }
  function endpoint(value, fallback) {
    var clean = safeLink(value);
    if (!clean || new URL(clean).origin !== location.origin) return new URL(fallback, location.origin).href;
    return clean;
  }
  function decode(value) { try { return decodeURIComponent(value || ""); } catch (_) { return value || ""; } }
  function chapBytes(value) { return value.replace(/\\([0-7]{1,3})/g, function (_, n) { return String.fromCharCode(parseInt(n, 8)); }).replace(/\\x([\da-f]{2})/gi,function (_,n) { return String.fromCharCode(parseInt(n,16)); }); }
  function renderConfig() {
    document.title = (config.siteName || "شبكتي") + " | 2027";
    document.querySelectorAll("[data-site-name]").forEach(function (el) { el.textContent = config.siteName || "شبكتي"; });
    document.querySelectorAll("[data-site-description]").forEach(function (el) { el.textContent = config.textSlider1 || ""; });
    text("offers-text", config.offers || "");
    visible("payment-guide",Boolean(config.imageV));
    text("payment-network-code",config.paymentNetworkCode || "20810");
    [ ["sales-points", config.salesPoints], ["network-notes", config.note] ].forEach(function (entry) {
      if (!$(entry[0])) return;
      $(entry[0]).replaceChildren();
      (entry[1] || []).forEach(function (value) { $(entry[0]).appendChild(node("li", "", value)); });
    });
    if ($("packages-grid")) (config.packages || []).forEach(function (pkg) {
      var card=node("article","package-card");
      card.appendChild(node("h3","package-title",pkg.title));
      card.appendChild(node("p","package-price",pkg.price));
      card.appendChild(node("p","package-size",pkg.size));
      card.appendChild(node("p","package-meta","الوقت: " + pkg.time + " · السرعة: " + pkg.speed));
      $("packages-grid").appendChild(card);
    });
    speeds.forEach(function (speed) {
      var button=node("button","speed-option",speed.name);
      button.type="button"; button.value=speed.value;
      button.setAttribute("aria-label",speed.name + "، رفع " + speed.value.split("/")[0] + " وتنزيل " + speed.value.split("/")[1]);
      var download=speed.value.split("/")[1];
      button.appendChild(node("span","speed-value",download.replace(/M$/i," Mbps").replace(/K$/i," Kbps")));
      button.setAttribute("aria-pressed",String(speed.value === state.selectedSpeed));
      button.classList.toggle("active",speed.value === state.selectedSpeed);
      button.addEventListener("click",function () {
        state.selectedSpeed=speed.value;
        document.querySelectorAll("#speed-options button").forEach(function (item) {
          item.classList.toggle("active",item === button); item.setAttribute("aria-pressed",String(item === button));
        });
        updateDomain();
      });
      if ($("speed-options")) $("speed-options").appendChild(button);
    });
    [ ["stream-link", config.moba], ["lounge-link", config.estr] ].forEach(function (entry) {
      var link=$(entry[0]), url=safeLink(entry[1]);
      if (link) { if (url) link.href=url; else link.hidden=true; }
    });
    var phone=String(config.supportPhone || "").replace(/\D/g,"");
    var international=(String(config.countryCode || "").replace(/\D/g,"") + phone.replace(/^0/,""));
    document.querySelectorAll("[data-support-phone]").forEach(function (el) { var label=el.querySelector("span") || el; label.textContent=phone; label.dir="ltr"; el.hidden=!phone; if (el.tagName === "A" && phone) el.href="tel:+"+international; });
    document.querySelectorAll("[data-support-whatsapp]").forEach(function (el) { el.hidden=!phone; if(phone) el.href="https://wa.me/"+international; });
    document.querySelectorAll("[data-location]").forEach(function (el) { el.textContent=config.location || ""; el.hidden=!config.location; });
    updateDomain();
  }
  function updateDomain() {
    if ($("login-domain")) $("login-domain").value=state.selectedSpeed + "|" + ($("data-saver") && $("data-saver").checked ? "*yes**" : "*no**");
    var selected=speeds.find(function (speed) { return speed.value === state.selectedSpeed; });
    text("selected-speed",selected ? "تم اختيار سرعة " + selected.name : "اختر السرعة المناسبة لك");
    text("data-saver-state",$("data-saver") && $("data-saver").checked ? "مُفعّل" : "ملغي");
  }
  function savedCards() {
    try { var values=JSON.parse(store.get("hala2027.cards") || "[]"); return Array.isArray(values) ? values.filter(function (v) { return typeof v === "string" && v.length <= 128; }).slice(-5) : []; } catch (_) { return []; }
  }
  function renderCards() {
    var select=$("saved-cards"); if (!select) return;
    select.replaceChildren(node("option","","الكروت المحفوظة على هذا الجهاز")); select.firstChild.value="";
    var cards=savedCards();
    cards.slice().reverse().forEach(function (card) {
      var option=node("option","",card.length>4 ? "•••• " + card.slice(-4) : "كرت محفوظ"); option.value=card; select.appendChild(option);
    });
    select.disabled=cards.length === 0;
    visible("saved-cards-row",cards.length > 0);
    if ($("forget-cards")) $("forget-cards").disabled=cards.length === 0;
  }
  function saveCard(username) {
    if (!$('save-card') || !$('save-card').checked || preview) return;
    var cards=savedCards().filter(function (v) { return v !== username; });
    cards.push(username); store.set("hala2027.cards",JSON.stringify(cards.slice(-5))); renderCards();
  }
  function notice(message) { text("portal-notice",message); visible("portal-notice",!!message); }
  function error(message) { text("login-error",message); visible("login-error",!!message); if(message && $("login-error")) $("login-error").focus(); }
  function busy(value) {
    state.busy=value; if ($("login-submit")) { $("login-submit").disabled=value; $("login-submit").setAttribute("aria-busy",String(value)); var label=$("login-submit").querySelector("span") || $("login-submit"); label.textContent=value ? "جارٍ الاتصال…" : "دخول الإنترنت"; }
    if ($("login-form")) $("login-form").setAttribute("aria-busy",String(value));
  }
  function friendlyError(value) {
    var errors=[[/invalid password/i,"كلمة المرور غير صحيحة. راجع بيانات الكرت."], [/invalid username|not found|invalid user/i,"رقم الكرت أو كلمة المرور غير صحيحة."], [/session limit|no more sessions|already authoriz/i,"الكرت مستخدم حالياً. اقطع الاتصال من الجهاز الآخر أولاً."], [/uptime limit|no more online time/i,"انتهى الوقت المتاح لهذا الكرت."], [/traffic limit|transfer limit/i,"انتهى رصيد البيانات لهذا الكرت."], [/no valid profile/i,"انتهت صلاحية الكرت. تواصل مع نقطة البيع."], [/not responding/i,"خادم الدخول لا يستجيب الآن. حاول بعد قليل."], [/calling.station/i,"هذا الكرت مرتبط بجهاز آخر."]];
    var match=errors.find(function (entry) { return entry[0].test(value); });
    return match ? match[1] : "تعذر تسجيل الدخول. " + (value || "راجع بيانات الكرت وحاول مرة أخرى.");
  }
  function parseResponse(html) {
    var doc=new DOMParser().parseFromString(html,"text/html"), el=doc.getElementById("router-response");
    if (!el || actions.indexOf(el.dataset.action) < 0) throw new Error("تعذر قراءة استجابة الراوتر. تأكد من رفع قوالب 2027 كاملة.");
    var data={};
    Object.keys(el.dataset).forEach(function (key) { data[key]=decode(el.dataset[key]); });
    var chapId=doc.getElementById("router-chap-id"), challenge=doc.getElementById("router-chap-challenge");
    if(chapId && challenge) { state.chapId=chapBytes(chapId.textContent.trim()); state.challenge=chapBytes(challenge.textContent.trim()); }
    else if(data.action === "onLoginStart" || data.action === "onLoginError") { state.chapId=""; state.challenge=""; }
    [ ["loginUrl","/login"], ["statusUrl","/status"], ["logoutUrl","/logout"] ].forEach(function (entry) {
      if(data[entry[0]]) state[entry[0]]=endpoint(data[entry[0]],entry[1]);
    });
    if(data.dst) state.dst=data.dst;
    return data;
  }
  async function request(url, fields) {
    var endpointUrl=new URL(endpoint(url,"/login")); endpointUrl.searchParams.set("var","callBack");
    var controller=new AbortController();
    var timeout=setTimeout(function () { controller.abort(); },Math.max(3000,Math.min(30000,Number(config.requestTimeoutMs)||12000)));
    try {
      var response=await fetch(endpointUrl.href,{method:fields ? "POST" : "GET",body:fields ? new URLSearchParams(fields) : undefined, credentials:"same-origin",cache:"no-store",signal:controller.signal});
      if(!response.ok) throw new Error("تعذر الوصول إلى بوابة الشبكة (" + response.status + ").");
      return parseResponse(await response.text());
    } catch (err) {
      if(err.name === "AbortError") throw new Error("انتهت مهلة الاتصال. تأكد من اتصالك بشبكة الواي فاي وحاول مجدداً.");
      if(err instanceof TypeError) throw new Error("تعذر الاتصال بالراوتر. تأكد أنك متصل بشبكة الواي فاي الخاصة بنا.");
      throw err;
    } finally { clearTimeout(timeout); }
  }
  function bytes(value) {
    if(value === "" || value === undefined || value === null) return "غير متاح";
    var n=Number(value); if(!Number.isFinite(n) || n<0) return "غير متاح";
    var units=["بايت","كيلوبايت","ميجابايت","جيجابايت","تيرابايت"], i=0;
    while(n>=1024 && i<units.length-1){n/=1024;i++;}
    return (i ? n.toFixed(1) : n.toFixed(0)) + " " + units[i];
  }
  function time(value) {
    if (!value) return "غير محدد";
    var result=value.replace(/(\d+)w/g,"$1 أسبوع ").replace(/(\d+)d/g,"$1 يوم ").replace(/(\d+)h/g,"$1 ساعة ").replace(/(\d+)m/g,"$1 دقيقة ").replace(/(\d+)s/g,"$1 ثانية ");
    return result.trim();
  }
  function stopPolling() { clearTimeout(state.timer); state.timer=null; }
  function schedulePoll() {
    stopPolling();
    if(state.loggedIn && !document.hidden && !preview) state.timer=setTimeout(refreshStatus,Math.max(5,Math.min(300,Number(config.refreshSeconds)||15))*1000);
  }
  function showLogin() {
    state.loggedIn=false; ready=false; state.chapId=""; state.challenge=""; stopPolling(); stopCamera(); visible("status-panel",false); visible("login-panel",true);
    text("connection-label",preview ? "معاينة التصميم" : "بوابة الشبكة");
  }
  function showStatus(data) {
    state.loggedIn=true; stopCamera(); visible("login-panel",false); visible("status-panel",true); error("");
    if(!preview) notice("");
    if(data.username) state.username=data.username;
    text("connection-label",preview ? "معاينة · بيانات تجريبية" : "جلسة متصلة");
    text("status-username",state.username.length>4 ? "•••• " + state.username.slice(-4) : "كرت متصل");
    text("status-ip",data.ip || "غير متاح"); text("status-uptime",time(data.uptime));
    text("status-remaining-time",time(data.remainingTime));
    text("status-download",bytes(data.bytesOut)); text("status-upload",bytes(data.bytesIn));
    text("status-remaining-data",data.remainingData === "" || data.remainingData === undefined ? "غير محدد" : bytes(data.remainingData));
    var speed=(data.domain||"").split("|")[0], item=speeds.find(function (s) { return s.value===speed; });
    text("status-speed",item ? item.name : (speed || "حسب الاشتراك"));
    text("status-message",preview ? "هذه بيانات توضيحية؛ لم يتم إنشاء اتصال بالإنترنت." : "تم تحديث بيانات الجلسة.");
    schedulePoll();
  }
  async function refreshStatus() {
    if(!state.loggedIn || state.polling || preview) return;
    state.polling=true;
    var epoch=state.epoch;
    try {
      var data=await request(state.statusUrl);
      if(epoch !== state.epoch || !state.loggedIn) return;
      if(data.loggedIn === "yes") showStatus(data);
      else { showLogin(); notice("انتهت جلسة الاتصال. يمكنك تسجيل الدخول مجدداً."); }
    } catch(err) { if(epoch === state.epoch && state.loggedIn) { text("status-message",err.message + " البيانات المعروضة من آخر تحديث ناجح."); schedulePoll(); } }
    finally { state.polling=false; }
  }
  async function bootstrap() {
    if(preview) { notice("معاينة نسخة 2027: تسجيل الدخول والرصيد بيانات تجريبية فقط، ولا ينشئان اتصالاً بالإنترنت."); return true; }
    try {
      var data=await request(state.loginUrl);
      if(data.loggedIn === "yes") { state.username=data.username || ""; showStatus(data); await refreshStatus(); }
      else if(data.action === "onLoginError") error(friendlyError(data.error));
      else {
        var initialError=new URLSearchParams(location.search).get("error");
        if(initialError) { error(friendlyError(initialError)); history.replaceState(null,"",location.pathname); }
        else if(config.welcomeMessageV && config.welcomeMessage) notice(config.welcomeMessage);
      }
      return true;
    } catch(err) { error(err.message); return false; }
  }
  var ready;
  async function login(event) {
    event.preventDefault(); if(state.busy) return;
    var username=normalizeCard($("username").value), password=$("password") ? $("password").value : "";
    $("username").value=username;
    if(!username) { error("أدخل رقم الكرت أولاً."); $("username").focus(); return; }
    if(username.length>128 || password.length>128) { error("بيانات الكرت أطول من الحد المسموح."); return; }
    if(!state.selectedSpeed) { error("لم تُضبط سرعات الشبكة. تواصل مع الدعم."); return; }
    busy(true); error(""); updateDomain();
    try {
      if(preview) {
        state.username=username;
        showStatus({username:username,ip:"192.0.2.27",uptime:"24m",remainingTime:"2h30m",bytesOut:"134217728",bytesIn:"12582912",remainingData:"939524096",domain:state.selectedSpeed});
        return;
      }
      if(!await ready) { if(!await bootstrap()) return; }
      if(state.loggedIn) return;
      var encodedPassword=state.chapId ? window.hotspotMD5(state.chapId + password + state.challenge) : password;
      var data=await request(state.loginUrl,{username:username,password:encodedPassword,domain:$("login-domain").value,dst:state.dst || "",popup:"true"});
      if(data.action === "onLoginError") { error(friendlyError(data.error)); return; }
      if(data.loggedIn !== "yes" && data.action !== "onLoggedIn") throw new Error("لم يؤكد الراوتر نجاح الدخول. حاول مرة أخرى.");
      state.username=username; saveCard(username); state.loggedIn=true;
      showStatus({username:username,domain:$("login-domain").value});
      await refreshStatus();
    } catch(err) { error(err.message); }
    finally { if($("password")) $("password").value=""; busy(false); }
  }
  async function logout(forget) {
    if(state.busy) return;
    state.busy=true; state.epoch++; stopPolling();
    try {
      if(!preview) {
        var url=new URL(endpoint(state.logoutUrl,"/logout"));
        if(forget) url.searchParams.set("erase-cookie","yes");
        var data=await request(url.href,{});
        if(data.loggedIn === "yes") throw new Error("لم يؤكد الراوتر قطع الاتصال. حاول مرة أخرى.");
      }
      if(forget){store.remove("hala2027.cards");renderCards();$("username").value="";}
      showLogin(); notice(preview ? "انتهت معاينة الجلسة التجريبية." : "تم قطع الاتصال بنجاح.");
      // Wait for the next explicit login attempt before requesting a new challenge.
      // Probing /login here could immediately restore a native cookie session.
      ready=false;
    } catch(err) { text("status-message",err.message); schedulePoll(); }
    finally { state.busy=false; }
  }
  function fillQR(raw) {
    raw=String(raw || "").trim(); var username="", password="";
    if(!raw) throw new Error("الصق محتوى رمز الكرت أولاً.");
    if(/^[{[]/.test(raw)) {
      var object=JSON.parse(raw); username=object.username || ""; password=object.password || "";
    } else if(/^https?:\/\//i.test(raw)) {
      var url=new URL(raw); username=url.searchParams.get("username") || ""; password=url.searchParams.get("password") || "";
      if(!username) throw new Error("الرابط لا يحتوي بيانات كرت. لن يتم فتح روابط من الرمز.");
    } else if(/^[\w@.+\-]{1,128}$/.test(raw)) username=raw;
    else throw new Error("صيغة الرمز غير مدعومة. أدخل رقم الكرت يدوياً.");
    if(typeof username!=="string" || !username || username.length>128 || typeof password!=="string" || password.length>128) throw new Error("بيانات الكرت داخل الرمز غير صالحة.");
    $("username").value=normalizeCard(username);
    if($("password")) $("password").value=password;
    if(password && $("password")){ visible("password-fields",true); revealSection("#password-fields"); if($("password-toggle")) $("password-toggle").setAttribute("aria-expanded","true"); }
    text("qr-message","تمت تعبئة بيانات الكرت. راجعها ثم اضغط اتصل الآن.");
    if($("qr-input")) $("qr-input").value="";
  }
  var camera=null, scanning=false, openingCamera=false, cameraGeneration=0, scanTimer=null, cameraTimeout=null;
  function stopCamera() {
    cameraGeneration++; scanning=false; openingCamera=false; clearTimeout(scanTimer); clearTimeout(cameraTimeout);
    if(camera) camera.getTracks().forEach(function (track) { track.stop(); });
    camera=null; if($("qr-video")) $("qr-video").srcObject=null; visible("qr-video",false);
    text("scan-card","مسح الكرت بالكاميرا");
  }
  async function scanCard() {
    if(scanning || openingCamera) { stopCamera(); return; }
    if(!window.isSecureContext || !navigator.mediaDevices || !window.BarcodeDetector) {
      text("qr-message","المسح بالكاميرا غير متاح في هذا المتصفح أو عبر HTTP. الصق محتوى الرمز أو أدخل رقم الكرت يدوياً."); return;
    }
    openingCamera=true;
    var generation=++cameraGeneration;
    try {
      var detector=new window.BarcodeDetector({formats:["qr_code"]});
      var stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
      if(generation !== cameraGeneration || document.hidden) { stream.getTracks().forEach(function (track) { track.stop(); }); return; }
      camera=stream;
      $("qr-video").srcObject=camera; visible("qr-video",true); await $("qr-video").play();
      if(generation !== cameraGeneration) return;
      scanning=true; openingCamera=false;
      text("scan-card","إيقاف الكاميرا"); text("qr-message","وجّه الكاميرا إلى رمز QR على الكرت.");
      cameraTimeout=setTimeout(function () { stopCamera(); text("qr-message","انتهى وقت المسح. يمكنك المحاولة مجدداً أو إدخال الكرت."); },45000);
      var scan=async function () {
        if(!scanning || generation !== cameraGeneration) return;
        try { var codes=await detector.detect($("qr-video")); if(generation !== cameraGeneration) return; if(codes.length){fillQR(codes[0].rawValue); stopCamera(); return;} }
        catch (_) { stopCamera(); text("qr-message","تعذرت قراءة الرمز. أدخل بيانات الكرت يدوياً."); return; }
        scanTimer=setTimeout(scan,350);
      }; scan();
    } catch (_) { if(generation === cameraGeneration) { stopCamera(); text("qr-message","تعذر فتح الكاميرا. تحقق من الإذن أو أدخل الكرت يدوياً."); } }
  }
  renderConfig(); renderCards(); showLogin();
  if(store.get("hala2027.theme") === "dark") document.documentElement.dataset.theme="dark";
  if($("theme-toggle")) $("theme-toggle").setAttribute("aria-pressed",String(document.documentElement.dataset.theme === "dark"));
  on("theme-toggle","click",function () { var dark=document.documentElement.dataset.theme!=="dark"; document.documentElement.dataset.theme=dark?"dark":"light";store.set("hala2027.theme",dark?"dark":"light");$("theme-toggle").setAttribute("aria-pressed",String(dark)); });
  on("data-saver","change",updateDomain);
  on("saved-cards","change",function () { $("username").value=$("saved-cards").value; if($("password")) $("password").value=""; });
  on("forget-cards","click",function () { store.remove("hala2027.cards");renderCards();notice("تم حذف أرقام الكروت المحفوظة من هذا الجهاز."); });
  on("password-toggle","click",function () { var show=$("password-fields").hidden;visible("password-fields",show);$("password-toggle").setAttribute("aria-expanded",String(show));if(show) $("password").focus();else $("password").value=""; });
  on("show-password","click",function () { var show=$("password").type==="password";$("password").type=show?"text":"password";$("show-password").setAttribute("aria-pressed",String(show));$("show-password").setAttribute("aria-label",show?"إخفاء كلمة المرور":"إظهار كلمة المرور");$("show-password").textContent=show?"إخفاء":"إظهار"; });
  on("login-form","submit",login); on("refresh-status","click",refreshStatus);
  on("logout-button","click",function () { logout(false); }); on("logout-forget-button","click",function () { logout(true); });
  on("qr-apply","click",function () { try {fillQR($("qr-input").value);} catch(err){text("qr-message",err.message);} });
  on("scan-card","click",scanCard);
  function revealSection(hash) {
    if(!hash || hash.charAt(0) !== "#") return;
    var target=$(decode(hash.slice(1)));
    for(var current=target; current; current=current.parentElement) {
      if(current.tagName === "DETAILS") current.open=true;
    }
  }
  document.addEventListener("click",function (event) {
    var link=event.target.closest ? event.target.closest('a[href^="#"]') : null;
    if(link) revealSection(link.getAttribute("href"));
  });
  window.addEventListener("hashchange",function () { revealSection(location.hash); });
  revealSection(location.hash);
  document.addEventListener("visibilitychange",function () { if(document.hidden){stopPolling();stopCamera();}else if(state.loggedIn) refreshStatus(); });
  window.addEventListener("pagehide",function () {stopPolling();stopCamera();});
  window.addEventListener("offline",function () { notice("فقد الجهاز اتصاله بالشبكة. تأكد من تشغيل الواي فاي."); });
  ready=bootstrap();
})();
