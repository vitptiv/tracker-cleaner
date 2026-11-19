'use strict';
// The hidden collector (lab-only): a SECOND pretend platform, on its own loopback port, to test the shipped cleaner (v1.25)
// against first-party evasions. Nothing here is keyed on by the extension; a loophole counts only if the shipped code
// fails to stop it. 127.0.0.1 only, made-up names, additions only (the frozen test-network files are never touched).
//
// The spine: the only tracker piece on any page is served from the VISITED site's own /f/ path, which this content
// server reverse-proxies to the ff2 collector on its own loopback port. The browser never connects to another host,
// so the structural rules (C29/C30/C31, all domainType:'thirdParty') never match, and the collector never sets a
// cookie of its own that other sites can use -> the learning in background.js never even raises a question.
const http = require('node:http');
const { createStore, rid } = require('./store');
const { SITES2, pages } = require('./ff2-sites');

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
// the rotating ordinary-looking names the URL chain (F2-3) carries the master id under; a browser id looks like ff2m-...
const CHAIN = ['ref', 'src', 'cid', 'sid', 'vid', 's', 'r', 'u'];
const carriedId = (sp) => { for (const n of CHAIN) { const v = sp.get(n); if (v && /^ff2m-[0-9a-z]+$/.test(v)) return v; } return ''; };
const isLoopback = (a) => /^(127\.0\.0\.1|::ffff:127\.0\.0\.1|::1)$/.test(String(a));
const siteOf = (host) => String(host || '').split(':')[0].replace(/\.localhost$/, '');
const cookiesOf = (h) => Object.fromEntries(String(h || '').split(/;\s*/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))]; }));
// a server-side probe of a loopback port, as the collector does it for the page (the browser never touches 127.0.0.1)
const probePort = (port) => new Promise((done) => { const q = http.get({ host: '127.0.0.1', port, timeout: 500 }, (r) => { r.resume(); done('open'); });
  q.on('error', () => done('closed')); q.on('timeout', () => { q.destroy(); done('closed'); }); });

