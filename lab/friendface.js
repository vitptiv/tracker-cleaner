'use strict';
// Friendface: the pretend network. Its own pages, and the pieces other sites embed.
const { rid, sha } = require('./store'), { know, page } = require('./know');
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
    return `<p class="post"><a id="post-${i + 1}" href="${esc(c.lab.at('hop', `/r?c=${cid}&to=${encodeURIComponent(c.lab.at(site, path))}`))}" ping="/ping?c=${cid}">${esc(title)}</a></p>`; }).join('\n')}`); },
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
module.exports.routes = routes; module.exports.who = who;
