// Chunk 10: what Chrome will ask the extension folder for must be in pack.sh's copy list and on disk.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../extension'), read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const manifest = JSON.parse(read('manifest.json')), sh = read('pack.sh'), bgjs = read(manifest.background.service_worker);
const names = (text, re) => [...text.matchAll(re)].flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/['"]/g, ''))).filter(Boolean);
const packed = names(sh, /cp "\$HERE"\/\{([^}]+)\}/g);
const needed = { 'manifest.json': 'the manifest itself',
  [manifest.background.service_worker]: 'manifest background', [manifest.action.default_popup]: 'manifest action',
  ...Object.fromEntries(manifest.declarative_net_request.rule_resources.map((r) => [r.path, 'manifest rule_resources'])),
  ...Object.fromEntries(names(bgjs, /importScripts\(([^)]+)\)/g).map((f) => [f, 'background importScripts'])),
  ...Object.fromEntries(names(bgjs, /\b(?:js|css): \[([^\]]+)\]/g).map((f) => [f, 'background content script'])),
  ...Object.fromEntries(names(read('popup.html'), /(?:src|href)="([^"]+)"/g).map((f) => [f, 'popup.html'])),
  ...Object.fromEntries(names(read('history.html'), /(?:src|href)="([^"]+)"/g).map((f) => [f, 'history.html'])),
  [(manifest.side_panel || {}).default_path]: 'manifest side_panel',
  ...Object.fromEntries(names(fs.existsSync(path.join(dir, 'report.html')) ? read('report.html') : '', /(?:src|href)="([^"]+)"/g).map((f) => [f, 'report.html'])) };

test('the references were found: manifest, importScripts, content scripts, popup scripts', () => {
  for (const f of ['background.js', 'popup.html', 'rules.json', 'rules-google.json', 'rules-params.json', 'registry.js', 'queue.js', 'yt-adfree.js', 'yt-adfree.css', 'popup-view.js', 'popup.js', 'history.html', 'history-view.js', 'history-page.js', 'report.html', 'report-view.js', 'report-page.js'])
    assert.ok(f in needed, f);
  assert.ok(packed.length >= Object.keys(needed).length);
});
test('every file the extension refers to is in pack.sh and exists on disk', () => {
  for (const [f, by] of Object.entries(needed)) {
    assert.ok(packed.includes(f), `${f} (${by}) is not copied by pack.sh`);
    assert.ok(fs.statSync(path.join(dir, f)).size > 0, `${f} (${by}) is missing`);
  }
});
test('pack.sh copies nothing that does not exist, and nothing twice', () => {
  for (const f of packed) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(new Set(packed).size, packed.length);
});
test('pack.sh: without the signing key it explains loading unpacked, before Chrome is ever started', () => {
  const noKey = sh.indexOf('! [ -f "$KEY" ]'), chrome = sh.indexOf('google-chrome --');
  assert.ok(noKey > 0 && chrome > noKey);
  const branch = sh.slice(noKey, chrome);
  assert.match(branch, /Load unpacked/); assert.match(branch, /chrome:\/\/extensions/); assert.match(branch, /exit 0/);
  assert.match(sh, /--pack-extension-key="\$KEY"/);                 // the signed path is still there
});
test('version 1.22, and a description of what it does', () => {
  assert.equal(manifest.version, '1.22');
  for (const w of [/asks? before/i, /group/i, /sign.?in/i]) assert.match(manifest.description, w);
  assert.ok(manifest.description.length <= 132);                    // Chrome's limit for a description
  assert.doesNotMatch(manifest.description + bgjs.split('\n').slice(0, 6).join(' ') + read('popup.js').split('\n').slice(0, 5).join(' '), /chrome-baddies|every 15 min\)|1\.20/);
});
