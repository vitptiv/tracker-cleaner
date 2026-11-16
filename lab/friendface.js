'use strict';
// Friendface: the pretend network. Its own pages, and the pieces other sites embed.
const fs = require('node:fs'), path = require('node:path');
const { rid, sha } = require('./store'), { know, page, TRACES } = require('./know'), { KEY } = require('./sites');
const KIT = fs.readFileSync(path.join(__dirname, 'kit.js'), 'utf8'), APPS = { tidewater: 'tidewater' };
const YEAR = 31536000;
const POSTS = [['tidewater', '/post/mending-a-kite', 'Tidewater Notes: mending a kite'], ['parcelpine', '/product/kite-line', 'Parcel & Pine: kite line, 25 m'],
  ['gazette', '/article/harbour-bridge', 'Harbour Gazette: Harbour bridge closes for repairs']];

// who is asking: the browser cookie (given out when missing) and the signed-in account
function who(c) {
  let uid = c.cookies.ff_uid;
  if (!uid) { uid = rid('u'); c.cookie(`ff_uid=${uid}; Path=/; Max-Age=${YEAR}; SameSite=None; Secure`); }
  const account = c.store.sessions.get(c.cookies.ff_session);
  return { uid, came: !!c.cookies.ff_uid, account, ids: ['ff_uid:' + uid, account && 'acct:' + account.id] };
}
// what every embedded request gives away by itself: the cookies that came, and the request's own details
function seen(c, w, ids, site, what) {
  if (w.came) c.store.record(ids, 'T1', `ff_uid=${w.uid}`, site, 'cookie sent with ' + what);
  if (w.account) c.store.record(ids, 'T2', `ff_session=${c.cookies.ff_session} is ${w.account.name}`, site, 'cookie sent with ' + what);
  const h = c.q.headers, fwd = String(h['x-forwarded-for'] || '').split(',')[0].trim(), names = c.q.rawHeaders.filter((_, i) => i % 2 === 0).join(',');
  c.store.record(ids, 'T24', `address ${fwd ? fwd + ' (forwarded; simulated)' : c.q.socket.remoteAddress.replace('::ffff:', '')}, ${(String(h['user-agent']).match(/(Headless)?Chrome\/[\d.]+/) || [h['user-agent']])[0]}, ${String(h['accept-language'] || 'no language').split(',')[0]}, header pattern h-${sha(names).slice(0, 6)}`, site, what);
}
// one page view, told by the image or by the kit, whichever comes first for that page load
function visit(c, ids, site, pl, url, ref, via) {
  if (pl && c.store.records.some((r) => r.trace === 'visit' && r.extra.pl === pl)) return c.store.group(ids);
  c.store.record(ids, 'visit', url, site, via, { pl, ref });
  c.store.record(ids, 'T23', `${url} (came from ${ref || 'nowhere'})`, site, via);
}
// one purchase, however many times it is reported
function counted(c, eid, source, b) { if (!eid) return; const e = c.store.events.get(eid) || { event_id: eid, value: b.value, currency: b.currency, sources: [] };
  if (!e.sources.includes(source)) e.sources.push(source); c.store.events.set(eid, e); }
