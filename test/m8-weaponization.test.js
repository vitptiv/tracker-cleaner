'use strict';
// M8: C33 acts only on a FIRST-PARTY collector (an endpoint served under a sending site's own name), never on an
// unrelated host a value was merely sent to. These pins close the fifth audit's findings and prove the Friendface 2
// counter is unchanged (a genuine first-party collector is still blocked).
const test = require('node:test'), assert = require('node:assert');
const load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ID = 'xq7m2k9p4w1z8c3v';                       // one attacker/tracker token, high-entropy
const img = async (bg, site, url) => { await bg.request({ url, initiator: `https://${site}`, type: 'image' }); await bg.settle(); };

// FINDING 1 (critical): a script shared on two visited sites must NOT get an unrelated third party's endpoint blocked.
test('M8: a cross-site value sent to a THIRD-PARTY endpoint does not block it (no arbitrary-endpoint DoS)', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await img(bg, 'a.example', `https://victim.example/api/data?u=${ID}`);
  await img(bg, 'b.example', `https://victim.example/api/data?u=${ID}`);
  await bg.alarm('sweep');
  assert.equal(bg.blocks('https://victim.example/api/data'), false, 'victim /api/ must NOT be blocked');
  assert.equal(bg.blocks('https://victim.example/api/other'), false);
  // the value is still recognised as cross-site (it is), it just yields no first-party endpoint to act on
  const vals = Object.values(bg.state.session.xsid || {});
  assert.deepEqual(vals, [], 'Q-batch F4 (1.32): a value no site sent to its own name is not even confirmed');
});

// FINDING 2 (critical): path '/' must never block the whole site.
test('M8: a value sent to a bare-root first-party path never blocks the whole site', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  // first-party (same-site as sender), but at the bare root -- still must not block the site
  await img(bg, 'a.example', `https://a.example/?u=${ID}`);
  await img(bg, 'b.example', `https://b.example/?u=${ID}`);
  await bg.alarm('sweep');
  assert.equal(bg.blocks('https://a.example/'), false);
  assert.equal(bg.blocks('https://a.example/home'), false);
  assert.equal(bg.blocks('https://a.example/login'), false);
});

// Counter intact: a genuine FIRST-PARTY collector (Friendface 2 shape) is still blocked going forward.
test('M8: a first-party collector path IS still blocked (Friendface 2 counter unchanged)', async () => {
  const bg = await load(on());
  await bg.opens('https://ledger.example/'); await bg.opens('https://sundial.example/');
  await img(bg, 'ledger.example', `https://ledger.example/f/hit?c=${ID}`);    // same id, each site to its OWN /f/
  await img(bg, 'sundial.example', `https://sundial.example/f/hit?c=${ID}`);
  await bg.alarm('sweep');
  assert.ok(bg.blocks('https://ledger.example/f/hit'), 'first-party collector path blocked');
  assert.ok(bg.blocks('https://sundial.example/f/anything'), 'blocked by prefix');
  assert.equal(bg.blocks('https://ledger.example/'), false, 'but never the site root');
  assert.equal(bg.blocks('https://ledger.example/budget'), false, 'ordinary pages keep working');
});

// FINDING 3 (high): a benign content-hashed CDN bundle shared by two sites is a PATH segment (not ?param=), and the CDN
// is third-party, so neither the strip nor the block touches it.
test('M8: a shared content-hashed CDN asset does not get its directory blocked', async () => {
  const bg = await load(on());
  await bg.opens('https://shopA.example/'); await bg.opens('https://shopB.example/');
  const u = 'https://cdn.vendor.example/assets/widget.3f9a2b7c1d8e4f5a6b9c.js';
  await bg.request({ url: u, initiator: 'https://shopA.example', type: 'script' }); await bg.settle();
  await bg.request({ url: u, initiator: 'https://shopB.example', type: 'script' }); await bg.settle();
  await bg.alarm('sweep');
  assert.equal(bg.blocks('https://cdn.vendor.example/assets/other.css'), false, 'the CDN directory must not be blocked');
  assert.equal(bg.blocks(u), false);
});

// FINDING 4 (high): cookie deletion only on a confirmed first-party collector site; never an unrelated origin; the
// keep-list is honoured.
test('M8: cookie deletion is scoped to the collector site and honours the keep-list', async () => {
  const bg = await load(on({ cookies: [
    { name: 'prefs', domain: '.third.example', value: `theme=dark&build=${ID}&x=1` },        // unrelated site, coincidental substring
    { name: 'kept', domain: '.ledger.example', value: `k=${ID}` },                            // on the collector site but user keeps it
    { name: 'track', domain: '.ledger.example', value: `id=${ID}` },                          // on the collector site, fair game
  ], storage: { allow: [{ site: 'ledger.example', name: 'kept' }] } }));
  await bg.opens('https://ledger.example/'); await bg.opens('https://sundial.example/');
  await img(bg, 'ledger.example', `https://ledger.example/f/hit?c=${ID}`);
  await img(bg, 'sundial.example', `https://sundial.example/f/hit?c=${ID}`);
  await bg.alarm('sweep');
  await bg.alarm('learned'); await bg.settle();
  const names = await bg.names();
  assert.ok(names.includes('prefs'), 'unrelated third.example cookie must NOT be deleted');
  assert.ok(names.includes('kept'), 'a kept (allow-listed) cookie must NOT be deleted');
  assert.ok(!names.includes('track'), 'the collector-site id cookie IS deleted');
});

// FINDING 5 (med): turning a site off excludes it as INITIATOR, so its own outbound requests are no longer stripped.
test('M8: Don’t clean on this site also lifts the strip for that site as initiator', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await img(bg, 'a.example', `https://a.example/f/x?c=${ID}`);
  await img(bg, 'b.example', `https://b.example/f/x?c=${ID}`);
  await bg.alarm('sweep');
  await bg.send({ type: 'siteOff', host: 'a.example', on: true }); await bg.settle();
  const strip = bg.state.dynamic.find((r) => r.action.type === 'redirect' && r.condition.regexFilter.includes(ID));
  assert.ok(strip, 'a strip rule exists');
  assert.ok((strip.condition.excludedInitiatorDomains || []).includes('a.example'), 'off-site excluded as initiator');
  const block = bg.state.dynamic.find((r) => r.action.type === 'block' && /a\.example\/f\//.test(r.condition.regexFilter));
  if (block) assert.ok((block.condition.excludedInitiatorDomains || []).includes('a.example'), 'off-site excluded on the block too');
});
