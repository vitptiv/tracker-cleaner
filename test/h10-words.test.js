// H10 (second audit): the words say everything the extension does.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), manifest = JSON.parse(read('extension/manifest.json'));
const { renderPopup } = require('../extension/popup-view.js'), { buildReport } = require('../extension/report-view.js');
const ALL = [/block/i, /cookies/i, /cache tags/i, /referring page/i, /script in every page/i, /links/i, /reads?\b.*(addresses|sends|send)/i];

test('the first-run line names every thing that now happens by itself, and where the switch is', () => {
  const html = renderPopup({ now: 1, master: true, firstRun: true, hold: {}, groups: [] }, null), line = /<p class="c">Tracker Cleaner is on\..*?<\/p>/.exec(html)[0];
  for (const w of ALL) assert.match(line, w);
  assert.match(line, /on this computer only/); assert.match(line, /untick .On. above/); assert.match(line, />OK<\/button>/);
});
test('the README says the same in its first paragraph, and nothing about a version that "has not been run"', () => {
  const readme = read('README.md'), first = readme.split('\n## ')[0].replace(/\s+/g, ' ');
  for (const w of ALL) assert.match(first, w);
  assert.equal(/has not been\s+run/.test(readme), false);
});
test('the description fits Chrome\'s limit and names what touches every page', () => {
  const d = manifest.description; assert.ok(d.length <= 132, String(d.length));
  for (const w of [/block/i, /cookies/i, /referring page/i, /script in every page/i, /links/i]) assert.match(d, w);
});
test('the report no longer says the history cannot be cleaned: it says who can clear it and how', () => {
  const h = buildReport({ now: 1, groups: [] }, null).cannot.find((x) => /history/.test(x.what));
  assert.equal(/cannot clean this/.test(h.why), false); assert.match(h.why, /Clear my browsing history/); assert.match(h.why, /no website can read it/);
});
