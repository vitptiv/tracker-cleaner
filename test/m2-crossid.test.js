// M2 (1.26, C33): acting on a confirmed cross-site id -- block the exact collector host+path prefix (never the site
// root), strip the value from request URLs and navigation links, delete a cookie whose value carries it. Aggressive,
// automatic, behind the master switch, never on sign-in hosts, reversible via "Don't clean on this site" + undo.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ID = 'xq7m2k9p4w1z8c3v';
const send = async (bg, site, url, o = {}) => { await bg.request({ url, initiator: `https://${site}`, type: 'image', ...o }); await bg.settle(); };
const confirm = async (bg, a = 'a.example', b = 'b.example') => {   // two visited sites send the same value to their /f/ collector
  await bg.opens(`https://${a}/`); await bg.opens(`https://${b}/`);
  await send(bg, a, `https://${a}/f/hit?cid=${ID}`); await send(bg, b, `https://${b}/f/hit?cid=${ID}`);
  await bg.alarm('sweep');
};
const stripRule = (bg) => bg.state.dynamic.find((r) => r.action.type === 'redirect' && r.condition.regexFilter.includes(ID));

test('the collector path is blocked (not the site root), the strip rules are installed, and a cookie holding the value is deleted (undoable)', async () => {
  const bg = await load(on({ cookies: [{ name: 'track', domain: '.a.example', value: `pre.${ID}.post` }] }));
  await confirm(bg);
  assert.ok(bg.blocks(`https://a.example/f/hit?cid=${ID}`), 'a collector not blocked');
  assert.ok(bg.blocks('https://b.example/f/ping'), 'b collector not blocked');
  assert.equal(bg.blocks('https://a.example/'), false, 'the site root was blocked');
  assert.equal(bg.blocks('https://a.example/home'), false, 'the site root path was blocked');
  assert.ok(stripRule(bg), 'no URL strip rule for the value');
  assert.equal((await bg.names()).includes('track'), false, 'the cookie carrying the value was not deleted');
  assert.ok((await bg.send({ type: 'state' })).undo.some((u) => u.name === 'track'), 'the deleted cookie is not undoable');
});
test('reversible: "Don\'t clean on this site" lifts that site\'s collector block; the other site stays blocked', async () => {
  const bg = await load(on());
  await confirm(bg);
  assert.ok(bg.blocks('https://a.example/f/hit') && bg.blocks('https://b.example/f/hit'));
  await bg.send({ type: 'siteOff', host: 'a.example', on: true }); await bg.settle();
  assert.equal(bg.blocks('https://a.example/f/hit'), false, 'a is still blocked after turning it off');
  assert.ok(bg.blocks('https://b.example/f/hit'), 'b should still be blocked');
});
test('attack: a hostile page cannot get a victim site\'s collector blocked by planting a shared value', async () => {
  const bg = await load(on());
  await bg.opens('https://evil.example/'); await bg.opens('https://victim.example/');
  await send(bg, 'evil.example', `https://evil.example/f/hit?u=${ID}`);          // only the attacker's page sends it
  await bg.visit(`https://victim.example/?x=${ID}`); await bg.settle();          // planted into the victim's address
  await send(bg, 'victim.example', 'https://victim.example/f/hit?sid=v8h3n5b2m7k4j1f6');   // the victim sends only its own value
  await bg.alarm('sweep');
  assert.equal(bg.blocks(`https://victim.example/f/hit?x=${ID}`), false, 'the victim collector was blocked by a planted value');
  assert.equal(bg.blocks('https://evil.example/f/hit'), false, 'one site is not a cross-site id');
  assert.deepEqual(Object.values(bg.state.session.xsid || {}), []);
});
test('never on sign-in: a value sent to a sign-in host is not tracked, and the strip and block rules exclude sign-in hosts', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await send(bg, 'a.example', `https://accounts.google.com/x?cid=${ID}`); await send(bg, 'b.example', `https://accounts.google.com/x?cid=${ID}`);
  await bg.alarm('sweep');
  assert.deepEqual(Object.values(bg.state.session.xsid || {}), [], 'a send to a sign-in host was tracked');
  await confirm(bg);   // now a real cross-site id
  const strip = stripRule(bg), block = bg.state.dynamic.find((r) => r.id >= 102000 && r.id < 102400 && r.action.type === 'block');
  assert.ok(strip.condition.excludedRequestDomains.includes('accounts.google.com'), 'strip does not exclude sign-in hosts');
  assert.ok(block.condition.excludedInitiatorDomains.includes('accounts.google.com'), 'block does not exclude sign-in hosts');
});
test('C33 off: nothing is tracked, blocked, stripped or deleted', async () => {
  const bg = await load(on({ storage: { modes: { C33: 'off' } }, cookies: [{ name: 'track', domain: '.a.example', value: ID }] }));
  await confirm(bg);
  assert.deepEqual(Object.values(bg.state.session.xsid || {}), []);
  assert.equal(bg.blocks('https://a.example/f/hit'), false);
  assert.equal(stripRule(bg), undefined);
  assert.ok((await bg.names()).includes('track'), 'the cookie was deleted with C33 off');
});
