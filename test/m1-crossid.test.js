// M1 (1.26, C33): the cross-site identifier detector wired into background.js. A high-entropy value the cleaner sees
// SENT by two different sites the user visited is confirmed a cross-site id, kept in chrome.storage.session (the key is
// hashed; the raw value lives only in session memory, never storage.local, the log or a report). A value an attacker
// merely reflects into a victim's address is not attributed to the victim. M1 only detects; acting on it is M2.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ID = 'xq7m2k9p4w1z8c3v';   // 16 chars, letters and digits, high entropy
const send = async (bg, site, url, o = {}) => { await bg.request({ url, initiator: `https://${site}`, type: 'image', ...o }); await bg.settle(); };
const xsid = (bg) => bg.state.session.xsid || {};
const raws = (bg) => Object.values(xsid(bg)).map((e) => e.raw).sort();
const xseen = (bg) => bg.state.session.xseen || {};

test('a value sent by two visited sites is confirmed; one site is not enough; the raw value never leaves session memory', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await send(bg, 'a.example', `https://a.example/f/hit?cid=${ID}`);
  await bg.alarm('sweep'); assert.deepEqual(raws(bg), [], 'one site should not confirm');
  await send(bg, 'b.example', `https://b.example/f/hit?cid=${ID}`);
  await bg.alarm('sweep');
  assert.deepEqual(raws(bg), [ID]);
  const e = Object.values(xsid(bg))[0];
  assert.equal(e.n, 2); assert.ok(e.eps.includes('a.example/f/') && e.eps.includes('b.example/f/'), JSON.stringify(e.eps));
  assert.equal(JSON.stringify(bg.state.storage).includes(ID), false, 'the raw value reached storage.local');
  assert.equal(JSON.stringify(bg.reports).includes(ID), false, 'the raw value reached a report');
});
test('weaponization: a value an attacker reflects into a victim\'s address does not get the victim counted', async () => {
  const bg = await load(on());
  await bg.opens('https://evil.example/'); await bg.opens('https://victim.example/');
  await send(bg, 'evil.example', `https://evil.example/collect?u=${ID}`);         // the attacker's own page sends it
  await bg.visit(`https://victim.example/?x=${ID}`); await bg.settle();           // then links to the victim with it in the address
  await send(bg, 'victim.example', 'https://victim.example/f/hit?sid=v8h3n5b2m7k4j1f6');   // the victim sends only its own value
  await bg.alarm('sweep');
  assert.deepEqual(raws(bg), [], 'the planted value was attributed to the victim');
  const e = Object.values(xseen(bg)).find((x) => x.raw === ID);
  assert.ok(e, 'the attacker\'s own send was recorded'); assert.equal(Object.keys(e.sites).length, 1, 'only the attacker\'s site sent it');
});
test('both sending sites must be ones you visited; a site visited later still counts (re-checked each sweep)', async () => {
  const bg = await load(on());
  await send(bg, 'a.example', `https://a.example/f?cid=${ID}`); await send(bg, 'b.example', `https://b.example/f?cid=${ID}`);
  await bg.alarm('sweep'); assert.deepEqual(raws(bg), [], 'confirmed with neither site visited');
  await bg.opens('https://a.example/'); await bg.alarm('sweep'); assert.deepEqual(raws(bg), [], 'confirmed with only one site visited');
  await bg.opens('https://b.example/'); await bg.alarm('sweep'); assert.deepEqual(raws(bg), [ID]);
});
test('caps: at most 10 tokens new to a site in an hour are tracked', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/');
  const T = (i) => `id${i.toString(36)}k9x2m4q8r1t7zh`;   // 17 chars each, distinct per i
  for (let i = 0; i < 12; i++) await send(bg, 'a.example', `https://a.example/f?cid=${T(i)}`);
  assert.equal(Object.keys(xseen(bg)).length, 10);
});
test('C33 off: nothing is observed', async () => {
  const bg = await load(on({ storage: { modes: { C33: 'off' } } }));
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await send(bg, 'a.example', `https://a.example/f?cid=${ID}`); await send(bg, 'b.example', `https://b.example/f?cid=${ID}`);
  await bg.alarm('sweep');
  assert.deepEqual(xseen(bg), {}); assert.deepEqual(raws(bg), []);
});
