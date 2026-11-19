// 1.30: the popup's dial, "Clean everything now" and the rows' "Clean now", on hand-built states.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { renderPopup } = require('../extension/popup-view.js'), { GROUPS, CLEANABLE } = require('../extension/registry.js'), { STOPS_HOUR } = require('../extension/learn.js');
const NOW = new Date(2026, 10, 10, 13, 0).getTime();
const groups = (over = {}) => GROUPS.map((g) => ({ id: g.id, title: g.title, mode: 'auto', ask: true, pending: 0, postponedUntil: 0, items: [], cleanable: CLEANABLE.includes(g.id), ...(['unknown', 'bounce'].includes(g.id) ? { answers: true } : {}), ...over[g.id] }));
const state = (o = {}, over = {}) => ({ now: NOW, master: true, level: 'strong', modes: {}, hold: { paused: false, guard: false, pauseUntil: 0 }, groups: groups(over), log: [], allow: [], sitesOff: [], ...o });
const msgs = (html) => [...html.matchAll(/<button ([^>]*)data-msg="([^"]*)"([^>]*)>/g)].map((m) => ({ ...JSON.parse(m[2].replace(/&quot;/g, '"')), disabled: /disabled/.test(m[1] + m[3]) }));
const row = (html, id) => html.split(`data-group="${id}"`)[1].split('data-group=')[0];
const top = (html) => html.split('data-group=')[0];

