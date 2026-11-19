// L9 (fourth audit): no button that does nothing, no sentence that is not true.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js'), { GROUPS } = require('../extension/registry.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\s+/g, ' ');
const says = (id) => GROUPS.find((g) => g.id === id).says;

test('the audit scenario: questions wait in the two rows that only ask: the popup offers no "Stop 3 trackers" or "Remove 1 item" button there, and says where to answer', async () => {
  const bg = await load({ cookies: [{ name: 'uid', domain: 'trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }], tabs: [{ id: 1, active: true, url: 'https://mail.example/' }], storage: { master: true, cacheClearedAt: 1.8e12 } });
  for (const p of ['news.example', 'shop.example']) { await bg.request({ url: 'https://trk.example/a.js', initiator: `https://www.${p}`, type: 'script' }); await bg.settle(); }
  await bg.redirect({ url: 'https://hop.example/r?to=https%3A%2F%2Fblog.example%2F', redirectUrl: 'https://blog.example/', type: 'main_frame' }); await bg.settle();
  const html = renderPopup(await bg.send({ type: 'state' }), null);
  for (const id of ['unknown', 'bounce']) { const row = html.split(`data-group="${id}"`)[1].split('data-group="')[0];
    assert.equal(/class="go"/.test(row), false, `${id}: a button that answers nothing`); assert.equal(/>(Stop|Remove) \d+ /.test(row), false, id);
    assert.match(row, /1 question waiting: answer it in the report beside the page/); }
  const every = [...html.matchAll(/data-msg="([^"]*)"[^>]*class="go"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"')));
  for (const m of every) { const r = await bg.send(m); assert.ok(r.of > 0, `a button that does nothing: ${JSON.stringify(m)}`); }
});
test('the rows say what happens now: nothing learned is blocked or deleted without a press; saved copies daily and at most hourly otherwise', () => {
  assert.match(says('unknown'), /^Asks before blocking/); assert.match(says('unknown'), /At Strongest it blocks and cleans by itself, sites you use included/);   // 1.32 (F10)
  assert.match(says('bounce'), /^Asks before cleaning/); assert.equal(/cut off|is deleted/.test(says('bounce')), false);
  assert.match(says('own'), /built-in list/); assert.match(says('own'), /Keep removing/);
  assert.match(says('cache'), /once a day/); assert.match(says('cache'), /at most once an hour/); assert.equal(/cleaned out/.test(says('cache')), false);
});
test('the first-run line, README and the description do not promise a block or a rewritten link without a press', () => {
  const line = /<p class="c">Tracker Cleaner is on\..*?<\/p>/.exec(renderPopup({ now: 1, master: true, firstRun: true, hold: {}, groups: [] }, null))[0];
  assert.match(line, /asks before it blocks or removes anything of a company that is on no list/); assert.equal(/blocks companies it sees/.test(line), false); assert.equal(/pass-through/.test(line), false);
  const readme = read('README.md').split(' ## ')[0];
  assert.match(readme, /only ever asked about/); assert.equal(/a learned host is only ever blocked by itself/.test(readme), false);
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8')).description;
  assert.ok(d.length <= 132); assert.equal(/rewrites/.test(d), false); assert.match(d, /asks before/i);
});
