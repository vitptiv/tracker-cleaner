// M5 (1.26, C33): a first-party ETag that carries a confirmed cross-site id. The browser would echo it back as
// If-None-Match on revalidation, re-identifying the browser. When the same id-like ETag is seen on two visited sites,
// the cleaner strips the conditional headers for THAT exact resource (a fresh fetch instead of a 304), leaving the
// caching of every other resource intact.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ID = 'xq7m2k9p4w1z8c3v';
const etag = async (bg, site, path, value) => { await bg.answer({ url: `https://${site}${path}`, initiator: `https://${site}`, type: 'image', responseHeaders: [{ name: 'ETag', value }] }); await bg.settle(); };
const etagRules = (bg) => bg.state.dynamic.filter((r) => r.action.type === 'modifyHeaders' && r.id >= 102800);

test('an ETag with the same id on two visited sites: the conditional headers are stripped for each resource', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await etag(bg, 'a.example', '/assets/logo.png', `"${ID}"`);
  await bg.alarm('sweep'); assert.deepEqual(etagRules(bg), [], 'one site should not confirm');
  await etag(bg, 'b.example', '/img/logo.png', `"${ID}"`);
  await bg.alarm('sweep');
  const rules = etagRules(bg);
  assert.equal(rules.length, 2);
  assert.ok(rules.every((r) => r.action.requestHeaders.some((h) => h.header === 'if-none-match' && h.operation === 'remove')));
  assert.ok(rules.some((r) => new RegExp(r.condition.regexFilter).test('https://a.example/assets/logo.png')));
  assert.ok(rules.some((r) => new RegExp(r.condition.regexFilter).test('https://b.example/img/logo.png')));
  // caching of a different resource on the same site is NOT touched
  assert.ok(rules.every((r) => !new RegExp(r.condition.regexFilter).test('https://a.example/assets/other.png')));
  assert.equal(JSON.stringify(bg.state.storage).includes(ID), false, 'the raw ETag id reached storage.local');
});
test('a non-id ETag and a per-site ETag do not strip caching', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await etag(bg, 'a.example', '/logo.png', '"W/abc123"');        // short, not id-like
  await etag(bg, 'a.example', '/v.png', `"${ID}"`);              // id-like but only on ONE site
  await bg.alarm('sweep');
  assert.deepEqual(etagRules(bg), [], 'caching was stripped without a confirmed cross-site ETag id');
});
test('C33 off: an ETag id is neither tracked nor stripped', async () => {
  const bg = await load(on({ storage: { modes: { C33: 'off' } } }));
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await etag(bg, 'a.example', '/logo.png', `"${ID}"`); await etag(bg, 'b.example', '/logo.png', `"${ID}"`);
  await bg.alarm('sweep');
  assert.deepEqual(etagRules(bg), []); assert.deepEqual(bg.state.session.xseen || {}, {});
});
