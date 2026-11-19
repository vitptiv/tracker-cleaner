'use strict';
// A throwaway headless Chrome over the DevTools pipe, without any extension. Profiles live under TC_BROWSER_TMP
// (default: the system temp folder), never in the user's own Chrome folders. Names other than localhost do not resolve at all.
const { spawn } = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000, step = 100) => { const end = Date.now() + ms;
  for (;;) { let v; try { v = await fn(); } catch {} if (v) return v; if (Date.now() > end) return null; await sleep(step); } };
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`timeout: ${what}`); })]);
const newProfile = () => { const base = process.env.TC_BROWSER_TMP || require('node:os').tmpdir();
  if (/google-chrome/.test(base)) throw new Error('refusing a real Chrome folder');
  return fs.mkdtempSync(path.join(base, 'tc-lab-chrome-')); };

async function launch(dir = newProfile(), extra = []) {
  if (!path.basename(dir).startsWith('tc-lab-chrome-')) throw new Error('not a lab profile: ' + dir);
  const child = spawn(process.env.CHROME || 'google-chrome', ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${dir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-domain-reliability',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1',
    '--window-size=1200,900', ...extra, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const waiting = new Map(), sessions = new Map();
  let n = 0, buf = '', dead = false;
  child.stdio[3].on('error', () => {});
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', (d) => { buf += d;
    for (let i; (i = buf.indexOf('\0')) >= 0;) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (m.id) { const w = waiting.get(m.id); waiting.delete(m.id); if (w) m.error ? w.no(new Error(`${w.method}: ${m.error.message}`)) : w.yes(m.result); }
      else { const s = m.sessionId && sessions.get(m.sessionId); if (s) s.events.push(m); } } });
  child.on('exit', () => { dead = true; for (const w of waiting.values()) w.no(new Error('Chrome exited')); });
  const send = (method, params = {}, sessionId) => new Promise((yes, no) => { if (dead) return no(new Error('Chrome exited'));
    waiting.set(++n, { yes, no, method }); child.stdio[3].write(JSON.stringify({ id: n, method, params, sessionId }) + '\0'); });
  const go = async (s, url) => { const from = s.events.length;
    const r = await s.send('Page.navigate', { url });
    if (r.errorText) throw new Error(`${url}: ${r.errorText}`);
    if (!await until(() => s.events.slice(from).some((e) => e.method === 'Page.loadEventFired'), 20000)) throw new Error('no load event: ' + url); };
  const tab = async (url) => { const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = { targetId, sessionId, events: [], send: (m, p) => send(m, p, sessionId) };
    s.ev = async (expression) => { const r = await within(s.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), 30000, expression.slice(0, 60));
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
      return r.result.value; };
    s.go = (u) => go(s, u);
    s.url = () => s.ev('location.href');
    // a real mouse press in the middle of the element; `frame` gives a selector of a frame the element sits in
    s.point = async (sel) => s.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    s.mouse = async (x, y) => { await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (const type of ['mousePressed', 'mouseReleased']) await s.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
    s.click = async (sel) => { const p = await until(() => s.point(sel)); if (!p) throw new Error('nothing to click: ' + sel); await s.mouse(p.x, p.y); };
    s.clickAndLoad = async (sel) => { const from = s.events.length; await s.click(sel);
      if (!await until(() => s.events.slice(from).some((e) => e.method === 'Page.loadEventFired'), 20000)) throw new Error('no page after click: ' + sel); await sleep(150); };
    s.type = async (sel, text, gap = 30) => { await s.click(sel);
      for (const ch of text) { await s.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch }); await sleep(gap / 3);
        await s.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(gap); } };
    s.close = () => send('Target.closeTarget', { targetId });
    sessions.set(sessionId, s);
    for (const d of ['Runtime', 'Page', 'Network']) await s.send(`${d}.enable`);
    if (url) await go(s, url);
    return s; };
  const cookies = async () => (await send('Storage.getCookies')).cookies;
  // close(true) keeps the profile so that the same browser can be started again
  const close = async (keep) => { try { await within(send('Browser.close'), 4000, 'close'); } catch {}
    await until(() => dead, 4000); if (!dead) child.kill('SIGKILL'); await until(() => dead, 3000);
    if (!keep) try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  return { send, tab, cookies, close, dir, pid: child.pid };
}
// a self-signed certificate for the lab's names, made in a throwaway folder and trusted by nothing but the Chrome started with `flag`
function labCert(dir) { const { execFileSync } = require('node:child_process'), crypto = require('node:crypto'), key = path.join(dir, 'lab-key.pem'), crt = path.join(dir, 'lab-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=testbook.localhost',
    '-addext', 'subjectAltName=DNS:testbook.localhost,DNS:*.testbook.localhost,DNS:localhost,DNS:testbook.test,DNS:*.testbook.test'], { stdio: 'ignore' });
  const cert = fs.readFileSync(crt), spki = crypto.createHash('sha256').update(new crypto.X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  return { key: fs.readFileSync(key), cert, flag: `--ignore-certificate-errors-spki-list=${spki}` }; }
module.exports = { launch, sleep, until, newProfile, labCert };
