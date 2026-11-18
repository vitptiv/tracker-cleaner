// M1 (1.26): the pure cross-site-id helpers (extension/xsid.js). No browser, no state.
const test = require('node:test'), assert = require('node:assert');
const { idTokens, idValue, pathPrefix, tokHash, fnv1a, XID_MIN, applyStrip, blockRe, xidRules, stripNav, RETURN_PARAMS } = require('../extension/xsid.js');

test('idTokens picks only long, high-entropy values; not dates, numbers, words or short strings', () => {
  assert.equal(XID_MIN, 12);
  assert.deepEqual(idTokens('?cid=xq7m2k9p4w1z8c3v&t=1700000000&lang=en-US'), ['xq7m2k9p4w1z8c3v']);
  assert.deepEqual(idTokens('ff2m-18f3a2b1c4d5e6f7 and sid=9f8e7d6c5b4a3210'), ['ff2m-18f3a2b1c4d5e6f7', '9f8e7d6c5b4a3210']);
  assert.deepEqual(idTokens('{"ev":"view","m":"a1b2c3d4e5f6g7h8"}'), ['a1b2c3d4e5f6g7h8']);
  for (const s of ['2026-11-18', 'hello-world-again', '12345678', 'aaaaaaaaaaaaaa', 'abababababab', 'short1a', '', null, undefined])
    assert.deepEqual(idTokens(s), [], JSON.stringify(s));
});
test('idValue is true for one id-like value, false for an ordinary one', () => {
  assert.equal(idValue('xq7m2k9p4w1z8c3v'), true);
  assert.equal(idValue('en-US'), false); assert.equal(idValue('1700000000'), false);
});
test('tokHash is salted and deterministic; fnv1a is 8 hex', () => {
  assert.equal(tokHash('s', 'abc'), tokHash('s', 'abc'));
  assert.notEqual(tokHash('s', 'abc'), tokHash('t', 'abc'));   // a different salt hashes differently
  assert.notEqual(tokHash('s', 'abc'), tokHash('s', 'abd'));
  assert.match(fnv1a('anything'), /^[0-9a-f]{8}$/);
});
test('pathPrefix keeps the request directory, never the bare root', () => {
  assert.equal(pathPrefix('/f/hit'), '/f/');
  assert.equal(pathPrefix('/a/b/c'), '/a/b/');
  assert.equal(pathPrefix('/collect'), '/collect');   // one segment: cut nothing, or it would be the whole site
  assert.equal(pathPrefix('/'), '/');
  assert.equal(pathPrefix(''), '/');
});
// M2 helpers
const T = 'xq7m2k9p4w1z8c3v';
test('applyStrip removes the token from a URL whatever its position and parameter name, and leaves other URLs alone', () => {
  assert.equal(applyStrip(`https://s.example/p?cid=${T}`, T), 'https://s.example/p');                       // sole param
  assert.equal(applyStrip(`https://s.example/p?cid=${T}&q=1`, T), 'https://s.example/p?q=1');                // first of several
  assert.equal(applyStrip(`https://s.example/p?q=1&ref=${T}`, T), 'https://s.example/p?q=1');                // last param
  assert.equal(applyStrip(`https://s.example/p?q=1&ref=${T}&z=2`, T), 'https://s.example/p?q=1&z=2');        // middle param
  assert.equal(applyStrip(`https://s.example/p?cid=${T}#frag`, T), 'https://s.example/p#frag');              // keeps the fragment
  assert.equal(applyStrip(`https://s.example/p?cid=${T}x&q=1`, T), `https://s.example/p?cid=${T}x&q=1`);      // not a prefix match
  assert.equal(applyStrip('https://s.example/p?q=1', T), 'https://s.example/p?q=1');                         // token absent
});
test('xidRules builds a priority-2 collector block and priority-1 URL-strip rules, with the sign-in and off exemptions', () => {
  const rules = xidRules({ eps: ['col.example:8300/f/'], toks: [T], block: 102000, strip: 102400, signin: ['accounts.google.com'], off: ['mine.example'], blockTypes: ['image'], stripTypes: ['main_frame'] });
  const block = rules.find((r) => r.action.type === 'block'), strips = rules.filter((r) => r.action.type === 'redirect');
  assert.equal(block.id, 102000); assert.equal(block.priority, 2);
  assert.match(block.condition.regexFilter, /col\\\.example:8300\/f\//); assert.deepEqual(block.condition.excludedInitiatorDomains, ['accounts.google.com']);
  assert.deepEqual(block.condition.excludedRequestDomains, ['mine.example']);
  assert.equal(strips.length, 3); assert.ok(strips.every((r) => r.priority === 1 && r.condition.excludedRequestDomains.includes('accounts.google.com') && r.condition.excludedRequestDomains.includes('mine.example')));
  assert.ok(strips.every((r) => r.condition.regexFilter.includes('xq7m2k9p4w1z8c3v')));
});
test('blockRe matches the collector path but not the site root', () => {
  const re = new RegExp(blockRe('col.example', '/f/'));
  assert.ok(re.test('https://col.example/f/hit?x=1')); assert.equal(re.test('https://col.example/'), false); assert.equal(re.test('https://col.example/home'), false);
});
// M3 helper
test('stripNav removes a confirmed id from any ordinary parameter but keeps sign-in return-address params', () => {
  assert.equal(stripNav(`https://s.example/p?ref=${T}&q=1`, [T]), 'https://s.example/p?q=1');
  assert.equal(stripNav(`https://s.example/p?cid=${T}`, [T]), 'https://s.example/p');
  assert.equal(stripNav(`https://s.example/p?u=${T}`, [T]), 'https://s.example/p');   // the chain's short names ARE cut
  assert.equal(stripNav(`https://s.example/p?q=1`, [T]), null, 'no token present');
  assert.equal(stripNav('https://s.example/p', [T]), null, 'no query');
  // a sign-in return-address parameter is left whole even when the id is nested in its callback URL (would break OAuth)
  assert.ok(RETURN_PARAMS.includes('redirect_uri') && RETURN_PARAMS.includes('state'));
  assert.equal(stripNav(`https://s.example/login?redirect_uri=https%3A%2F%2Fs.example%2Fcb%3Fx%3D${T}&state=${T}`, [T]), null);
  // a tracking param alongside a return param: cut the tracker, keep the return address
  assert.equal(stripNav(`https://s.example/login?state=abc&sid=${T}`, [T]), 'https://s.example/login?state=abc');
});