const stats = (gaps) => { const n = gaps.length || 1, mean = gaps.reduce((a, b) => a + b, 0) / n; return { mean, spread: Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / n) }; };
// how far apart two typing sessions are: 0 is the same rhythm
const rhythmDistance = (a, b) => { const x = stats(a), y = stats(b); return Math.abs(x.mean - y.mean) + Math.abs(x.spread - y.spread); };
// everything the kit sends: the page report, events, a typed address, the rhythm, the closing beacon
function report(c, w) {
  const b = c.body || {}, site = String(b.site || ''), clid = String(b.ffc || '').split('.').pop(), known = c.store.clicks.has(clid);
  const ids = [...w.ids, b.pl && 'pl:' + b.pl, b.ffp && `_ffp:${site}:${b.ffp}`, known && 'click:' + clid];
  const rec = (trace, value, via) => c.store.record(ids, trace, value, site, via);
  const cors = { 'Access-Control-Allow-Origin': c.q.headers.origin || '*', 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' };
  if (b.kind === 'page') { seen(c, w, ids, site, 'a report from the kit'); visit(c, ids, site, b.pl, b.url, b.ref, 'kit');
    if (b.ffp) rec('T3', `_ffp=${b.ffp}`, (b.respawned || []).length ? 'the cookie was gone; put back from ' + b.respawned.join(', ') : 'read by the kit');
    const held = b.held || {};
    if (held['local storage']) rec('T9', `key ff_copy = ${held['local storage']}`, 'read by the kit');
    if (held.IndexedDB) rec('T11', `database ff, key id = ${held.IndexedDB}`, 'read by the kit');
    if (held['cache storage']) rec('T12', `cache ff, entry /ff-id = ${held['cache storage']}`, 'read by the kit');
    if (b.tab) rec('T10', `tab ${b.tab.id}, page ${b.tab.pages}`, 'read by the kit');
    if (b.storage && b.storage.quota) rec('T14', `usage ${b.storage.usage} bytes, quota ${b.storage.quota} bytes`, 'the browser\'s answer');
    if (c.store.saved.has(b.saved)) { const n = c.store.saved.get(b.saved) + 1; c.store.saved.set(b.saved, n);
      if (n > 1) rec('T15', `saved.js says ${b.saved}`, 'the saved copy, given out once and not asked for again'); }
    if (b.fp && b.fp.code) rec('T25', b.fp.code, `canvas ${b.fp.canvas}, graphics ${b.fp.graphics}, audio ${b.fp.audio}, fonts ${b.fp.fonts}, traits ${b.fp.traits}`);
    if (Array.isArray(b.probe)) rec('T36', ['open', 'closed'].map((s) => `${s}: ${b.probe.filter((p) => p[1] === s).map((p) => p[0]).join(' ') || 'none'}`).join('; '), 'asked from the page on 127.0.0.1'); }
  if (b.ffc) rec('T4', `_ffc=${b.ffc}`, known ? 'click ID given out in the feed' : 'click ID not given out by Friendface');
  const matched = (via) => { const a = c.store.accounts.find((x) => x.hash === b.em); if (a) ids.push('acct:' + a.id);
    rec('T27', `sha256 ${b.em}: ${a ? 'matches ' + a.email : 'matches no account'}`, via); };
  if (b.kind === 'event') { if ((b.params || {}).event_id) ids.push('event:' + b.params.event_id);
    rec('T26', `${b.name} ${JSON.stringify(b.params || {})}`, 'reported by the kit'); counted(c, (b.params || {}).event_id, 'browser', b.params || {});
    if (b.em) matched('passed on by the site with the event'); }
  if (b.kind === 'typed' && /^[0-9a-f]{64}$/.test(b.em)) matched(`typed into the field "${b.field}", not sent`);
  if (b.kind === 'rhythm' && Array.isArray(b.gaps)) { const st = stats(b.gaps);
    rec('T35', `${b.gaps.length + 1} keys, gap mean ${Math.round(st.mean)} ms, spread ${Math.round(st.spread)} ms; mouse ${b.moves} moves, ${b.dist} px`, 'sent after the typing stopped'); }
  if (b.kind === 'close') rec('T28', `${b.seconds} s on ${b.url}, scrolled ${b.scroll}%`, 'beacon as the page went away');
  return c.json({}, cors);
}
// the frame's own storage ID and its per-site cookie; returns the identifiers that came
function frame(c, w) { const b = c.body || {}, ids = [...w.ids, b.pl && 'pl:' + b.pl, b.fsid && 'fsid:' + b.fsid];
  if (b.fsid) c.store.record(ids, 'T9', `frame key ff_fsid = ${b.fsid}`, b.site, 'Friendface frame inside the site');
  if (c.cookies.ff_frame) c.store.record(ids, 'T8', `ff_frame=${c.cookies.ff_frame}`, b.site, 'per-site cookie sent from inside the site');
  return ids; }
const signedIn = (c, w, token) => { c.store.group(['ff_uid:' + w.uid, 'acct:' + c.store.sessions.get(token).id]); c.cookie(`ff_session=${token}; Path=/; Max-Age=${YEAR}; SameSite=None; Secure; HttpOnly`); return c.to('/'); };

const routes = {
  'GET /': (c, w) => { const { esc } = c.lab;
    if (!w.account) return c.html('Friendface', `<p>A pretend social network for the tracking lab. Everyone here is made up.</p>${c.p('e') ? `<p id="error">${esc(c.p('e'))}</p>` : ''}
<h2>Create an account</h2><form id="join" method="post" action="/join"><input name="name" placeholder="Name"> <input name="email" type="email" placeholder="E-mail"> <input name="password" type="password" placeholder="Password"> <button>Join</button></form>
<h2>Sign in</h2><form id="login" method="post" action="/login"><input name="email" type="email" placeholder="E-mail"> <input name="password" type="password" placeholder="Password"> <button>Sign in</button></form>
<p><a href="/what-i-know">What I know about you</a></p>`);
    c.store.group(w.ids);
    return c.html('Feed', `<p id="me">Signed in as <b>${esc(w.account.name)}</b>. <a href="/profile">Profile</a> · <a href="/what-i-know">What I know about you</a> · <a id="out" href="/logout">Sign out</a></p>
${POSTS.map(([site, path, title], i) => { const cid = rid('c', 4); c.store.group([...w.ids, 'click:' + cid]); c.store.clicks.set(cid, c.lab.at(site, path));
    return `<p class="post"><a id="post-${i + 1}" href="${esc(c.lab.at('hop', `/r?c=${cid}&to=${encodeURIComponent(c.lab.at(site, path))}`))}" ping="/ping?c=${cid}">${esc(title)}</a></p>`; }).join('\n')}
<script>navigator.serviceWorker.register('/sw.js');
(Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission)).then((p) => fetch('/perm?state=' + p));</script>`); },
  'POST /join': (c, w) => { const b = c.body, a = c.store.addAccount(b.name, b.email, b.password);
    return a ? signedIn(c, w, c.store.signIn(b.email, b.password)) : c.to('/?e=' + encodeURIComponent('That did not work: all three fields are needed, and an address can join once.')); },
  'POST /login': (c, w) => { const token = c.store.signIn(c.body.email, c.body.password);
    return token ? signedIn(c, w, token) : c.to('/?e=' + encodeURIComponent('Wrong e-mail or password.')); },
  'GET /logout': (c) => { c.store.sessions.delete(c.cookies.ff_session); c.cookie('ff_session=; Path=/; Max-Age=0; SameSite=None; Secure; HttpOnly'); return c.to('/'); },
  'GET /profile': (c, w) => w.account ? c.html(w.account.name, `<p id="email">${c.lab.esc(w.account.email)}</p><p>Account ${w.account.id}. A made-up person.</p>`) : c.to('/'),
  'GET /what-i-know': (c, w) => c.html('What I know about you', page(know(c.store, c.store.lookup(w.ids.filter(Boolean))), c.lab.esc)),
  'GET /what-i-know.json': (c, w) => c.json(know(c.store, c.store.lookup(w.ids.filter(Boolean)))),
  // technique 1: the invisible image
  'GET /tr': (c, w) => { const site = c.p('site'), ids = [...w.ids, c.p('pl') && 'pl:' + c.p('pl')];
    seen(c, w, ids, site, 'the invisible image'); visit(c, ids, site, c.p('pl'), c.p('u'), c.p('r'), 'image'); return c.gif(); },
  // ---- the script kit and what it reports
  'GET /kit.js': (c) => c.send(200, 'text/javascript', KIT.replace('__FF__', c.lab.at('friendface', '')).replace('__PROBE__', JSON.stringify(c.lab.probe)), { 'Cache-Control': 'max-age=3600' }),
  // a script file that is saved for a year; its text is an ID of its own
  'GET /saved.js': (c) => { const id = rid('k'); c.store.saved.set(id, 0);
    return c.send(200, 'text/javascript', `window.__ffSaved = ${JSON.stringify(id)};`, { 'Cache-Control': 'max-age=31536000, immutable' }); },
  // technique 8: an image whose cache tag is different for every visitor
  'GET /tag.gif': (c, w) => { const asked = c.q.headers['if-none-match'], keep = { 'Cache-Control': 'private, no-cache' };
    if (!asked) { const tag = rid('t'); c.store.group([...w.ids, 'etag:' + tag]); return c.gif({ ...keep, ETag: `"${tag}"` }); }
    const tag = asked.replace(/^W\//, '').replace(/"/g, '');
    c.store.record([...w.ids, 'etag:' + tag], 'T16', `If-None-Match: "${tag}"`, c.p('site'), 'the tag came back with the request');
    return c.send(304, 'image/gif', '', { ...keep, ETag: asked }); },
  'POST /report': report, 'POST /beacon': report,
  // ---- the like frame: Friendface's own page inside another site
  'GET /plugins/like': (c, w) => { const site = c.p('site'), ids = [...w.ids, c.p('pl') && 'pl:' + c.p('pl')];
    seen(c, w, ids, site, 'the like frame');
    if (!c.cookies.ff_frame) c.cookie(`ff_frame=${rid('f')}; Path=/; Max-Age=${YEAR}; SameSite=None; Secure; Partitioned`);
    return c.send(200, 'text/html; charset=utf-8', `<!doctype html><meta charset="utf-8"><body style="margin:0;font:14px sans-serif">
<button id="like" style="background:#2f6f4f;color:#fff;border:0;padding:8px 14px">Like</button> <span id="as">${w.account ? 'as ' + c.lab.esc(w.account.name) : ''}</span> <span id="state"></span>
<script>let fsid = localStorage.getItem('ff_fsid'); if (!fsid) localStorage.setItem('ff_fsid', fsid = 's-' + Math.random().toString(16).slice(2, 12));
const tell = (path, more) => fetch(path, { method: 'POST', body: JSON.stringify({ fsid, site: ${JSON.stringify(site)}, pl: ${JSON.stringify(c.p('pl'))}, ...more }) });
tell('/plugins/frame-report');
document.getElementById('like').onclick = () => tell('/plugins/like', { href: ${JSON.stringify(c.p('href'))} }).then(() => { document.getElementById('state').textContent = 'Liked'; });</script>`); },
  'POST /plugins/frame-report': (c, w) => frame(c, w) && c.json({}),
  'POST /plugins/like': (c, w) => { c.store.record(frame(c, w), 'T31', `liked ${c.body.href}`, c.body.site, 'like button in a frame'); return c.json({}); },
  // technique 18: the share page learns the article by being opened
  'GET /share': (c, w) => { let site = ''; try { site = new URL(c.p('u')).hostname; } catch {}
    c.store.record(w.ids, 'T31', `share page opened for ${c.p('u')}`, site, 'share link');
    return c.html('Share', `<p id="sharing">Share <code>${c.lab.esc(c.p('u'))}</code> with your friends?</p><button>Share</button>`); },
  'POST /ping': (c, w) => { const cid = c.p('c'), to = c.store.clicks.get(cid); let site = ''; try { site = new URL(to).hostname; } catch {}
    if (to) c.store.record([...w.ids, 'click:' + cid], 'T29', `click ${cid} to ${to}`, site, 'link ping as the link was followed'); return c.send(204, 'text/plain', ''); },
  // technique 5: Pennant sends the browser here with its own number in the address
  'GET /sync': (c, w) => { const pn = c.p('pn_uid');
    if (pn) c.store.record([...w.ids, 'pn_uid:' + pn, c.p('pl') && 'pl:' + c.p('pl')], 'T6', `pn_uid=${pn} is ff_uid=${w.uid}`, c.p('site'), 'redirect from Pennant');
    return c.to(c.lab.at('pennant', `/matched?ff_uid=${w.uid}`)); },
  // technique 17: "Sign in with Friendface"
  'GET /dialog/oauth': (c, w) => { const { esc } = c.lab, app = c.p('app'), back = c.p('back');
    if (!APPS[app] || !back.startsWith(c.lab.at(APPS[app]))) return c.send(400, 'text/plain', 'unknown app');
    if (!w.account) return c.html('Sign in first', '<p>Sign in to <a href="/">Friendface</a>, then come back.</p>');
    return c.html(`Continue to ${c.lab.SITES[APPS[app]]}?`, `<p>${esc(c.lab.SITES[APPS[app]])} will learn your name, ${esc(w.account.name)}.</p>
<form method="post" action="/dialog/oauth?app=${esc(app)}&back=${encodeURIComponent(back)}"><button id="approve">Continue as ${esc(w.account.name)}</button></form>`); },
  'POST /dialog/oauth': (c, w) => { const app = c.p('app'), back = c.p('back');
    if (!w.account || !APPS[app] || !back.startsWith(c.lab.at(APPS[app]))) return c.send(400, 'text/plain', 'not signed in, or unknown app');
    const code = rid('code'); c.store.codes.set(code, { account: w.account, app });
    return c.to(c.lab.at(APPS[app], `/auth/callback?code=${code}&back=${encodeURIComponent(back)}`)); },
  // ---- from server to server: the browser is not involved
  'GET /oauth/token': (c) => { const got = c.store.codes.get(c.p('code'));
    if (c.q.headers['x-lab-server-key'] !== KEY || !got || got.app !== c.p('app')) return c.json({});
    c.store.codes.delete(c.p('code')); const id = 'ffu-' + sha(got.account.id + got.app).slice(0, 10);
    c.store.group(['acct:' + got.account.id, 'appuser:' + id]); return c.json({ id, name: got.account.name }); },
  'POST /s2s/event': (c) => { const b = c.body || {};
    if (c.q.headers['x-lab-server-key'] !== KEY) return c.send(403, 'text/plain', 'servers only');
    if (b.event === 'AppUser') { c.store.record(['appuser:' + b.app_user], 'T32', `${b.site} knows this account as ${b.external_id} (Friendface app ID ${b.app_user})`, b.site, 'written when the button was used'); return c.json({}); }
    const clid = String(b.ffc || '').split('.').pop(), a = c.store.accounts.find((x) => x.hash === b.em);
    const ids = [b.ffp && `_ffp:${b.site}:${b.ffp}`, c.store.clicks.has(clid) && 'click:' + clid, a && 'acct:' + a.id, 'event:' + b.event_id];
    counted(c, b.event_id, 'server', b);
    c.store.record(ids, 'T33', `${b.event} ${b.value} ${b.currency}, order ${b.order}, event ${b.event_id}`, b.site, 'reported by the shop\'s server');
    if (b.em) c.store.record(ids, 'T27', `sha256 ${b.em}: ${a ? 'matches ' + a.email : 'matches no account'}`, b.site, 'sent by the shop\'s server');
    return c.json({ ok: true }); },
  // ---- what the browser grants and keeps for Friendface itself
  'GET /sw.js': (c, w) => c.send(200, 'text/javascript', `const ID = ${JSON.stringify(w.uid)};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(fetch('/worker?site=friendface.localhost&id=' + ID)));`),
  'GET /worker': (c, w) => { const site = c.p('site'), id = c.p('id'), own = site === 'friendface.localhost';
    if (id) c.store.record([...w.ids, own ? 'ff_uid:' + id : `_ffp:${site}:${id}`], 'T13', `worker holds ${id}`, site, 'the worker reported as it started');
    return c.gif(own ? {} : { 'Access-Control-Allow-Origin': '*' }); },
  'GET /perm': (c, w) => { if (c.p('state') === 'granted') c.store.record(w.ids, 'T22', 'notifications: granted', 'friendface.localhost', 'read by a script on Friendface'); return c.json({}); },
  // ---- lab helpers
  'POST /lab/outside': (c, w) => { for (const [id, value] of Object.entries((c.body || {}).rows || {}))
      if (value && TRACES.some((t) => t.id === id && t.read === 'outside')) c.store.record(w.ids, id, value, 'this Chrome profile', 'checked from outside, in Chrome\'s own files');
    return c.json({}); },
  'GET /lab/tomorrow': (c) => { c.store.offset += 86400000; return c.html('Pretend it is tomorrow', `<p id="today">The lab's calendar now says ${new Date(c.store.now()).toISOString().slice(0, 10)}. Only the server moved.</p>`); },
  'POST /lab/forget': (c) => { c.store.forget(); return c.html('Forgotten', '<p>The log is empty.</p>'); },
  // the canary: does a link tag survive a navigation? A cleaner that is switched on strips it.
  'GET /lab/check': (c) => c.to('/lab/check/result?utm_source=canary'),
  'GET /lab/check/result': (c) => { const off = c.p('utm_source') === 'canary';
    c.store.canary = { cleaner: off ? 'seems off' : 'seems on', tag: off ? 'arrived' : 'stripped', blockedName: 'skipped: with .localhost names the request would go to the real company', when: c.store.now() };
    return c.html('Canary', `<p id="canary">cleaner ${c.store.canary.cleaner}</p><p>Link tag: ${c.store.canary.tag}. Blocked name: ${c.store.canary.blockedName}.</p>
<p>"Seems", because another blocker in this Chrome would look the same.</p>`); },
};
module.exports = async function friendface(c) {
  const f = routes[`${c.q.method} ${c.url.pathname}`];
  return f ? f(c, who(c)) : false;
};
module.exports.rhythmDistance = rhythmDistance;
