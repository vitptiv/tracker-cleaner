// S7: the page shield (shield.js in the page's own world, shield-seed.js beside it) and how background.js sets it up.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), load = require('./load-background.js');
const { blurPixels, blurFloats, roundEstimate, hex, words, unseal } = require('../extension/shield.js'), { cap, GROUPS, mayRun } = require('../extension/registry.js');
const src = (f) => fs.readFileSync(path.join(__dirname, '../extension', f), 'utf8');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const picture = () => Uint8ClampedArray.from({ length: 4 * 300 * 150 }, (_, i) => (i * 7) % 256);

const KEY = Uint32Array.from([0x1234abcd, 0x9e3779b1, 7, 0xdeadbeef]), KEY2 = Uint32Array.from([0x1234abcd, 0x9e3779b1, 8, 0xdeadbeef]);
const moved = (after, before) => [...after].map((v, i) => [i, v ^ before[i]]).filter(([, d]) => d);
test('a picture read back: the same key gives the same small changes, another key gives others; at most 32 values move by one step, never how see-through a dot is', () => {
  const p = picture(), a = blurPixels(picture(), KEY), again = blurPixels(picture(), KEY), b = blurPixels(picture(), KEY2);
  assert.deepEqual(a, again); assert.notDeepEqual(a, b); assert.notDeepEqual(a, p);
  const m = moved(a, p); assert.ok(m.length > 0 && m.length <= 32); assert.ok(m.every(([i, d]) => d === 1 && i % 4 !== 3));
  assert.deepEqual(blurPixels(new Uint8ClampedArray(0), KEY), new Uint8ClampedArray(0)); assert.equal(blurPixels(new Uint8ClampedArray(4), KEY).length, 4);
});
test('H3: which values change depends on what was drawn: an empty picture tells nothing about the next one, and another size gives other places', () => {
  const where = (make) => moved(blurPixels(make(), KEY), make()).map(([i]) => i);
  const blank = where(() => new Uint8ClampedArray(4 * 300 * 150)), drawn = where(picture), small = where(() => new Uint8ClampedArray(4 * 150 * 75));
  const shared = (x, y) => x.filter((i) => y.includes(i)).length;
  assert.ok(shared(blank, drawn) <= 2, `an empty and a drawn picture change in the same ${shared(blank, drawn)} places`);
  assert.ok(shared(blank.map((i) => i % (4 * 150 * 75)), small) <= 2);
  const one = picture(); one[5000] ^= 0x10; assert.ok(shared(where(() => one.slice()), drawn) <= 2, 'one changed dot leaves the places as they were');
});
test('H3: the key is 128 bits and each part matters; the sealed message opens only with the token, and all zero means "leave alone"', () => {
  const p = () => moved(blurPixels(picture(), KEY), picture()).map(([i]) => i).join();
  for (let w = 0; w < 4; w++) { const k = Uint32Array.from(KEY); k[w] ^= 1; assert.notEqual(moved(blurPixels(picture(), k), picture()).map(([i]) => i).join(), p(), 'part ' + w); }
  const token = Uint32Array.from([11, 22, 33, 44]), seal = (k) => hex(k.map((x, i) => x ^ token[i]));
  assert.deepEqual([...unseal(seal(KEY), token)], [...KEY]); assert.deepEqual([...unseal(hex(token), token)], [0, 0, 0, 0]);
  assert.notDeepEqual([...unseal(seal(KEY), Uint32Array.from([11, 22, 33, 45]))], [...KEY]);
  for (const bad of ['', '0', 'zz'.repeat(16), 'A'.repeat(32), '0'.repeat(33), 12, null]) assert.equal(unseal(bad, token), null, String(bad));
  assert.deepEqual([...words(hex(KEY))], [...KEY]);
});
test('sound values: the same per key, different across keys, each moved by at most a hundred-thousandth', () => {
  const wave = () => Float32Array.from({ length: 4096 }, (_, i) => Math.sin(i / 10)), a = blurFloats(wave(), KEY), b = blurFloats(wave(), KEY2), w = wave();
  assert.deepEqual(a, blurFloats(wave(), KEY)); assert.notDeepEqual(a, b);
  assert.ok(a.some((v, i) => v !== w[i])); assert.ok(a.every((v, i) => Math.abs(v - w[i]) <= 1.1e-5));
  assert.equal(blurFloats(new Float32Array(0), KEY).length, 0);
});
test('how much is saved: the room is rounded to 10 GB, the used amount down to whole GB, so a few bytes more or less tell nothing', () => {
  const GB = 2 ** 30;
  assert.deepEqual(roundEstimate({ quota: 296630877388, usage: 123456 }), { quota: 280 * GB, usage: 0 });
  assert.deepEqual(roundEstimate({ quota: 296630877388, usage: 123457 }), roundEstimate({ quota: 296630877000, usage: 999 }));
  assert.deepEqual(roundEstimate({ quota: 5, usage: 3.5 * GB }), { quota: 10 * GB, usage: 3 * GB }); assert.deepEqual(roundEstimate(undefined), { quota: 10 * GB, usage: 0 });
});
test('shield.js is small and closed: under 80 lines, no network, no storage, nothing of the extension, nothing left on the page to call', () => {
  const s = src('shield.js'), code = s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(s.split('\n').length < 80);
  for (const bad of [/fetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\bimport\s*\(/, /\beval\b/, /new Function/, /localStorage|sessionStorage|indexedDB|document\.cookie/, /chrome\./, /innerHTML/, /window\.[A-Za-z_$]+\s*=[^=]/, /globalThis\.[A-Za-z_$]+\s*=[^=]/, /postMessage/])
    assert.equal(bad.test(code), false, String(bad));
  assert.match(code, /^\(\(\) => \{/); assert.match(code.trim(), /\}\)\(\);$/);
  assert.ok(code.indexOf('Reflect.apply') < code.indexOf('wrap(p,'), "Chrome's own functions are taken hold of before anything is replaced");
  const seedJs = src('shield-seed.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const bad of [/fetch\s*\(/, /XMLHttpRequest/, /innerHTML/, /chrome\.storage/, /document\.cookie/, /location/]) assert.equal(bad.test(seedJs), false, String(bad));
});
test('its own row, on by default; both scripts are registered for every page and frame at the start, never on the sign-in hosts', async () => {
  assert.deepEqual([cap('C32').group, cap('C32').mode, cap('C32').destructive], ['shield', 'auto', false]); assert.equal(mayRun('C32', { master: true }), 'run');
  assert.equal(GROUPS.find((g) => g.id === 'shield').title, 'Blur what makes this browser recognisable');
  const bg = await load(on()); await bg.alarm('sweep');
  const [a, b] = ['shield', 'shield-seed'].map((id) => bg.state.scripts.find((s) => s.id === id));
  assert.deepEqual([a.world, a.js, a.runAt, a.allFrames, a.matchOriginAsFallback], ['MAIN', ['shield.js'], 'document_start', true, true]);
  assert.deepEqual([b.world, b.js, b.runAt, b.allFrames], [undefined, ['shield-seed.js'], 'document_start', true]);
  for (const s of [a, b]) { assert.deepEqual(s.matches, ['http://*/*', 'https://*/*']); assert.ok(s.excludeMatches.includes('*://accounts.google.com/*') && s.excludeMatches.includes('*://login.live.com/*')); }
  await bg.send({ type: 'setMode', group: 'shield', mode: 'off' }); await bg.settle();
  assert.equal(bg.state.scripts.some((s) => s.id.startsWith('shield')), false);
});
test('H3: the key comes from the worker at the page script\'s asking: 128 random bits per site and run of Chrome, the site taken from the tab as Chrome reports it', async () => {
  const bg = await load(on({ storage: { sitesOff: ['off.example'] } })); await bg.alarm('sweep');
  const ask = (url, o = {}) => bg.send({ type: 'shieldKey', site: 'lies.example', ...o.msg }, { id: bg.chrome.runtime.id, url: o.frame || url, frameId: o.frame ? 3 : 0, tab: { id: 5, url } });
  const a = await ask('https://www.news.example/story'), again = await ask('https://news.example/other', { frame: 'https://ads.trk.example/frame' }), b = await ask('https://shop.example/');
  assert.match(a.key, /^[0-9a-f]{32}$/); assert.equal(again.key, a.key, 'a frame, or another page of the site, got another key'); assert.notEqual(b.key, a.key);
  assert.equal(JSON.stringify(bg.state.storage).includes(a.key), false, 'the key is in storage that outlives Chrome'); assert.equal(bg.state.session.skeys['news.example'], a.key);
  const other = await load(on()); assert.notEqual((await other.send({ type: 'shieldKey' }, { id: other.chrome.runtime.id, url: 'https://news.example/', tab: { id: 1, url: 'https://news.example/' } })).key, a.key);
  assert.deepEqual(await ask('https://www.off.example/'), { off: true }); assert.deepEqual(await ask('https://accounts.google.com/signin'), { off: true });
  await bg.send({ type: 'pause', minutes: 5 }); assert.deepEqual(await ask('https://news.example/'), { off: true }); await bg.send({ type: 'resume' });
  await bg.send({ type: 'setMode', group: 'shield', mode: 'off' }); assert.deepEqual(await ask('https://news.example/'), { off: true });
});
test('H3: only a page script of this extension gets a key; a page script gets nothing else answered, and at most 300 sites are remembered', async () => {
  const bg = await load(on()), tab = { id: 5, url: 'https://news.example/' };
  assert.equal(await bg.send({ type: 'shieldKey' }, { id: 'another-extension-id', url: tab.url, tab }), undefined);
  assert.equal(await bg.send({ type: 'shieldKey' }, { id: bg.chrome.runtime.id, url: tab.url }), undefined, 'no tab: not a page script');
  for (const type of ['state', 'history', 'setMaster', 'clearBrowsing', 'cookieValue']) assert.equal(await bg.send({ type, on: false }, { id: bg.chrome.runtime.id, url: tab.url, tab }), undefined, type);
  for (let i = 0; i < 305; i++) await bg.send({ type: 'shieldKey' }, { id: bg.chrome.runtime.id, url: `https://s${i}.example/`, tab: { id: 5, url: `https://s${i}.example/` } });
  assert.equal(Object.keys(bg.state.session.skeys).length, 300); assert.equal('s0.example' in bg.state.session.skeys, false);
});
