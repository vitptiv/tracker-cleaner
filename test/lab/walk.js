'use strict';
// The trip's actions (lab/trip.json) without any demand. trip.js checks after every step; trip-cleaner.js only measures,
// with `soft` set: a visit that does not reach Friendface is then a result, not a failure.
const http = require('node:http');
const { outside } = require('../../lab/outside'), { sleep, until } = require('./chrome');
const MARA = { name: 'Mara Lindqvist', email: 'mara.lindqvist@example.test', password: 'lab-only-1' };

// launch(dir) starts the throwaway Chrome (again on `dir` after the restart) and returns it
function makeWalk({ lab, port, launch, soft = false }) {
  const at = (site, p = '/') => `http://${site}.localhost:${port}${p}`;
  const E = { at, visited: [], notes: {}, b: null, t: null, kt: null };
  E.know = () => E.kt.ev(`fetch('/what-i-know.json').then((r) => r.json())`);
  E.cookie = async (name, host) => (await E.b.cookies()).find((c) => c.name === name && c.domain.replace(/^\./, '') === host + '.localhost');
  // a page of a content site was opened: has Friendface listed it, as often as the trip opened it?
  E.landed = async (s = E.t) => { const url = await s.url(); E.visited.push(url); const n = E.visited.filter((u) => u === url).length;
    const reached = !!await until(async () => (await E.know()).history.filter((h) => h.url === url).length >= n, soft ? 2500 : 10000);
    if (!reached && !soft) throw new Error(`the visit to ${url} did not reach Friendface`); return reached; };
  E.open = async () => { E.b = await launch();
    await E.b.send('Browser.grantPermissions', { origin: at('friendface', '').replace(/\/$/, ''), permissions: ['notifications'] });   // the press on "Allow", simulated
    E.kt = await E.b.tab(at('friendface', '/lab/check')); E.t = await E.b.tab(); };
  const fill = async (s, fields) => { for (const [sel, text] of fields) await s.type(sel, text, 5); };
  const steps = {
    1: async () => { await E.t.go(at('gazette')); await E.landed(); await E.t.clickAndLoad('#a-harbour-bridge'); await E.landed(); await E.t.ev('window.scrollTo(0, document.body.scrollHeight)'); },
    2: async () => { await E.t.go(at('friendface')); await fill(E.t, [['#join [name=name]', MARA.name], ['#join [name=email]', MARA.email], ['#join [name=password]', MARA.password]]); await E.t.clickAndLoad('#join button'); },
    3: async () => { await E.t.clickAndLoad('#post-1'); await E.landed(); },
    4: async () => { const f = await until(() => E.t.point('#like')); await E.t.mouse(f.x - 100, f.y - 10);
      await E.t.clickAndLoad('#signin-with'); await E.t.clickAndLoad('#approve'); await E.landed();
      await E.t.type('#comment', 'Nice post'); await E.t.clickAndLoad('#send'); await E.landed(); },
    // this tab comes from a second address, simulated with a forwarded-for header
    5: async () => { const v = await E.b.tab(); await v.send('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
      await v.go(at('loopreel')); await E.landed(v); await v.click('#play'); await sleep(2000); await v.send('Page.close'); },
    6: async () => { await E.t.go(at('gazette')); await E.landed(); await E.t.type('#search [name=q]', 'kite repair'); await E.t.clickAndLoad('#search button'); await E.landed();
      for (let i = 0; i < 12; i++) { await E.t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200 + i * 25, y: 300 + (i % 3) * 20 }); await sleep(20); }
      await E.t.type('#nl', MARA.email, 60); await sleep(1200);
      await E.t.go(at('gazette', '/article/harbour-bridge')); await E.landed(); await E.t.click('#share');
      const share = await until(async () => (await E.b.send('Target.getTargets')).targetInfos.find((x) => x.url.includes('/share?u=')));
      E.notes.shareOpened = !!share; if (share) { await sleep(300); await E.b.send('Target.closeTarget', { targetId: share.targetId }); } },
    7: async () => { await E.t.go(at('friendface')); await E.t.clickAndLoad('#post-2'); await E.landed(); await E.t.clickAndLoad('#add'); await E.landed();
      await E.t.clickAndLoad('#checkout'); await E.landed(); await fill(E.t, [['#email', MARA.email], ['#name', MARA.name], ['#city', 'Nordhavn'], ['#postcode', '00100']]);
      await E.t.clickAndLoad('#buy'); await E.landed(); },
    // Chrome is closed, its own files are read from outside and handed to the lab under this browser's cookie, then it starts again
    8: async () => { const dir = E.b.dir, uid = ((await E.cookie('ff_uid', 'friendface')) || {}).value; await E.b.close(true); E.notes.outside = outside(dir, port);
      if (uid) await new Promise((done, fail) => http.request({ host: '127.0.0.1', port, path: '/lab/outside', method: 'POST', headers: { Host: `friendface.localhost:${port}`, Cookie: `ff_uid=${uid}` } }, (r) => { r.resume(); r.on('end', done); }).on('error', fail).end(JSON.stringify({ rows: E.notes.outside })));
      E.b = await launch(dir); E.kt = await E.b.tab(at('friendface', '/what-i-know')); E.t = await E.b.tab(); },
    9: async () => { await E.t.go(at('gazette', '/article/harbour-bridge')); await E.landed(); },
    10: async () => { E.notes.ffpBefore = ((await E.cookie('_ffp', 'gazette')) || {}).value; await E.t.go(at('gazette', '/lab/delete-id')); E.notes.ffpDeleted = !(await E.cookie('_ffp', 'gazette'));
      await E.t.go(at('gazette')); await E.landed(); E.notes.ffpAfter = ((await E.cookie('_ffp', 'gazette')) || {}).value; },
    11: async () => { await E.t.go(at('tidewater', '/post/mending-a-kite')); await E.landed(); },
    12: async () => { await E.b.send('Storage.clearCookies'); E.notes.cookiesLeft = (await E.b.cookies()).length; await E.t.go(at('gazette')); await E.landed(); },
  };
  return { E, steps, MARA };
}
module.exports = { makeWalk, MARA };
