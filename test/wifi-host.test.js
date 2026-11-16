const test = require('node:test'), assert = require('node:assert');
const { encode, decode, handle } = require('../wifi-helper/host.js');
const { main } = require('../wifi-helper/cli.js');

const NOW = 1.8e12, S = NOW / 1000, OLD = '00000000-0000-4000-8000-000000000002', LIVE = '00000000-0000-4000-8000-000000000001';
const LISTING = `Home:${LIVE}:802-11-wireless:${S - 60}:yes\nCafe:${OLD}:802-11-wireless:${S - 40 * 86400}:no\n`;
const PERMS = (v) => `org.freedesktop.NetworkManager.settings.modify.system  ${v} \n`;
function fake(perm = 'yes') {
  const run = (cmd, args) => { run.calls.push(args.join(' ')); return args[0] === 'general' ? PERMS(perm) : args.at(-1) === 'show' ? LISTING : ''; };
  run.calls = [];
  run.deletes = () => run.calls.filter((c) => c.startsWith('connection delete'));
  return run;
}

test('framing: 4-byte little-endian length, then JSON', () => {
  const b = encode({ a: 1 });
  assert.equal(b.readUInt32LE(0), 7);
  assert.equal(b.subarray(4).toString(), '{"a":1}');
});
test('framing: round-trips, counting bytes not characters', () => {
  const m = { type: 'list', name: 'Café ☕' };
  assert.deepEqual(decode(encode(m)), { messages: [m], rest: Buffer.alloc(0) });
});
test('framing: two messages in one chunk, and one message split across two chunks', () => {
  const a = { type: 'list' }, b = { type: 'remove', uuids: [OLD] };
  const all = Buffer.concat([encode(a), encode(b)]);
  assert.deepEqual(decode(all).messages, [a, b]);
  for (const cut of [2, 4, 9, all.length - 1]) { // inside the length, right after it, inside the body
    const first = decode(all.subarray(0, cut));
    const second = decode(Buffer.concat([first.rest, all.subarray(cut)]));
    assert.deepEqual([...first.messages, ...second.messages], [a, b], 'cut at ' + cut);
    assert.equal(second.rest.length, 0);
  }
});
test('framing: an absurd length is an error instead of waiting for a gigabyte', () => {
  const b = Buffer.alloc(8); b.writeUInt32LE(0x7fffffff, 0);
  assert.throws(() => decode(b), /too large/);
});

test('host list: candidates and canDelete, and nothing but read-only commands', () => {
  const run = fake(), r = handle({ type: 'list' }, run, NOW);
  assert.deepEqual(r, { ok: true, type: 'list', canDelete: 'yes', candidates: [{ name: 'Cafe', uuid: OLD, lastUsed: S - 40 * 86400, active: false, reason: 'not used for 40 days' }] });
  assert.deepEqual(run.deletes(), []);
});
test('host remove: deletes the approved candidate, refuses the active one', () => {
  const run = fake(), r = handle({ type: 'remove', uuids: [OLD, LIVE] }, run, NOW);
  assert.deepEqual(run.deletes(), ['connection delete uuid ' + OLD]);
  assert.deepEqual(r, { ok: true, type: 'remove', removed: [{ uuid: OLD, name: 'Cafe' }], refused: [{ uuid: LIVE, reason: 'in use now' }], failed: [] });
});
test('host remove: with a password prompt in the way nothing is deleted and every UUID comes back refused', () => {
  const run = fake('auth'), r = handle({ type: 'remove', uuids: [OLD] }, run, NOW);
  assert.deepEqual(run.deletes(), []);
  assert.equal(r.ok, true); assert.deepEqual(r.removed, []); assert.match(r.refused[0].reason, /password/);
  assert.equal(handle({ type: 'list' }, fake('auth'), NOW).canDelete, 'auth');
});
test('host: unknown or malformed requests get an error and run nothing', () => {
  const run = fake();
  for (const m of [{ type: 'wipe' }, { type: 'remove' }, { type: 'remove', uuids: OLD }, null, 'list'])
    assert.equal(handle(m, run, NOW).ok, false);
  assert.deepEqual(run.calls, []);
});

// The CLI with a fake runner, a fake keyboard and captured output.
function cli(argv, answer, perm) {
  const run = fake(perm), out = [], asked = [];
  const code = main(argv, { run, now: NOW, print: (s) => out.push(s), ask: (q) => { asked.push(q); return answer; } });
  return { run, code, asked, text: out.join('\n') };
}
test('cli list: prints the candidates and whether deletion is permitted, deletes nothing', () => {
  const r = cli(['list']);
  assert.match(r.text, /Cafe/); assert.match(r.text, /not used for 40 days/); assert.match(r.text, new RegExp(OLD));
  assert.doesNotMatch(r.text, /Home/); assert.match(r.text, /Deletion permitted: yes/);
  assert.deepEqual(r.run.deletes(), []); assert.equal(r.code, 0);
});
test('cli remove: deletes only after a typed yes', () => {
  const r = cli(['remove', OLD, LIVE], 'yes');
  assert.match(r.asked[0], /yes/); assert.match(r.text, /Cafe/);
  assert.deepEqual(r.run.deletes(), ['connection delete uuid ' + OLD]);
  assert.match(r.text, /in use now/);
});
test('cli remove: anything other than yes deletes nothing', () => {
  for (const a of ['y', 'Y', 'no', '', 'yes please', null]) assert.deepEqual(cli(['remove', OLD], a).run.deletes(), [], String(a));
});
test('cli remove: nothing removable means no question and no delete', () => {
  const r = cli(['remove', LIVE], 'yes');
  assert.deepEqual(r.asked, []); assert.deepEqual(r.run.deletes(), []); assert.match(r.text, /in use now/);
});
test('cli: no command or an unknown one prints usage and runs nothing', () => {
  for (const argv of [[], ['purge'], ['remove']]) { const r = cli(argv, 'yes'); assert.match(r.text, /Usage/); assert.deepEqual(r.run.calls, []); assert.equal(r.code, 2); }
});
test('cli: when deletion is not permitted, list says so and remove asks nothing and deletes nothing', () => {
  for (const perm of ['auth', 'no']) {
    assert.match(cli(['list'], '', perm).text, /Deletion permitted: no/);
    const r = cli(['remove', OLD], 'yes', perm);
    assert.deepEqual(r.asked, []); assert.deepEqual(r.run.deletes(), []); assert.equal(r.code, 1);
    assert.match(r.text, perm === 'auth' ? /password/ : /not permitted/);
  }
});
