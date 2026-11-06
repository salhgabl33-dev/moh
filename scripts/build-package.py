"""Build a local router ZIP and an offline, non-authenticating HTML preview."""
from pathlib import Path
import base64
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PORTAL = ROOT / 'hotspot'
html = (PORTAL / 'login.html').read_text()
html = re.sub(r'\$\(if chap-id\).*?\$\(endif\)', '', html, flags=re.S)
html = html.replace('$(link-login-only)', '#').replace('$(link-orig)', '').replace('$(error)', '')
html = html.replace('class="brand" href="login.html"', 'class="brand" href="preview.html"')
html = html.replace('<body>', '<body data-preview="true"><div class="preview-banner">معاينة فقط · لا تُرسل بيانات الدخول <a href="../hala-net-v2.zip" download>تنزيل الملفات ↓</a></div>')
(PORTAL / 'preview.html').write_text(html)

css = (PORTAL / 'assets/portal.css').read_text()
for filename in ['Tajawal-Regular.woff2', 'Tajawal-Bold.woff2']:
    font = base64.b64encode((PORTAL / 'assets' / filename).read_bytes()).decode()
    css = css.replace('url(' + filename + ')', 'url(data:font/woff2;base64,' + font + ')')
standalone = html.replace('<link rel="stylesheet" href="assets/portal.css">', '<style>' + css + '</style>')
for filename in ['portal-config.js', 'assets/chap.js', 'assets/jsqr.js', 'assets/portal.js']:
    standalone = standalone.replace('<script src="' + filename + '" defer></script>', '')
standalone = standalone.replace('../hala-net-v2.zip', 'hala-net-v2.zip')
standalone = re.sub(r'^ +$', '', standalone, flags=re.M)
inline = ''.join('<script>' + (PORTAL / filename).read_text() + '</script>' for filename in ['portal-config.js', 'assets/jsqr.js', 'assets/portal.js'])
standalone = standalone.replace('</body>', inline + '\n</body>')
(ROOT / 'preview.html').write_text(standalone)
with zipfile.ZipFile(ROOT / 'hala-net-v2.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for item in sorted(PORTAL.rglob('*')):
        if item.is_file():
            archive.write(item, item.relative_to(ROOT))
    for filename in ['README.md', 'QA.md']:
        archive.write(ROOT / filename, filename)
print('Built offline preview and router ZIP:', (ROOT / 'hala-net-v2.zip').stat().st_size, 'bytes')