function start2({ port = 8300, logFile } = {}) {
  const store = createStore(logFile);
  const lab = { port, cport: port + 1, probe: [port + 2, port + 3], store, SITES2, siteNames: Object.keys(SITES2) };
  lab.at2 = (site, p = '/') => `http://${site}.localhost:${port}${p}`;
  // the first-party kit each page loads from its own /f/kit.js (F2-1 version; F2-2 enriches it in lab/ff2-kit.js)
  let kitJs = `(() => { const u = encodeURIComponent(location.href), r = encodeURIComponent(document.referrer);
  fetch('/f/hit?u=' + u + '&r=' + r, { credentials: 'include', keepalive: true }).catch(() => {});
  new Image().src = '/f/px.gif?t=' + Date.now();
  fetch('/f/probe?ports=__PROBE__', { credentials: 'include' }).catch(() => {}); })();`;
  try { const rd = (f) => { try { return require('fs').readFileSync(require('path').join(__dirname, f), 'utf8'); } catch { return ''; } };
    kitJs = [rd('ff2-fp.js'), rd('ff2-handoff.js'), rd('ff2-kit.js')].filter(Boolean).join('\n'); } catch {}
  const kitFor = () => kitJs.replace('__PROBE__', lab.probe.join(',')).replace('__PORT__', String(port)).replace('__CHAIN__', JSON.stringify(CHAIN));

  // ---- the collector (its own loopback port). Every request reaches it reverse-proxied from a site's own /f/ path,
  // so the Host header is the visited site's own name and everything it sets or reads is first-party to that site.
  lab.collect = async (c) => {
    const p = c.url.pathname, site = c.site, host = site + '.localhost', cook = c.cookies;
    const id = cook.fp_id || ('fp-' + rid('', 5).slice(1)), fresh = !cook.fp_id;
    const master = c.p('m') || (c.body || {}).m || '';   // the cookie-less master id, from the address or the posted body
    const ids = ['ff2:' + host + ':' + id, master && 'ff2m:' + master];
    const setId = () => { if (fresh) c.setCookie(`fp_id=${id}; Path=/; Max-Age=31536000; SameSite=Lax`); };
    if (p === '/f/kit.js') return c.send(200, 'text/javascript', kitFor(), { 'Cache-Control': 'max-age=3600' });
    if (p === '/f/hit') { setId();
      store.record(ids, 'F1', `fp_id=${id}`, host, fresh ? 'first-party cookie set by the site’s own /f/ proxy' : 'first-party cookie sent back to the site');
      store.record(ids, 'F8', `${c.p('u') || c.url.href} (came from ${c.p('r') || 'nowhere'})`, host, 'the site’s own address and referrer, posted first-party');
      // F2 (cookie-less first-party id): the kit keeps the master id only in this site's own storage and in the address
      const b = c.body || {}, mid = c.p('m') || b.m, stores = b.stores || {};
      if (mid) { const where = Object.keys(stores).filter((k) => stores[k]).map((k) => ({ local: 'localStorage', idb: 'IndexedDB', cache: 'cacheStorage' }[k] || k));
        store.record(ids, 'F2', `ff2_id=${mid} (kept in ${where.join(', ') || 'the address only'}, no cookie)`, host,
          (b.respawned || []).length ? 'put back from ' + (b.respawned || []).join(', ') + '; no cookie' : 'kept cookie-less in the site’s own storage'); }
      if (b.fp && b.fp.code) store.record(ids, 'F6', b.fp.code, host, `graphics-draw ${b.fp.gl}, fonts ${b.fp.fonts}, screen+media ${b.fp.media}`);
      return lab.hit ? lab.hit(c, { id, ids, host }) : c.json({ ok: true }); }
    if (p === '/f/px.gif') { const tag = `"${id}"`, asked = c.q.headers['if-none-match'];
      if (asked === tag) { store.record(ids, 'F10', `ETag ${tag} on the site’s own image`, host, 'the browser revalidated the first-party image with If-None-Match');
        return c.send(304, 'image/gif', '', { ETag: tag, 'Cache-Control': 'private, no-cache' }); }
      setId(); return c.send(200, 'image/gif', GIF, { ETag: tag, 'Cache-Control': 'private, no-cache' }); }
    if (p === '/f/hop') { const b = c.body || {}, to = String(b.to || ''), toSite = siteOf(new URL(to, 'http://x').hostname);
      store.record(ids, 'F4', `${b.from || host} to ${to.split('?')[0]}`, host, 'scripted navigation, no HTTP redirect');
      store.record(ids, 'F5', `click to ${toSite}`, host, 'the click recorded first-party before the scripted jump');
      return c.json({ ok: true }); }
    if (p === '/f/probe') { const want = c.p('ports').split(',').map(Number).filter(Boolean).slice(0, 4);
      const got = await Promise.all(want.map(async (n) => [n, await probePort(n)]));
      store.record(ids, 'F9', ['open', 'closed'].map((s) => `${s}: ${got.filter((x) => x[1] === s).map((x) => x[0]).join(' ') || 'none'}`).join('; '), host, 'the page asked its own site; the site probed loopback');
      return c.json({ probe: got }); }
    return lab.collectMore ? lab.collectMore(c, { id, ids, host, setId }) : c.send(404, 'text/plain', 'no such collector route');
  };
  const collector = http.createServer((q, r) => {
    const c = { q, r, url: new URL(q.url, 'http://x'), site: siteOf(q.headers.host), cookies: cookiesOf(q.headers.cookie), out: {} };
    c.p = (k) => c.url.searchParams.get(k) || '';
    c.setCookie = (t) => { c.out['Set-Cookie'] = [...(c.out['Set-Cookie'] || []), t]; };
    c.send = (s, type, body, h = {}) => { r.writeHead(s, { 'Content-Type': type, 'Cache-Control': 'no-store', ...c.out, ...h }); r.end(body); return true; };
    c.json = (o, h) => c.send(200, 'application/json', JSON.stringify(o), h);
    if (!SITES2[c.site]) return c.send(404, 'text/plain', 'unknown site');
    (async () => { try { let raw = ''; if (q.method === 'POST') { for await (const d of q) raw += d; } c.raw = raw;
      try { c.body = raw && raw[0] === '{' ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { c.body = {}; }
      await lab.collect(c); } catch (e) { c.send(500, 'text/plain', String(e.stack || e)); } })();
  });

  // ---- the content server: answers every ff2 site name; a /f/ path is reverse-proxied to the collector, so the
  // browser only ever connects to the site's own name.
  const server = http.createServer((q, r) => {
    if (!isLoopback(q.socket.remoteAddress) || !SITES2[siteOf(q.headers.host)]) { r.writeHead(403, { 'Content-Type': 'text/plain' }); return r.end('the ff2 lab answers only on this computer, under its own names'); }
    const site = siteOf(q.headers.host), url = new URL(q.url, `http://${q.headers.host}`);
    if (url.pathname === '/favicon.ico') { r.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=31536000' }); return r.end(GIF); }
    if (url.pathname.startsWith('/f/')) {   // reverse proxy to the collector, keeping the site's own Host
      const px = http.request({ host: '127.0.0.1', port: lab.cport, path: q.url, method: q.method, headers: { ...q.headers } }, (pr) => { r.writeHead(pr.statusCode, pr.headers); pr.pipe(r); });
      px.on('error', () => { r.writeHead(502, { 'Content-Type': 'text/plain' }); r.end('collector down'); }); return q.pipe(px);
    }
    const c = { q, r, site, host: site + '.localhost', url, lab, store, out: {} };
    c.cookies = cookiesOf(q.headers.cookie); c.p = (k) => url.searchParams.get(k) || '';
    c.send = (s, type, body, h = {}) => { r.writeHead(s, { 'Content-Type': type, 'Cache-Control': 'no-store', ...c.out, ...h }); r.end(body); return true; };
    c.html = (title, body, head) => c.send(200, 'text/html; charset=utf-8', pages.page ? pages.page(site, title, body, head) : body);
    c.setCookie = (t) => { c.out['Set-Cookie'] = [...(c.out['Set-Cookie'] || []), t]; };
    c.to = (location) => c.send(302, 'text/plain', '', { Location: location });
    (async () => { try { let raw = ''; if (q.method === 'POST') { for await (const d of q) raw += d; } c.raw = raw;
      try { c.body = raw && raw[0] === '{' ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch { c.body = {}; }
      const extra = lab.route && await lab.route(c);
      if (extra) return;
      // F2-3: rebuild a master id carried in the address under any rotating name, server-side; join the browser and
      // seed the page so its kit adopts the same id (first-party, no cookie crossed the wire).
      const carried = carriedId(url.searchParams);
      if (carried) { store.record(['ff2m:' + carried, 'ff2chain:' + c.host], 'F3', `ff2_id=${carried} carried to ${c.host}${url.pathname}`, c.host, 'carried in the address you clicked, rebuilt server-side'); c.seed = carried; }
      let html = pages(c);
      if (html === false) return c.send(404, 'text/html', `<!doctype html><title>Not found</title><p>No such page.</p>`);
      if (html && html.json !== undefined) return c.send(200, 'application/json', JSON.stringify(html.json, null, 1));
      if (c.seed) html = html.replace('<script src="/f/kit.js">', `<script>window.__ff2seed=${JSON.stringify(c.seed)}</script><script src="/f/kit.js">`);
      c.send(200, 'text/html; charset=utf-8', html);
    } catch (e) { c.send(500, 'text/plain', String(e.stack || e)); } })();
  });

  const open = http.createServer((q, r) => r.writeHead(204).end());   // the one open loopback port the probe may find
  return new Promise((done, fail) => { server.on('error', fail);
    collector.listen(lab.cport, '127.0.0.1', () => open.listen(lab.probe[0], '127.0.0.1', () => server.listen(port, '127.0.0.1', () => done(Object.assign(lab, { server, collector,
      close: () => new Promise((d) => { open.close(); collector.closeAllConnections(); collector.close(); server.closeAllConnections(); server.close(d); }) }))))); });
}
module.exports = { start2, SITES2, CHAIN };
if (require.main === module) start2({ port: Number(process.argv[2]) || 8300 }).then((l) => console.log(`ff2 lab on ${l.at2('ledger')}`));
