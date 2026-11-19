'use strict';
// The hidden collector (lab-only), F2-5: a fingerprint join key from surfaces the shield never blurs -- installed fonts
// (text metrics), matchMedia/screen, and WebGL MAX_TEXTURE_SIZE. shield.js wraps 2D canvas, GL vendor/renderer
// (37445/37446) and readPixels; it does NOT touch fonts, matchMedia or screen. So the stable code is built from the
// unshielded surfaces, and the shielded readPixels hash is captured apart (to show, honestly, where the shield wins).
const test = require('node:test'), assert = require('node:assert'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { start2 } = require('../lab/ff2-server');

const PORT = Number(process.env.FF2_TEST_PORT5) || 8376;
function hit(site, mid, fp) { const body = JSON.stringify({ m: mid, stores: { local: mid }, fp });
  return new Promise((done, fail) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: '/f/hit?m=' + mid, method: 'POST', headers: { Host: `${site}.localhost:${PORT}`, 'Content-Type': 'application/json' } }, (r) => { let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => done({ status: r.statusCode })); }); q.on('error', fail); q.end(body); }); }

let lab;
test.before(async () => { lab = await start2({ port: PORT }); });
test.after(() => lab && lab.close());

test('F2-5: the fingerprint script is a plain page script and builds its stable code from surfaces the shield never touches', () => {
  const fp = fs.readFileSync(path.join(__dirname, '../lab/ff2-fp.js'), 'utf8');
  assert.match(fp, /window\.ff2fp\s*=/); assert.equal(/\bimport\b|require\(/.test(fp), false, 'a plain page script');
  assert.match(fp, /matchMedia/); assert.match(fp, /measureText|offsetWidth/, 'font metrics'); assert.match(fp, /screen\./);
  assert.match(fp, /readPixels/, 'readPixels is measured (to show the shield’s effect)');
  // the stable code must NOT fold in readPixels (the shield perturbs it when C32 is on); readpx is reported apart
  const codeInputs = fp.match(/code:\s*'fp2-'\s*\+\s*fnv\(\[([^\]]*)\]/)[1];
  assert.equal(/readpx|readPixels|\brp\b/.test(codeInputs), false, 'the join-key code excludes the shielded readPixels surface');
});
test('F2-5 (F6): the collector records the fingerprint code and ties every site that reports the same one into one browser', async () => {
  const mid1 = 'ff2m-fpaaa', mid2 = 'ff2m-fpbbb', fp = { code: 'fp2-stable-xyz', gl: 'g123', fonts: 'f456', media: 'm789', readpx: 'rp-site-specific' };
  await hit('ledger', mid1, fp); await hit('sundial', mid1, fp);
  const g = lab.store.lookup(['ff2m:' + mid1]);
  const f6 = lab.store.of(g).filter((x) => x.trace === 'F6');
  assert.ok(f6.length >= 2 && f6.every((x) => x.value === 'fp2-stable-xyz'), 'the same code on each site');
  assert.deepEqual([...new Set(f6.map((x) => x.site))].sort(), ['ledger.localhost', 'sundial.localhost']);
  assert.match(f6[0].via, /fonts f456/); assert.match(f6[0].via, /screen\+media m789/);
});
