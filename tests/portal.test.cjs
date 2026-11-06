const {JSDOM}=require('jsdom'),fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),crypto=require('crypto');
const root=path.join(__dirname,'../hotspot');
function open({preview=false,chap=false,blocked=false,error=''}={}){
 let html=fs.readFileSync(path.join(root,preview?'preview.html':'login.html'),'utf8').replace(/\$\(if chap-id\)[\s\S]*?\$\(endif\)/g,'').replaceAll('$(link-login-only)','http://router.test/login').replaceAll('$(link-orig)','http://example.test/').replaceAll('$(error)',error);
 const dom=new JSDOM(html,{url:'http://router.test/',runScripts:'outside-only'}),w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 if(blocked){w.Storage.prototype.getItem=function(){throw Error('denied')};w.Storage.prototype.setItem=function(){throw Error('denied')}}
 for(const f of ['portal-config.js','assets/chap.js'])w.eval(fs.readFileSync(path.join(root,f),'utf8'));
 if(chap)w.hotspotChap={id:'\x01',challenge:'\x00\x80challenge'};
 w.eval(fs.readFileSync(path.join(root,'assets/portal.js'),'utf8'));return {w,d:w.document,close:()=>w.close()};
}
function submit(d){const e=new d.defaultView.Event('submit',{bubbles:true,cancelable:true});d.getElementById('login-form').dispatchEvent(e);return e}
{
 const {w,d,close}=open({preview:true});assert.equal(d.querySelectorAll('#speed option').length,4);assert.equal(d.getElementById('speed').value,'2M/4M');
 d.querySelector('[data-open="packages"]').click();assert.equal(d.querySelectorAll('.package').length,6);assert.match(d.getElementById('sheet-content').textContent,/200 ريال/);d.getElementById('close-sheet').click();assert.equal(d.getElementById('sheet').open,false);
 d.querySelector('[data-open="sales"]').click();assert.match(d.getElementById('sheet-content').textContent,/البقالات/);d.getElementById('close-sheet').click();
 d.getElementById('card').value='١٢۳ ٤۵';d.getElementById('card').dispatchEvent(new w.Event('input'));assert.equal(d.getElementById('card').value,'12345');
 d.getElementById('show-password').click();assert.equal(d.getElementById('password').type,'text');
 assert.equal(submit(d).defaultPrevented,true);assert.match(d.getElementById('toast').textContent,/معاينة/);assert.equal(w.localStorage.getItem('hala.portal.v2.cards'),null);
 d.getElementById('scan').click();assert.match(d.getElementById('sheet-content').textContent,/لا يدعم/);close();
}
for(const chap of [false,true])for(const updates of [false,true]){
 const {w,d,close}=open({chap});d.getElementById('card').value='١٢٣&xyz';d.getElementById('password').value='p&=secret';d.getElementById('remember').checked=true;d.getElementById('updates').checked=updates;d.getElementById('speed').value='4M/8M';assert.equal(submit(d).defaultPrevented,false);assert.equal(d.getElementById('domain').value,'4M/8M|'+(updates?'*yes**':'*no**'));assert.equal(d.getElementById('card').value,'123&xyz');assert.equal(d.getElementById('login-form').method,'post');
 const stored=JSON.stringify(w.localStorage);assert(!stored.includes('p&=secret'));assert.deepEqual(JSON.parse(w.localStorage.getItem('hala.portal.v2.cards')),['123&xyz']);
 if(chap)assert.equal(d.getElementById('password').value,crypto.createHash('md5').update(Buffer.from('\x01p&=secret\x00\x80challenge','latin1')).digest('hex'));else assert.equal(d.getElementById('password').value,'p&=secret');close();
}
{
 const {w,d,close}=open({blocked:true});d.getElementById('card').value='123';d.getElementById('remember').checked=true;assert.equal(submit(d).defaultPrevented,false);assert.match(d.getElementById('toast').textContent,/لا يسمح/);close();
}
{
 const {w,d,close}=open({error:'invalid username or password'});assert.equal(d.getElementById('login-error').hidden,false);assert.match(d.getElementById('login-error').textContent,/غير صحيحة/);close();
}
{
 const {w,d,close}=open();w.localStorage.setItem('hala.portal.v2.cards',JSON.stringify(['123456','987654']));d.getElementById('saved').click();d.querySelector('.saved-card').click();assert.equal(d.getElementById('card').value,'123456');assert.equal(d.getElementById('remember').checked,true);d.getElementById('remember').checked=false;submit(d);assert.deepEqual(JSON.parse(w.localStorage.getItem('hala.portal.v2.cards')),['987654']);close();
}
const {w,close}=open();for(const value of ['', 'abc','message digest','\x01password\x00\x80\xff','x'.repeat(1000)])assert.equal(w.hotspotMD5(value),crypto.createHash('md5').update(Buffer.from(value,'latin1')).digest('hex'));close();
for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){const html=fs.readFileSync(path.join(root,file),'utf8');let depth=0;for(const token of html.matchAll(/\$\((if\b[^)]*|endif)\)/g)){depth+=token[1]==='endif'?-1:1;assert(depth>=0)}assert.equal(depth,0);for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)){if(m[1].startsWith('assets/')||m[1]==='portal-config.js')assert(fs.existsSync(path.join(root,m[1])),m[1])}}
console.log('PASS: preview, dialogs, packages, QR fallback, digit normalization, PAP/CHAP, domain flags, storage failure, saved cards, errors, MD5 and template integrity.');
