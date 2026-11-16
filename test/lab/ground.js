'use strict';
// Ground rules (steps 1 and 2): what a throwaway headless Chrome allows on *.localhost over plain http.
// Checks only; prints one line per question. node test/lab/ground.js
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { launch, sleep, until } = require('./chrome');
const P = 8290, hits = [];
const srv = http.createServer((q, r) => { const host = q.headers.host.split(':')[0], u = new URL(q.url, 'http://x');
  hits.push({ host, path: u.pathname, cookie: q.headers.cookie || '', method: q.method, enc: !!q.socket.encrypted });
  const h = { 'Content-Type': 'text/html', 'Strict-Transport-Security': 'max-age=3600' };
  if (u.pathname === '/px') { h['Set-Cookie'] = ['g3p=1; Path=/; Max-Age=3600; SameSite=None; Secure', 'gpart=1; Path=/; Max-Age=3600; SameSite=None; Secure; Partitioned'];
    h['Access-Control-Allow-Origin'] = '*'; }
  if (u.pathname === '/sw.js') { h['Content-Type'] = 'text/javascript'; return r.writeHead(200, h).end('self.addEventListener("fetch",()=>{})'); }
  if (u.pathname === '/big.js') { h['Content-Type'] = 'text/javascript'; h['Cache-Control'] = 'max-age=3600';
    return r.writeHead(200, h).end('window.big=0;' + 'function f(){window.big++};f();\n'.repeat(400)); }
  r.writeHead(200, h).end(`<link rel="icon" href="/favicon.ico"><script src="/big.js"></script><img src="http://ff.localhost:${P}/px"><a id="a" href="/next" ping="http://ff.localhost:${P}/ping">go</a>`);
});
const other = http.createServer((q, r) => r.writeHead(200, { 'Access-Control-Allow-Origin': '*' }).end('ok'));
const say = (q, a) => console.log(`${q}: ${a}`);
(async () => {
  await new Promise((r) => srv.listen(P, '127.0.0.1', r)); await new Promise((r) => other.listen(P + 1, '127.0.0.1', r));
  let b = await launch();
  try {
    const t = await b.tab(`http://one.localhost:${P}/`);
    say('names ending in .localhost reach this computer', hits.some((h) => h.host === 'one.localhost') ? 'yes' : 'no');
    await b.tab(`http://two.localhost:${P}/`); await sleep(300);
    say('a SameSite=None; Secure cookie crosses between sites over plain http', hits.filter((h) => h.path === '/px').some((h) => /g3p=1/.test(h.cookie)) ? 'yes' : 'no');
    const part = (await b.cookies()).filter((c) => c.name === 'gpart');
    say('partitioned cookie kept once per surrounding site', `${part.length} copies (${part.map((c) => (c.partitionKey || {}).topLevelSite).join(', ')})`);
    say('secure context, service worker, cache storage', await t.ev(`(async () => { const r = await navigator.serviceWorker.register('/sw.js'); return [isSecureContext, !!r, !!(await caches.open('x'))].join(' '); })()`));
    say('notification permission before a grant', await t.ev('Notification.permission'));
    await b.send('Browser.grantPermissions', { origin: `http://one.localhost:${P}`, permissions: ['notifications'] });
    say('notification permission after a grant over the control channel', await t.ev('Notification.permission'));
    say('page request to an open loopback port', await t.ev(`fetch('http://127.0.0.1:${P + 1}/', { mode: 'no-cors' }).then(() => 'answered', (e) => 'failed ' + e.message)`));
    say('page request to a closed loopback port', await t.ev(`fetch('http://127.0.0.1:${P + 2}/', { mode: 'no-cors' }).then(() => 'answered', (e) => 'failed ' + e.message)`));
    say('graphics and audio', await t.ev(`(async () => { const c = document.createElement('canvas'), g = c.getContext('webgl'); const x = g && g.getExtension('WEBGL_debug_renderer_info');
      const a = new OfflineAudioContext(1, 5000, 44100), o = a.createOscillator(); o.connect(a.destination); o.start(); const buf = await a.startRendering();
      return (g ? g.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : g.RENDERER) : 'no webgl') + ' | audio sum ' + buf.getChannelData(0).reduce((s, v) => s + Math.abs(v), 0); })()`));
    await t.clickAndLoad('#a'); await sleep(300);
    say('link ping sent on a click', hits.some((h) => h.path === '/ping' && h.method === 'POST') ? 'yes' : 'no');
    await t.go(`http://one.localhost:${P}/again`); await t.go(`http://one.localhost:${P}/third`); await sleep(1500);
    say('site icon asked for', `${hits.filter((h) => h.path === '/favicon.ico').length} times over ${hits.filter((h) => h.host === 'one.localhost' && !/\.|px|ping/.test(h.path)).length} pages of one site`);
    say('saved script asked for', `${hits.filter((h) => h.path === '/big.js' && h.host === 'one.localhost').length} times on one site`);
    say('forced-HTTPS header over plain http', hits.some((h) => h.enc) ? 'a request came as https' : 'ignored: every request still came as plain http');
    const dir = b.dir; await b.close(true); b = null;
    const ls = (p) => { try { return fs.readdirSync(path.join(dir, p), { recursive: true }).length; } catch { return 'missing'; } };
    say('code cache files', ls('Default/Code Cache/js'));
    say('History file', fs.existsSync(path.join(dir, 'Default/History')) ? fs.statSync(path.join(dir, 'Default/History')).size + ' bytes' : 'missing');
    say('Favicons file', fs.existsSync(path.join(dir, 'Default/Favicons')) ? 'there' : 'missing');
    let nps = ''; try { nps = fs.readFileSync(path.join(dir, 'Default/Network/Network Persistent State'), 'utf8'); } catch {}
    say('remembered servers', nps ? (/localhost/.test(nps) ? 'names a lab site: ' : 'no lab name in: ') + nps.slice(0, 200) : 'file missing');
    b = await launch(dir); const n = hits.length;
    await b.tab(`http://two.localhost:${P}/`); await sleep(300);
    say('cookie still sent after Chrome was closed and started again', hits.slice(n).some((h) => /g3p=1/.test(h.cookie)) ? 'yes' : 'no');
  } finally { if (b) await b.close(); srv.close(); other.close(); }
})().catch((e) => { console.log('FAIL: ' + (e.stack || e)); process.exit(1); });
