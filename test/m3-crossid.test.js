// M3 (1.26, C33): strip a confirmed cross-site id from an in-page history pushState/replaceState (webNavigation
// onHistoryStateUpdated) -- the one hand-off the DNR strip rules cannot see. Network navigations (link, scripted
// location.assign, meta refresh) are stripped on the wire by the M2 DNR rules before commit, so M3 does not touch
// them (verified in the browser). Never a sign-in page/company, a site turned off, or a return-address parameter.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ID = 'xq7m2k9p4w1z8c3v';
const send = async (bg, site, url) => { await bg.request({ url, initiator: `https://${site}`, type: 'image' }); await bg.settle(); };
const confirm = async (bg) => {   // two visited sites send the same value -> a confirmed cross-site id
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await send(bg, 'a.example', `https://a.example/f/hit?cid=${ID}`); await send(bg, 'b.example', `https://b.example/f/hit?cid=${ID}`);
  await bg.alarm('sweep');
};
const updates = (bg) => bg.called('tabs.update').map((c) => c.args[1] && c.args[1].url).filter(Boolean);
const tab = (bg, id, url) => { bg.state.tabs.push({ id, windowId: 1, url, active: true }); return id; };
const push = (bg, tabId, url) => bg.navTo(url, { tabId, phase: 'history' });

test('a history pushState carrying a confirmed id is cleaned, other parameters kept', async () => {
  const bg = await load(on()); await confirm(bg);
  tab(bg, 51, 'https://dest.example/');
  await push(bg, 51, `https://dest.example/app?cid=${ID}&keep=1`); await bg.settle();
  assert.ok(updates(bg).includes('https://dest.example/app?keep=1'), `not cleaned: ${JSON.stringify(updates(bg))}`);
});
test('a network navigation is left to the DNR strip rules on the wire -- M3 does not reload it', async () => {
  const bg = await load(on()); await confirm(bg);
  tab(bg, 50, 'https://dest.example/');
  await bg.navTo(`https://dest.example/land?ref=${ID}`, { tabId: 50 }); await bg.settle();   // a commit-phase navigation
  assert.deepEqual(updates(bg), [], 'M3 reloaded a network navigation DNR already cleans before commit');
});
test('never a sign-in page, a return-address parameter, a site turned off, or with C33 off', async () => {
  const bg = await load(on()); await confirm(bg);
  tab(bg, 52, 'https://accounts.google.com/');
  await push(bg, 52, `https://accounts.google.com/o?ref=${ID}`); await bg.settle();
  assert.deepEqual(updates(bg), [], 'a sign-in page was touched');
  tab(bg, 53, 'https://dest.example/');
  await push(bg, 53, `https://dest.example/login?redirect_uri=https%3A%2F%2Fdest.example%2Fcb%3Fx%3D${ID}`); await bg.settle();
  assert.deepEqual(updates(bg), [], 'a sign-in return-address parameter was cut');
  await bg.send({ type: 'siteOff', host: 'dest.example', on: true }); await bg.settle();
  await push(bg, 53, `https://dest.example/app?ref=${ID}`); await bg.settle();
  assert.deepEqual(updates(bg), [], 'a site the user turned off was cleaned');

  const off = await load(on({ storage: { modes: { C33: 'off' } } })); await confirm(off);
  tab(off, 54, 'https://dest.example/');
  await push(off, 54, `https://dest.example/app?ref=${ID}`); await off.settle();
  assert.deepEqual(updates(off), [], 'C33 off still cleaned');
});
test('attack kept intact: an unconfirmed value in a pushState is left alone', async () => {
  const bg = await load(on());   // nothing confirmed
  await bg.opens('https://evil.example/'); await bg.opens('https://victim.example/');
  await send(bg, 'evil.example', `https://evil.example/f/hit?u=${ID}`);   // only the attacker sent it: not confirmed
  await bg.alarm('sweep');
  tab(bg, 55, 'https://victim.example/');
  await push(bg, 55, `https://victim.example/app?ref=${ID}`); await bg.settle();
  assert.deepEqual(updates(bg), [], 'an unconfirmed value was stripped from a victim pushState');
});
