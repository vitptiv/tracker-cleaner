'use strict';
// The tracking lab: one program answering as every pretend site, told apart by the name asked for. 127.0.0.1 only.
// node lab/server.js [port]   then open http://friendface.localhost:8200/
const http = require('node:http'), path = require('node:path'), fs = require('node:fs');
const { createStore } = require('./store');
const SITES = { friendface: 'Friendface', hop: 'Hop', gazette: 'Harbour Gazette', parcelpine: 'Parcel & Pine', 'metrics.parcelpine': 'Parcel & Pine metrics',
  tidewater: 'Tidewater Notes', loopreel: 'Loopreel', pennant: 'Pennant' };
const LOOK = { friendface: '#2f6f4f', hop: '#555', gazette: '#7a1f1f', parcelpine: '#5b4a1e', 'metrics.parcelpine': '#5b4a1e', tidewater: '#1f4f7a', loopreel: '#5a2f7a', pennant: '#a05a00' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function start({ port = 8200, logFile } = {}) {
  const lab = { port, probe: [port + 1, port + 2], store: createStore(logFile), SITES, esc, GIF };
  lab.at = (site, p = '/') => `http://${site}.localhost:${port}${p}`;
  lab.page = (site, title, body, head = '') => `<!doctype html><meta charset="utf-8"><title>${esc(title)} - ${esc(SITES[site])}</title>
<link rel="icon" href="/favicon.ico">${head}<style>body{font:16px/1.5 sans-serif;max-width:720px;margin:0 auto;padding:0 16px 40px}
header{background:${LOOK[site]};color:#fff;margin:0 -16px 16px;padding:10px 16px}header a{color:#fff;text-decoration:none;font-weight:bold}
table{border-collapse:collapse;font-size:14px}td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top;text-align:left}</style>
<header><a href="/">${esc(SITES[site])}</a></header><h1>${esc(title)}</h1>${body}`;
  const handlers = { friendface: require('./friendface'), ...require('./sites') };
  const server = http.createServer(async (q, r) => {
    const name = String(q.headers.host || '').split(':')[0].replace(/\.localhost$/, '');
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
      if (!await handlers[name](c)) c.send(404, 'text/html', lab.page(name, 'Not found', '<p>No such page.</p>'));
    } catch (e) { c.send(500, 'text/plain', String(e.stack || e)); }
  });
  // the one extra listener the loopback probe may find; the port after it stays closed
  const beacon = http.createServer((q, r) => r.writeHead(204).end());
  return new Promise((done, fail) => { server.on('error', fail);
    server.listen(port, '127.0.0.1', () => beacon.listen(lab.probe[0], '127.0.0.1', () => done(Object.assign(lab, { server,
      close: () => new Promise((d) => { beacon.close(); server.closeAllConnections(); server.close(d); }) })))); });
}
module.exports = { start, SITES };
if (require.main === module) { const dir = path.join(__dirname, 'data'); fs.mkdirSync(dir, { recursive: true });
  start({ port: Number(process.argv[2]) || 8200, logFile: path.join(dir, 'friendface-log.jsonl') }).then((l) => console.log(`lab on ${l.at('friendface')}`)); }
