// R1 (C25), the pure part: what counts as one site, what looks like an ID, and the private count of who follows.
const test = require('node:test'), assert = require('node:assert');
const { FOLLOW_N, FOLLOW_MAX, siteOf, idLike, idInUrl, followNote, followFull } = require('../extension/learn.js');

test('a site is its last two labels, three under co.uk and the like; a port is not part of it', () => {
  assert.deepEqual(['www.example.com', 'a.b.example.co.uk', 'gazette.localhost:8200', 'metrics.shop.localhost', '127.0.0.1'].map(siteOf),
    ['example.com', 'example.co.uk', 'gazette.localhost', 'shop.localhost', '127.0.0.1']);
});
test('ID-like: long mixed letters and digits or a long number; not a word, a language or a short value', () => {
  for (const v of ['u-3fa9c2d1e0', 'GA1.2.1234567890.1700000000', 'ffp.1.1731888000000.4567', '550e8400-e29b-41d4-a716-446655440000']) assert.equal(idLike(v), true, v);
  for (const v of ['', 'true', 'en-US', 'dark', 'accepted', '12345', 'light-mode']) assert.equal(idLike(v), false, v);
});
test('an ID in an address: a long random value, but not a version or a time', () => {
  assert.equal(idInUrl('https://t.example/p.gif?uid=3fa9c2d1e07b4a55aa01'), true);
  for (const u of ['https://cdn.example/app.js?v=3fa9c2d1e07b4a55aa01', 'https://cdn.example/a.css?ts=1731888000000', 'https://cdn.example/font.woff2', 'nonsense']) assert.equal(idInUrl(u), false, u);
});
test('the count: one mark per site, never the site name, full at two (1.25, S6); nothing new gives null', () => {
  let s = followNote(undefined, 't.example', 'px.t.example', 'news.example', false, 1);
  assert.equal(followNote(s, 't.example', 'px.t.example', 'news.example', false, 2), null);
  assert.equal(followFull(s['t.example']), false);
  s = followNote(s, 't.example', 'cdn.t.example:8443', 'shop.example', true, 4);
  assert.equal(followFull(s['t.example']), true); assert.equal(s['t.example'].ck, true); assert.deepEqual(s['t.example'].hosts, ['px.t.example', 'cdn.t.example:8443']);
  assert.equal(followNote(s, 't.example', 'px.t.example', 'fourth.example', false, 5), null);
  assert.equal(s['t.example'].on.length, FOLLOW_N);
  assert.equal(/news|shop|blog/.test(JSON.stringify(s)), false);
});
test('the store is bounded: the companies unseen longest go', () => {
  let s = {}; for (let i = 0; i < FOLLOW_MAX + 5; i++) s = followNote(s, `t${i}.example`, `t${i}.example`, 'a.example', false, i);
  assert.equal(Object.keys(s).length, FOLLOW_MAX); assert.equal('t0.example' in s, false); assert.equal(`t${FOLLOW_MAX + 4}.example` in s, true);
});
