// L5 (fourth audit): caps without side effects.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const cookie = (domain) => ({ name: 'uid', domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' });
const asks = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.filter((i) => i.kind === 'tracker').map((i) => i.site);
const cleared = (bg) => bg.called('contentSettings.clear').length;
const KEEP = { 'a.example': { ok: true, at: 1.8e12, mute: true }, 'b.example': { ok: true, at: 1.8e12, mute: true } };

test('letting one host through again touches that host\'s notification setting only: no other block is taken away or forgotten', async () => {
  const bg = await load(on({ storage: { stopped: ['a.example', 'b.example'], hard: ['a.example', 'b.example'], own: KEEP } }));
  await bg.send({ type: 'unstop', site: 'a.example' }); await bg.settle();
  assert.equal(cleared(bg), 0, 'every notification block was cleared');
  assert.deepEqual(bg.called('contentSettings.set').map((c) => [c.args[0].primaryPattern, c.args[0].setting]).filter(([p]) => /\.[ab]\.example/.test(p)), [['*://*.a.example/*', 'ask']]);
  assert.equal(bg.state.storage.own['b.example'].mute, true); assert.equal('a.example' in bg.state.storage.own, false);
});
test('the same when the oldest block makes room at the cap', async () => {
  const stopped = ['a.example', 'b.example', ...Array.from({ length: 298 }, (_, i) => `old${i}.example`)];
  const bg = await load(on({ cookies: [cookie('trk.example')], storage: { stopped, hard: ['a.example', 'b.example'], own: KEEP } }));
  await req(bg, 'https://trk.example/a.js', 'news.example'); await req(bg, 'https://trk.example/a.js', 'shop.example'); await bg.block('trk.example');
  assert.equal(bg.state.storage.stopped.includes('a.example'), false); assert.ok(bg.state.storage.stopped.includes('trk.example'));
  assert.equal(cleared(bg), 0); assert.equal(bg.state.storage.own['b.example'].mute, true);
});
test('junk candidates never touch what the user pressed: the blocked hosts and the hosts chosen for skipping stay', async () => {
  const bg = await load(on({ storage: { stopped: ['a.example'], skipok: ['hop.example'] } }));
  for (let i = 0; i < 400; i++) { bg.now += 4 * 60e3; await req(bg, `https://junk${i}.example/a.js`, `p${i % 40}.example`); }
  assert.deepEqual(bg.state.storage.stopped, ['a.example']); assert.deepEqual(bg.state.storage.skipok, ['hop.example']); assert.ok(Object.keys(bg.state.storage.follow).length <= 300);
});
test('at most 2 new questions per visited site in an hour, and at most 20 waiting in all; the least evidence is left out first', async () => {
  const one = await load(on({ cookies: Array.from({ length: 6 }, (_, i) => cookie(`t${i}.example`)) }));
  for (let i = 0; i < 6; i++) { await req(one, `https://t${i}.example/a.js`, 'first.example'); await req(one, `https://t${i}.example/a.js`, 'evil.example'); }
  await one.alarm('sweep'); assert.equal(asks(one).length, 2, 'one page made more than two questions');
  const follow = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`h${i}.example`, { on: ['a', 'b'], ck: true, sent: i >= 25, q: true, hosts: [], t: i }]));
  const many = await load(on({ storage: { follow } })); await many.alarm('sweep');
  assert.equal(asks(many).length, 20); for (let i = 25; i < 30; i++) assert.ok(asks(many).includes(`h${i}.example`), 'a question with more evidence was left out');
});
test('pages under shared names (pages.dev and the like) can fill at most 50 places of the list of sites you use, and never push a real site out', async () => {
  const bg = await load(on()); await bg.opens('https://real.example/');
  for (let i = 0; i < 120; i++) await bg.opens(`https://t${i}.pages.dev/`);
  assert.equal(bg.state.storage.mine.length, 1); assert.equal(bg.state.storage.mineShared.length, 50);
  assert.equal((await bg.send({ type: 'state' })).stoppedUsed.length, 0);
});
