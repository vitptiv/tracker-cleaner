// S2a: after a stop the saved copies are cleared again a minute later and when Chrome starts.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const req = async (bg, host, page) => { await bg.request({ url: `https://${host}/px.gif`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const three = async (bg) => { for (const p of ['news.example', 'shop.example', 'blog.example']) await req(bg, 'px.trk.example', p); };
const ID = { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const on = (o = {}) => ({ cookies: [ID], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const clears = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache && c.args[0].since === 0).length;
const blocked = (bg, site = 'trk.example') => bg.called('contentSettings.set').filter((c) => c.args[0].primaryPattern === `*://*.${site}/*` && c.args[0].setting === 'block').length;

test('a stop clears the saved copies, sets one wake-up a minute later, and that clears them once more', async () => {
  const bg = await load(on()); await three(bg);
  assert.equal(clears(bg), 1); assert.equal(bg.state.alarms.copies.when, bg.now + 60e3);
  await bg.alarm('copies'); assert.equal(clears(bg), 2);
});
test('when Chrome starts the saved copies are cleared if a tracker is stopped, and not otherwise; never while a sign-in is in front or cleaning is off', async () => {
  const start = async (o) => { const bg = await load(o); await bg.chrome.runtime.onStartup.fire(); await bg.settle(); return clears(bg); };
  assert.equal(await start(on({ storage: { stopped: ['trk.example'] } })), 1);
  assert.equal(await start(on()), 0);
  assert.equal(await start(on({ storage: { stopped: ['trk.example'] }, tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }] })), 0);
  assert.equal(await start(on({ storage: { stopped: ['trk.example'], master: false } })), 0);
  assert.equal(await start(on({ storage: { stopped: ['trk.example'], modes: { C11: 'off' } } })), 0);
});
