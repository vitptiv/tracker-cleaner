// S7: the page shield (shield.js in the page's own world, shield-seed.js beside it) and how background.js sets it up.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), load = require('./load-background.js');
const { blurPixels, blurFloats } = require('../extension/shield.js'), { cap, GROUPS, mayRun } = require('../extension/registry.js');
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
test('the key is 128 bits and each part matters', () => {
  const p = () => moved(blurPixels(picture(), KEY), picture()).map(([i]) => i).join();
  for (let w = 0; w < 4; w++) { const k = Uint32Array.from(KEY); k[w] ^= 1; assert.notEqual(moved(blurPixels(picture(), k), picture()).map(([i]) => i).join(), p(), 'part ' + w); }
});
test('sound values: the same per key, different across keys, each moved by at most a hundred-thousandth', () => {
  const wave = () => Float32Array.from({ length: 4096 }, (_, i) => Math.sin(i / 10)), a = blurFloats(wave(), KEY), b = blurFloats(wave(), KEY2), w = wave();
  assert.deepEqual(a, blurFloats(wave(), KEY)); assert.notDeepEqual(a, b);
  assert.ok(a.some((v, i) => v !== w[i])); assert.ok(a.every((v, i) => Math.abs(v - w[i]) <= 1.1e-5));
  assert.equal(blurFloats(new Float32Array(0), KEY).length, 0);
});
test('L7: the saved amount is no longer touched: every way of rounding the answer hands the real one to a page that has replaced the promise\'s constructor', () => {
  const code = src('shield.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const gone of [/estimate/, /StorageManager/, /Promise/, /roundEstimate/]) assert.equal(gone.test(code), false, String(gone));
  assert.equal('roundEstimate' in require('../extension/shield.js'), false);
});
test('J5: shield.js is small and closed: under 80 lines, no network, no storage, no message or event in or out, nothing of the extension, nothing left on the page to call', () => {
  const s = src('shield.js'), code = s.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(s.split('\n').length < 80);
  for (const bad of [/fetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\bimport\s*\(/, /\beval\b/, /new Function/, /localStorage|sessionStorage|indexedDB|document\.cookie/, /chrome\./, /innerHTML/, /window\.[A-Za-z_$]+\s*=[^=]/,
    /globalThis\.[A-Za-z_$]+\s*=[^=]/, /postMessage/, /addEventListener|dispatchEvent|CustomEvent|sendMessage/, /location/])
    assert.equal(bad.test(code), false, String(bad));
  assert.match(code, /^\(\(\) => \{/); assert.match(code.trim(), /\}\)\(\);$/);
  assert.equal(fs.existsSync(path.join(__dirname, '../extension/shield-seed.js')), false, 'the second script is still there');
});
test('J5: every tool is taken hold of before use: after the first lines the page part calls nothing by its global name', () => {
  const code = src('shield.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'), page = code.slice(code.indexOf('const W = window'));
  const later = page.split('\n').slice(3).join('\n');   // after the lines that take hold of the tools
  for (const bad of [/Math\./, /Reflect\./, /Object\./, /crypto\./, /Number\(/, /\.buffer|\.byteOffset|\.byteLength/, /(?<!orig)\.length(?! \}|:)/, /for \(const [^;]* of /, /\.then\(/, /\.has\(|\.add\(|\.get\(|\.set\(/])
    assert.equal(bad.test(later), false, `${bad} in: ${(bad.exec(later) || { input: '' }).input.slice(Math.max(0, (bad.exec(later) || { index: 0 }).index - 40)).slice(0, 90)}`);
  assert.match(code, /apply\(crypto\.getRandomValues, crypto, \[new Uint32Array\(4\)\]\)/);
});
test('M4: its own row, experimental and ON by default; then one script for every page and frame, never on the sign-in hosts or a site cleaning is off for; out while paused or during a sign-in', async () => {
  assert.deepEqual([cap('C32').group, cap('C32').mode, cap('C32').destructive], ['shield', 'auto', false]); assert.equal(mayRun('C32', { master: true }), 'run');
  const g = GROUPS.find((x) => x.id === 'shield'); assert.match(g.title, /experimental/i);
  assert.ok(g.says.includes('makes this browser harder to recognise by its drawing, sound, fonts and screen size; a determined site can still undo it.'));
  const def = await load(on()); await def.alarm('sweep'); assert.ok(def.state.scripts.some((s) => s.id === 'shield'), 'the shield is on by default (M4)');
  const off = await load(on({ storage: { modes: { C32: 'off' } } })); await off.alarm('sweep'); assert.equal(off.state.scripts.some((s) => s.id.startsWith('shield')), false);
  const bg = await load(on({ storage: { modes: { C32: 'auto' }, sitesOff: ['off.example'] } })); await bg.alarm('sweep');
  const a = bg.state.scripts.find((s) => s.id === 'shield');
  assert.deepEqual([a.world, a.js, a.runAt, a.allFrames, a.matchOriginAsFallback, a.matches], ['MAIN', ['shield.js'], 'document_start', true, true, ['http://*/*', 'https://*/*']]);
  for (const m of ['*://accounts.google.com/*', '*://login.live.com/*', '*://off.example/*', '*://*.off.example/*']) assert.ok(a.excludeMatches.includes(m), m);
  assert.equal(bg.state.scripts.some((s) => s.id === 'shield-seed'), false);
  await bg.send({ type: 'siteOff', host: 'other.example', on: true }); await bg.settle();
  assert.ok(bg.state.scripts.find((s) => s.id === 'shield').excludeMatches.includes('*://*.other.example/*')); assert.equal(bg.state.scripts.filter((s) => s.id === 'shield').length, 1);
  await bg.send({ type: 'pause', minutes: 5 }); await bg.settle(); assert.equal(bg.state.scripts.some((s) => s.id === 'shield'), false);
  await bg.send({ type: 'resume' }); await bg.settle(); assert.ok(bg.state.scripts.some((s) => s.id === 'shield'));
});
test('J5: no page script is answered any more: the shield-key message is gone, and nothing about the shield is stored', async () => {
  const bg = await load(on({ storage: { modes: { C32: 'auto' } } })); await bg.alarm('sweep'); const tab = { id: 5, url: 'https://news.example/' };
  for (const type of ['shieldKey', 'state', 'history', 'setMaster', 'clearBrowsing', 'cookieValue']) assert.equal(await bg.send({ type, on: false }, { id: bg.chrome.runtime.id, url: tab.url, tab }), undefined, type);
  assert.equal('shield' in bg.state.storage, false); assert.equal('skeys' in bg.state.session, false); assert.equal('shieldSalt' in bg.state.session, false);
});
