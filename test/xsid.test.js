// M1 (1.26): the pure cross-site-id helpers (extension/xsid.js). No browser, no state.
const test = require('node:test'), assert = require('node:assert');
const { idTokens, idValue, pathPrefix, tokHash, fnv1a, XID_MIN } = require('../extension/xsid.js');

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