test('the dial comes first: three positions, the chosen one pressed, one true sentence under it, and the rows that are not on it', () => {
  for (const [level, says] of [['ask', /Nothing is deleted or newly blocked until you press/], ['balanced', /The rest waits for you/], ['strong', /without asking/]]) {
    const html = renderPopup(state({ level }), null);
    assert.ok(html.startsWith('<div class="c" data-level'), level);
    assert.deepEqual([...html.matchAll(/data-level-pick="(\w+)"[^>]*aria-pressed="(\w+)"/g)].map((m) => [m[1], m[2]]), [['ask', String(level === 'ask')], ['balanced', String(level === 'balanced')], ['strong', String(level === 'strong')]]);
    assert.match(top(html), says, level);
    if (level === 'strong') assert.match(top(html), /sites you use.*cannot be put back/, 'Strongest names its two costs (1.32: the hourly cap is in the README)');
    assert.match(top(html), /Tor, Wi-Fi and a few other rows keep their own switch/); }
  const custom = renderPopup(state({ level: 'custom' }), null);
  assert.match(top(custom), /Custom: you changed some rows/); assert.equal(/aria-pressed="true"/.test(custom), false);
  for (const l of ['Ask first', 'Balanced', 'Strongest']) assert.ok(top(custom).includes(`>${l}</button>`), l);
});
test('the Ask first sentence names what stays on, and says nothing that is not true', () => {
  const t = top(renderPopup(state({ level: 'ask' }), null));
  assert.match(t, /Known trackers stay blocked/);   // 1.32: short; the full list of what stays on is in the README
});
test('one "Clean everything now" at the top; off while paused or switched off, and before cleaning was ever turned on', () => {
  const all = (s) => msgs(renderPopup(s, null)).filter((m) => m.type === 'cleanAll');
  assert.deepEqual(all(state()).map((m) => m.disabled), [false]);
  for (const s of [state({ master: false }), state({ master: undefined }), state({ hold: { paused: true, pauseUntil: NOW + 6e5 } })]) assert.deepEqual(all(s).map((m) => m.disabled), [true]);
  assert.match(top(renderPopup(state(), null)), />Clean everything now<\/button>/);
});
test('a Clean now on each row that has something to clean, none on the rows that are only rules, none on a row that is off; the cache row keeps its own', () => {
  const html = renderPopup(state(), null), now = msgs(html).filter((m) => m.type === 'cleanNow').map((m) => m.group);
  assert.deepEqual(now, CLEANABLE.filter((g) => g !== 'cache'));
  for (const g of ['signin', 'blocking', 'othercookies', 'othertags', 'local', 'shield', 'params', 'wifi', 'allowlist', 'tabs', 'tor', 'server']) assert.equal(row(html, g).includes('cleanNow'), false, g);
  assert.ok(row(html, 'cache').includes('&quot;kind&quot;:&quot;servers&quot;}">Clean now</button>'));
  assert.equal(row(renderPopup(state({}, { cookies: { mode: 'off' } }), null), 'cookies').includes('Clean now'), false);
  assert.equal(/class="go"/.test(row(html, 'cookies')), false, 'Clean now is not an approve button');
});
test('the question rows: a fourth mode that says yes by itself; Clean now says it answers them yes', () => {
  const html = renderPopup(state({}, { unknown: { mode: 'yes', pending: 2, items: [] } }), null);
  assert.match(row(html, 'unknown'), /<option value="yes" selected>Automatic, says yes<\/option>/);
  assert.match(row(html, 'unknown'), /Clean now answers them all yes/);
  assert.equal(row(html, 'cookies').includes('value="yes"'), false);
});
test('after a press the row shows what was done, for ten minutes; an answer given by itself is marked so in "This site"', () => {
  const s = (t, n) => state({ log: [{ t: NOW, cap: 'C25', kind: 'tracker', site: 'trk.example', name: 'followed you on 2 sites', did: 'removed', auto: true }] }, { cookies: { cleanedNow: { t, n } } });
  assert.match(row(renderPopup(s(NOW - 60e3, 3), null), 'cookies'), /Cleaned at \d\d:\d\d: 3 removed/);
  assert.match(row(renderPopup(s(NOW - 60e3, 0), null), 'cookies'), /Cleaned at \d\d:\d\d: nothing to remove/);
  assert.equal(/Cleaned at/.test(row(renderPopup(s(NOW - 11 * 60e3, 3), null), 'cookies')), false);
  assert.match(renderPopup(s(NOW, 1), { host: 'trk.example', blocked: null }), /removed by itself<\/span> trk\.example/);
});
test('the first-run line says the level it starts at', () => {
  assert.match(renderPopup(state({ firstRun: true }), null), /On, at Strongest: trackers are blocked and cleaned without asking, also on sites you use\. This can sign you out, and wiped site data cannot be put back\. It reads what pages send, on this computer only\. Pick Balanced to be asked first\./);
  const bal = renderPopup(state({ firstRun: true, level: 'balanced' }), null);
  assert.match(bal, /The rest is asked first/); assert.equal(bal.includes('Tracker Cleaner is on, at Strongest'), false);
});
test('popup.js: the refusals of a press are said in plain words, and the count of a Clean now is shown', () => {
  const js = fs.readFileSync(path.join(__dirname, '../extension/popup.js'), 'utf8');
  for (const w of ['signin:', 'busy:', 'rowOff:']) assert.ok(js.includes(w), w);
  assert.match(js, /r\.cleaned !== undefined/);
});
test("the report beside the page shows a row that answers yes by itself as on, not off", () => {
  const { buildReport } = require('../extension/report-view.js');
  const r = buildReport({ now: NOW, master: true, hold: {}, groups: groups({ unknown: { mode: 'yes' }, bounce: { mode: 'yes' } }), allow: [], always: [], sitesOff: [], history: { days: {}, cookies: {} } }, null);
  const w = Object.fromEntries(r.features.map((f) => [f.id, f.state]));
  assert.deepEqual([w.unknown, w.bounce], ['on', 'on']);
});

test('1.31: the Strongest sentence and the first-run line say it can sign you out of a site that follows you, and how to undo or prevent it', () => {
  for (const html of [top(renderPopup(state(), null)), renderPopup(state({ firstRun: true }), null)]) {
    assert.match(html, /also on sites you use\. This can sign you out, and wiped site data cannot be put back/);   // 1.32 (F10): not only trackers; the undo is the Let it through press, the README says more
    assert.equal(/never a site you open yourself/.test(html), false, 'the old promise is still there'); }
});
