// S7: the page shield (shield.js in the page's own world, shield-seed.js beside it) and how background.js sets it up.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), load = require('./load-background.js');
const { blurPixels, blurFloats, roundEstimate } = require('../extension/shield.js'), { cap, GROUPS, mayRun } = require('../extension/registry.js');
const src = (f) => fs.readFileSync(path.join(__dirname, '../extension', f), 'utf8');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const picture = () => Uint8ClampedArray.from({ length: 4 * 300 * 150 }, (_, i) => (i * 7) % 256);

test('a picture read back: the same seed gives the same small changes, another seed gives others; at most 32 values move by one step, never how see-through a dot is', () => {
  const p = picture(), a = blurPixels(picture(), 12345), again = blurPixels(picture(), 12345), b = blurPixels(picture(), 54321);
  assert.deepEqual(a, again); assert.notDeepEqual(a, b); assert.notDeepEqual(a, p);
  const moved = [...a].map((v, i) => [i, v ^ p[i]]).filter(([, d]) => d);
  assert.ok(moved.length > 0 && moved.length <= 32); assert.ok(moved.every(([i, d]) => d === 1 && i % 4 !== 3));
  assert.deepEqual(blurPixels(new Uint8ClampedArray(0), 1), new Uint8ClampedArray(0)); assert.equal(blurPixels(new Uint8ClampedArray(4), 9).length, 4);
});
test('sound values: the same per seed, different across seeds, each moved by at most a hundred-thousandth', () => {
  const wave = () => Float32Array.from({ length: 4096 }, (_, i) => Math.sin(i / 10)), a = blurFloats(wave(), 7), b = blurFloats(wave(), 8), w = wave();
  assert.deepEqual(a, blurFloats(wave(), 7)); assert.notDeepEqual(a, b);
  assert.ok(a.some((v, i) => v !== w[i])); assert.ok(a.every((v, i) => Math.abs(v - w[i]) <= 1.1e-5));
  assert.equal(blurFloats(new Float32Array(0), 3).length, 0);
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
  for (const bad of [/fetch\s*\(/, /XMLHttpRequest/, /sendMessage/, /innerHTML/, /storage\.local\.set/, /document\.cookie/]) assert.equal(bad.test(seedJs), false, String(bad));
});
test('its own row, on by default; both scripts are registered for every page and frame at the start, never on the sign-in hosts', async () => {
  assert.deepEqual([cap('C32').group, cap('C32').mode, cap('C32').destructive], ['shield', 'auto', false]); assert.equal(mayRun('C32', { master: true }), 'run');
  assert.equal(GROUPS.find((g) => g.id === 'shield').title, 'Blur what makes this browser recognisable');
  const bg = await load(on()); await bg.alarm('sweep');
  const [a, b] = ['shield', 'shield-seed'].map((id) => bg.state.scripts.find((s) => s.id === id));
  assert.deepEqual([a.world, a.js, a.runAt, a.allFrames, a.matchOriginAsFallback], ['MAIN', ['shield.js'], 'document_start', true, true]);
  assert.deepEqual([b.world, b.js, b.runAt, b.allFrames], [undefined, ['learn.js', 'shield-seed.js'], 'document_start', true]);
  for (const s of [a, b]) { assert.deepEqual(s.matches, ['http://*/*', 'https://*/*']); assert.ok(s.excludeMatches.includes('*://accounts.google.com/*') && s.excludeMatches.includes('*://login.live.com/*')); }
  await bg.send({ type: 'setMode', group: 'shield', mode: 'off' }); await bg.settle();
  assert.equal(bg.state.scripts.some((s) => s.id.startsWith('shield')), false);
});
test('what the page script is given: a random value of this run of Chrome and the sites to leave alone; "leave alone" during a sign-in and a pause', async () => {
  const bg = await load(on({ storage: { sitesOff: ['off.example'] } })); await bg.alarm('sweep');
  const s = bg.state.storage.shield;
  assert.match(s.salt, /^[0-9a-f]{32}$/); assert.deepEqual([s.off, s.sites], [false, ['off.example']]);
  assert.equal(bg.state.session.shieldSalt, s.salt); await bg.alarm('sweep'); assert.equal(bg.state.storage.shield.salt, s.salt, 'changed within one run of Chrome');
  const other = await load(on()); await other.alarm('sweep'); assert.notEqual(other.state.storage.shield.salt, s.salt);
  await bg.send({ type: 'pause', minutes: 5 }); await bg.settle(); assert.equal(bg.state.storage.shield.off, true);
  await bg.send({ type: 'resume' }); await bg.settle(); assert.equal(bg.state.storage.shield.off, false);
  await bg.openTab({ id: 7, active: true, url: 'https://accounts.google.com/signin' }); await bg.settle(); assert.equal(bg.state.storage.shield.off, true);
});
