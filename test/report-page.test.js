// The report's page (1.23 step 5): report.html with report-page.js, run against the real background script and the
// chrome fake. What is checked is the wiring: what a press sends, and what the page then shows.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const load = require('./load-background.js'), loadPage = require('./load-page.js');
const dir = path.join(__dirname, '../extension'), read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const SECRET = 'SECRET-0123456789-abcdefghijklmnopqrstuvwxyz', SHOWN = SECRET.slice(0, 24);
const TAB = { id: 1, active: true, url: 'https://www.example.com/' }, OTHER = { id: 2, active: false, url: 'https://other.test/' };
const jar = () => [{ name: 'SID', domain: '.example.com', value: SECRET }, { name: 'theme', domain: 'www.example.com', value: SECRET }, { name: '_ga', domain: '.example.com', value: 'GA1.2.3' },
  { name: 'o', domain: 'other.test', value: '1' }];
const on = (o = {}) => ({ tabs: [TAB, OTHER], cookies: jar(), ...o, storage: { master: true, cacheClearedAt: 1.8e12, modes: { C03: 'ask' }, ...o.storage } });

test('the manifest asks for the side panel and names report.html; the popup has one button for it', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.ok(m.permissions.includes('sidePanel')); assert.deepEqual(m.side_panel, { default_path: 'report.html' });
  assert.ok(read('popup.html').includes('<button id="report">Open the report beside the page</button>'));
  assert.match(read('popup.js'), /chrome\.sidePanel\.open\(/);
  assert.deepEqual([...read('report.html').matchAll(/<script src="([^"]+)"/g)].map((x) => x[1]), ['lists.js', 'core.js', 'history.js', 'report-view.js', 'report-page.js']);
});
test('opened beside a page: the report is about the tab in front, with what Chrome blocked there and its cookies cut short', async () => {
  const bg = await load(on({ matched: { 1: ['trackers', 'trackers', 'url-params'], 2: ['trackers'] } })), page = await loadPage(bg), t = page.text();
  assert.ok(t.includes('This page: www.example.com'));
  assert.ok(t.includes('2 blocked on this page')); assert.ok(t.includes('1 link cleaned on this page'));
  assert.ok(t.includes('3 cookies on www.example.com'));
  assert.ok(page.out.innerHTML.includes(SHOWN)); assert.equal(page.out.innerHTML.includes(SECRET), false);
  assert.equal(page.note.textContent, '');
});
test('it follows the tab: another tab comes to the front, or the tab goes to another address, and the report is drawn again', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  bg.state.tabs[0].active = false; bg.state.tabs[1].active = true;
  await bg.chrome.tabs.onActivated.fire({ tabId: 2, windowId: 1 }); await bg.settle();
  assert.ok(page.text().includes('This page: other.test')); assert.ok(page.text().includes('1 cookie on other.test'));
  await bg.navigate(2, 'https://www.example.com/next'); await bg.settle();
  assert.ok(page.text().includes('This page: www.example.com'));
  await bg.navigate(2, 'chrome://settings/'); await bg.settle();
  assert.ok(page.text().includes('This tab is not a web page'));
  await bg.navigate(1, 'https://other.test/'); await bg.settle();   // a tab in the background: the report stays
  assert.ok(page.text().includes('This tab is not a web page'));
});
test('in a tab of its own (report.html?tab=1) it is about that tab, and moves on when another tab comes to the front', async () => {
  const bg = await load(on({ tabs: [TAB, { ...OTHER, active: true }] })), page = await loadPage(bg, '?tab=1');
  assert.ok(page.text().includes('This page: www.example.com'));
  await bg.chrome.tabs.onActivated.fire({ tabId: 2, windowId: 1 }); await bg.settle();
  assert.ok(page.text().includes('This page: other.test'));
});
test('a button with a message sends it and the report is drawn again: Delete, Keep, Always delete', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  await page.click('Delete', 'theme');
  assert.deepEqual(await bg.names(), ['SID', '_ga', 'o']); assert.ok(page.text().includes('2 cookies on www.example.com')); assert.equal(page.note.textContent, 'Done.');
  await page.click('Keep', '_ga');
  assert.deepEqual(bg.state.storage.allow, [{ site: 'example.com', name: '_ga' }]); assert.ok(page.text().includes('kept because you chose Keep'));
  await page.click('Always delete', '_ga');
  assert.deepEqual(await bg.names(), ['SID', 'o']); assert.ok(page.text().includes('Always deleted on this site (1)'));
});
test('"Show all of it" puts the whole value on the screen and "Copy what it holds" on the clipboard; neither is kept anywhere', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  const b = await page.click('Show all of it', 'SID');
  assert.equal(b.code.textContent, SECRET); assert.equal(b.removed, true);
  assert.equal(page.out.innerHTML.includes(SECRET), false);         // only that one place on the screen has it
  await page.click('Copy what it holds', 'theme');
  assert.deepEqual(page.copied, [SECRET]); assert.equal(page.note.textContent, 'Copied what this cookie holds.');
  for (const kept of [bg.state.storage, bg.state.session, bg.state.sync]) assert.equal(JSON.stringify(kept).includes(SHOWN), false);
  // the cookie has gone meanwhile: one sentence, nothing copied
  await bg.chrome.cookies.remove({ url: 'https://www.example.com/', name: 'theme' });
  await page.click('Copy what it holds', 'theme');
  assert.equal(page.note.textContent, 'That cookie is no longer there. Press "Read again".'); assert.equal(page.copied.length, 1);
});
test('"Copy command" copies the command the button carries', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  await page.click('Copy command');
  assert.deepEqual(page.copied, ['node tools/inspect.js cookies --site www.example.com']);
  assert.equal(page.note.textContent, 'Copied. Paste it into a terminal opened in the Tracker Cleaner folder.');
});
test('Chrome will not let the page copy (it wants a click inside the report first): one sentence that says what to do', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  page.noClipboard = true;
  await page.click('Copy command'); assert.equal(page.note.textContent, 'Could not copy. Click once inside this report, then press the button again.');
  await page.click('Copy what it holds', 'theme'); assert.equal(page.note.textContent, 'Could not copy. Click once inside this report, then press the button again.');
  assert.deepEqual(page.copied, []);
});
test('"Delete N cookies on this site" leaves what stays, unless the box beside it is ticked', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  await page.click('Delete 2 cookies on this site');
  assert.deepEqual(await bg.names(), ['SID', 'o']); assert.equal(page.note.textContent, 'Deleted 2 of 2.');
  await page.also.tick(true);
  assert.equal(page.all.textContent, 'Delete 1 cookie on this site');   // the number on the button is what will go now
  await page.click('Delete 0 cookies on this site');
  assert.deepEqual(await bg.names(), ['o']); assert.equal(page.note.textContent, 'Deleted 1 of 1.');
});
test('"Read again" draws the report anew; a refused press says why', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  await bg.setCookie({ url: 'https://www.example.com/', name: 'new', value: '1' });
  assert.ok(page.text().includes('3 cookies on www.example.com'));
  await page.click('Read again');
  assert.ok(page.text().includes('4 cookies on www.example.com'));
  const b = page.buttons().find((x) => x.label === 'Delete'), stale = { ...b, closest: () => stale, dataset: b.dataset };
  await bg.send({ type: 'pause' }); await page.out.on.click({ target: stale }); await bg.settle();   // the report on the screen is older than the pause
  assert.equal(page.note.textContent, 'Not done: cleaning is paused.');
});
test('the top line works: the switch, Pause and Resume, putting back what was deleted, clearing the saved copies', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  await page.click('Delete', 'theme');
  await page.click('Put back 1 deleted cookie');
  assert.ok((await bg.names()).includes('theme')); assert.equal(page.note.textContent, 'Put back 1.');
  await page.click('Pause 10 min'); assert.ok(page.text().includes('Cleaning is paused until'));
  await page.click('Resume'); assert.ok(page.text().includes('Cleaning is on'));
  await page.click('Clear the saved copies of pages');
  assert.equal(bg.called('browsingData.remove').length, 1); assert.equal(page.note.textContent, 'Done.');
  await page.tick('On', false);
  assert.equal(bg.state.storage.master, false); assert.ok(page.text().includes('Cleaning is off'));
});
test('the waiting lines work: "Remove 1 cookie" removes exactly what waits, Postpone puts it off', async () => {
  const bg = await load(on()), page = await loadPage(bg);
  await bg.alarm('sweep'); await page.click('Read again');
  assert.ok(page.text().includes("Trackers' cookies: 1 waiting"));
  await page.click('Postpone 1 hour');
  assert.ok(bg.state.storage.pending.cookies.postponedUntil > bg.now); assert.ok(page.text().includes('1 waiting, put off until'));
  await page.click('Remove 1 cookie');
  assert.deepEqual(await bg.names(), ['SID', 'theme', 'o']); assert.equal(page.note.textContent, 'Removed 1 of 1.');
  assert.ok(page.text().includes('Nothing is waiting for your answer.'));
});
test('"Count what this page has saved" looks into the tab only when pressed; the count stays through a redraw and is forgotten when the tab moves on', async () => {
  const bg = await load(on({ pages: { 1: { local: { uid: SECRET, a: '1' }, session: {} } } })), page = await loadPage(bg);
  assert.equal(bg.called('scripting.executeScript').length, 0);
  await page.click('Count what this page has saved');
  assert.ok(page.text().includes('2 on this page'));
  await page.click('Read again'); assert.ok(page.text().includes('2 on this page'));
  await page.click('Show the 2');
  assert.ok(page.out.innerHTML.includes(`uid <code>${SHOWN}…</code>`)); assert.equal(page.out.innerHTML.includes(SECRET), false);
  await bg.navigate(1, 'https://www.example.com/next'); await bg.settle();
  assert.ok(page.text().includes('Nothing on the page is looked at until you press this.'));
  for (const kept of [bg.state.storage, bg.state.session, bg.state.sync]) assert.equal(JSON.stringify(kept).includes(SHOWN), false);
});
test('the page script writes nothing itself: no storage call, no fetch', () => {
  assert.doesNotMatch(read('report-page.js'), /chrome\.storage|fetch\(|localStorage|sessionStorage|indexedDB/);
});
