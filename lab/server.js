'use strict';
// The tracking lab: one program answering as every pretend site, told apart by the name asked for. 127.0.0.1 only.
// node lab/server.js [port]   then open http://testbook.localhost:8200/
const http = require('node:http'), https = require('node:https'), net = require('node:net'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('./store');
const SITES = { testbook: 'Testbook', hop: 'Hop', gazette: 'Harbour Gazette', parcelpine: 'Parcel & Pine', 'metrics.parcelpine': 'Parcel & Pine metrics',
  tidewater: 'Tidewater Notes', loopreel: 'Loopreel', pennant: 'Pennant' };
const LOOK = { testbook: '#2f6f4f', hop: '#555', gazette: '#7a1f1f', parcelpine: '#5b4a1e', 'metrics.parcelpine': '#5b4a1e', tidewater: '#1f4f7a', loopreel: '#5a2f7a', pennant: '#a05a00' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function start({ port = 8200, logFile, tls } = {}) {
  // with a lab certificate, the test network also answers as testbook.test on one more loopback port, plain and encrypted
  const lab = { port, tlsPort: tls ? port + 3 : 0, probe: [port + 1, port + 2], store: createStore(logFile), SITES, esc, GIF };
  lab.at = (site, p = '/') => `http://${site}.localhost:${port}${p}`;
  lab.page = (site, title, body, head = '') => `<!doctype html><meta charset="utf-8"><title>${esc(title)} - ${esc(SITES[site])}</title>
<link rel="icon" href="/favicon.ico">${head}<style>body{font:16px/1.5 sans-serif;max-width:720px;margin:0 auto;padding:0 16px 40px}
header{background:${LOOK[site]};color:#fff;margin:0 -16px 16px;padding:10px 16px}header a{color:#fff;text-decoration:none;font-weight:bold}
table{border-collapse:collapse;font-size:14px}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top;text-align:left}</style>
<header><a href="/">${esc(SITES[site])}</a></header><h1>${esc(title)}</h1>${body}`;
  const { KEY, ...sites } = require('./sites'), handlers = { testbook: require('./testbook'), ...sites };
  const server = http.createServer(async (q, r) => {
    const name = String(q.headers.host || '').split(':')[0].replace(/\.localhost$/, '');
    if (name === 'testbook.test') return secure(q, r);
    const c = { q, r, lab, store: lab.store, site: name, host: name + '.localhost', url: new URL(q.url, `http://${q.headers.host}`), out: {} };
    c.cookies = Object.fromEntries(String(q.headers.cookie || '').split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
    c.send = (status, type, body, headers = {}) => { r.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...c.out, ...headers }); r.end(body); return true; };
    c.html = (title, body, head) => c.send(200, 'text/html; charset=utf-8', lab.page(name, title, body, head));
    c.json = (o, headers) => c.send(200, 'application/json', JSON.stringify(o, null, 1), headers);
    c.gif = (headers) => c.send(200, 'image/gif', GIF, headers);
    c.to = (location) => c.send(302, 'text/plain', '', { Location: location });
    c.cookie = (text) => { c.out['Set-Cookie'] = [...(c.out['Set-Cookie'] || []), text]; };
    c.p = (k) => c.url.searchParams.get(k) || '';
    try {
      if (!/^(127\.0\.0\.1|::ffff:127\.0\.0\.1|::1)$/.test(q.socket.remoteAddress) || !handlers[name]) return c.send(403, 'text/plain', 'the lab answers only on this computer, under its own names');
      if (q.method === 'POST') { let raw = ''; for await (const d of q) { raw += d; if (raw.length > 1e5) return c.send(413, 'text/plain', 'too long'); }
        c.raw = raw; try { c.body = raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { c.body = {}; } }
      if (c.url.pathname === '/favicon.ico') return handlers.icon(c);
      // lab helper on every site: delete this site's ID cookie and nothing else
      if (c.url.pathname === '/lab/delete-id') { c.cookie('_ffp=; Path=/; Max-Age=0'); return c.html('Deleted', '<p id="deleted">This site\'s ID cookie _ffp is deleted. Nothing else was touched.</p>'); }
      if (!await handlers[name](c)) c.send(404, 'text/html', lab.page(name, 'Not found', '<p>No such page.</p>'));
    } catch (e) { c.send(500, 'text/plain', String(e.stack || e)); }
  });
  // technique 20 over https: the forced-HTTPS entry as one remembered bit, and an alternative server for Chrome to remember
  const secure = (q, r) => { const u = new URL(q.url, 'http://x'), uid = u.searchParams.get('u'), enc = !!q.socket.encrypted;
    const h = { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' };
    if (u.pathname === '/hsts/set' && enc) Object.assign(h, { 'Strict-Transport-Security': 'max-age=31536000', 'Alt-Svc': `h3=":${port + 5}"; ma=86400` });
    if (u.pathname === '/hsts/read' && enc && uid) lab.store.record(['ff_uid:' + uid], 'T21', `forced-HTTPS bit set for testbook.test: the plain request http://testbook.test:${lab.tlsPort}/hsts/read arrived as https`, 'testbook.test', 'read back by asking over plain http');
    r.writeHead(200, h).end(GIF); };
  const both = tls && https.createServer(tls, secure), plain = tls && http.createServer(secure);
  const split = tls && net.createServer((sock) => { sock.on('error', () => {}); sock.once('readable', () => { const d = sock.read(); if (!d) return sock.destroy();
    sock.unshift(d); (d[0] === 0x16 ? both : plain).emit('connection', sock); }); });
  // the one extra listener the loopback probe may find; the port after it stays closed
  const beacon = http.createServer((q, r) => r.writeHead(204).end());
  return new Promise((done, fail) => { server.on('error', fail);
    server.listen(port, '127.0.0.1', () => beacon.listen(lab.probe[0], '127.0.0.1', () => { if (split) split.listen(lab.tlsPort, '127.0.0.1'); done(Object.assign(lab, { server,
      close: () => new Promise((d) => { beacon.close(); if (split) { split.close(); both.closeAllConnections(); plain.closeAllConnections(); } server.closeAllConnections(); server.close(d); }) })); })); });
}
module.exports = { start, SITES };
if (require.main === module) { const dir = path.join(__dirname, 'data'); fs.mkdirSync(dir, { recursive: true });
  start({ port: Number(process.argv[2]) || 8200, logFile: path.join(dir, 'testbook-log.jsonl') }).then((l) => console.log(`lab on ${l.at('testbook')}`)); }
