// Real-browser check: loads extension/ into a fresh Google Chrome and drives it over the DevTools protocol.
//   npm run test:browser          (not part of `npm test`; needs Google Chrome and the network, no packages)
// One line per check: PASS, FAIL or NOT RUN, with what was observed. Exit code 1 when a check failed.
// Chrome is started headless with its own empty profile (a new folder under TC_BROWSER_TMP or the system temp
// folder, deleted afterwards) and is killed at the end; a running Chrome of the user is never touched.
// Branded Chrome ignores --load-extension: the extension is loaded with the DevTools method
// Extensions.loadUnpacked, which needs --remote-debugging-pipe and --enable-unsafe-extension-debugging.
// Env: CHROME (binary, default google-chrome), TC_BROWSER_TMP (where the profile goes), TC_HEADFUL=1 (show the window),
// TC_VERIFY=1 (only the third run, the V checks), TC_REPORT=1 (only the fourth run, the R checks of the 1.23 report).
const { spawn, execFileSync } = require('node:child_process'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const EXT = path.join(__dirname, '..', '..', 'extension');
const AUDIT = '127.0.0.1:8088';   // the optional local audit server: Chrome prints a red line for every unanswered fetch
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000, step = 100) => { const end = Date.now() + ms;
  for (;;) { let v; try { v = await fn(); } catch {} if (v) return v; if (Date.now() > end) return null; await sleep(step); } };
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`timeout: ${what}`); })]);

// ---- Chrome and the DevTools protocol over the pipe (fd 3 in, fd 4 out, messages end with a NUL)
async function launch() {
  const dir = fs.mkdtempSync(path.join(process.env.TC_BROWSER_TMP || os.tmpdir(), 'tc-chrome-'));
  const child = spawn(process.env.CHROME || 'google-chrome', [...(process.env.TC_HEADFUL ? [] : ['--headless=new']), '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen',
    '--window-size=1200,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const waiting = new Map(), sessions = new Map(), listeners = [];
  let n = 0, buf = '', dead = false;
  child.stdio[3].on('error', () => {});
  child.stdio[4].setEncoding('utf8');
  child.stdio[4].on('data', (d) => { buf += d;
    for (let i; (i = buf.indexOf('\0')) >= 0;) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (m.id) { const w = waiting.get(m.id); waiting.delete(m.id); if (w) m.error ? w.no(new Error(`${w.method}: ${m.error.message}`)) : w.yes(m.result); }
      else { const s = m.sessionId && sessions.get(m.sessionId); if (s) s.events.push(m); for (const f of listeners) f(m); } } });
  child.on('exit', () => { dead = true; for (const w of waiting.values()) w.no(new Error('Chrome exited')); });
  const send = (method, params = {}, sessionId) => new Promise((yes, no) => { if (dead) return no(new Error('Chrome exited'));
    waiting.set(++n, { yes, no, method }); child.stdio[3].write(JSON.stringify({ id: n, method, params, sessionId }) + '\0'); });
  // a session on one target: its events are kept, ev() evaluates an expression there and returns its value
  const attach = async (targetId, domains = ['Runtime', 'Log']) => {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = { targetId, sessionId, events: [], send: (m, p) => send(m, p, sessionId),
      ev: async (expression) => { const r = await within(send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId), 30000, expression.slice(0, 60));
        if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
        return r.result.value; } };
    sessions.set(sessionId, s);
    for (const d of domains) await s.send(`${d}.enable`);
    return s;
  };
  const close = async () => { try { await within(send('Browser.close'), 3000, 'close'); } catch {}
    await until(() => dead, 3000); if (!dead) child.kill('SIGKILL'); await until(() => dead, 3000);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  return { send, attach, close, dir, pid: child.pid, on: (f) => listeners.push(f) };
}
// red lines of a session: uncaught exceptions and rejections, console.error, error-level log entries.
// Returns [real, audit]: lines about the unanswered audit server are counted apart.
const redLines = (s) => { const lines = [];
  for (const { method, params: p } of s.events) {
    if (method === 'Runtime.exceptionThrown') lines.push(`${(p.exceptionDetails.exception || {}).description || p.exceptionDetails.text} (${p.exceptionDetails.url || ''}:${p.exceptionDetails.lineNumber})`);
    else if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) lines.push('console.error: ' + p.args.map((a) => a.value ?? a.description).join(' '));
    else if (method === 'Log.entryAdded' && p.entry.level === 'error') lines.push(`${p.entry.text} ${p.entry.url || ''}`); }
  return [lines.filter((l) => !l.includes(AUDIT)), lines.filter((l) => l.includes(AUDIT))]; };

// ---- One browser with the extension loaded and its popup open as a tab
async function start() {
  const b = await launch();
  try {
    const { id } = await b.send('Extensions.loadUnpacked', { path: EXT });
    const origin = `chrome-extension://${id}`;
    await b.send('Target.setDiscoverTargets', { discover: true });
    // the service worker may be stopped and started again by Chrome: always talk to the newest one, keep all their events
    const workers = [];
    const hook = async (t) => { if (t.type === 'service_worker' && t.url.startsWith(origin) && !workers.some((w) => w.targetId === t.targetId)) {
      const w = { targetId: t.targetId, events: [] }; workers.push(w);
      try { Object.assign(w, await b.attach(t.targetId)); } catch { workers.splice(workers.indexOf(w), 1); } } };
    b.on((m) => { if (m.method === 'Target.targetCreated') hook(m.params.targetInfo);
      if (m.method === 'Target.targetDestroyed') { const w = workers.find((x) => x.targetId === m.params.targetId); if (w) w.gone = true; } });
    for (const t of (await b.send('Target.getTargets')).targetInfos) await hook(t);
    const sw = async (expr) => { const w = await until(() => workers.findLast((x) => !x.gone && x.ev), 10000);
      if (!w) throw new Error('no service worker'); return w.ev(`(async () => { ${expr} })()`); };
    const swRed = () => workers.reduce(([a, c], w) => { const [x, y] = redLines(w); return [[...a, ...x], [...c, ...y]]; }, [[], []]);
    const tab = async (url) => { const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
      const s = await b.attach(targetId, ['Runtime', 'Log', 'Page', 'Network']); if (url) await go(s, url); return s; };
    const go = async (s, url) => { const from = s.events.length;
      const r = await s.send('Page.navigate', { url });
      const ok = await until(() => s.events.slice(from).some((e) => e.method === 'Page.loadEventFired'), 30000);
      return { error: r.errorText || (ok ? '' : 'no load event in 30 s') }; };
    const cookies = async () => (await b.send('Storage.getCookies')).cookies;
    const cookie = async (name, domain) => (await cookies()).find((c) => c.name === name && c.domain.replace(/^\./, '') === domain);
    const popup = await tab(`${origin}/popup.html`);
    const rendered = () => until(() => popup.ev(`(() => { const o = document.getElementById('out'); return !!o && o.children.length > 0 && !o.textContent.includes('Loading'); })()`), 8000);
    await rendered();
    const P = {
      s: popup,
      text: () => popup.ev(`document.querySelector('main').innerText`),
      note: () => popup.ev(`document.getElementById('note').textContent`),
      row: (group) => popup.ev(`(document.querySelector('[data-group="${group}"]') || {}).innerText || ''`),
      state: () => popup.ev(`chrome.runtime.sendMessage({ type: 'state' })`),
      // what opening the popup does: the page is loaded again while `front` (default: the popup's own tab) is the tab in front
      reopen: async (front) => { await b.send('Target.activateTarget', { targetId: (front || popup).targetId }); await sleep(150);
        await popup.send('Page.reload'); await sleep(100); await rendered(); },
      // presses the first control with this label (a button, or the checkbox of a label), inside one group row when given
      click: (label, group) => popup.ev(`(() => { const root = ${group ? `document.querySelector('[data-group="${group}"]')` : `document.getElementById('out')`};
        const el = root && ([...root.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}))
          || ([...root.querySelectorAll('label')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})) || { querySelector: () => null }).querySelector('input'));
        if (!el || el.disabled) return false; el.click(); return true; })()`) };
    return { b, id, origin, sw, swRed, tab, go, cookies, cookie, P, popup, close: b.close };
  } catch (e) { await b.close(); throw e; }
}

// ---- Reporting
let failed = 0, skipped = 0;
// a check: fn(ok, see) calls ok(condition, what) for every expectation and see(text) for what it observed
async function check(nr, title, fn, skip) {
  if (skip) { skipped++; console.log(`NOT RUN ${nr}. ${title}: ${skip}`); return; }
  const bad = [], seen = [];
  const ok = (cond, what) => { if (!cond) bad.push(what); return !!cond; }, see = (t) => seen.push(t);
  try { await within(fn(ok, see), 120000, 'check took over 2 minutes'); } catch (e) { bad.push(`threw: ${e.message.split('\n')[0]}`); }
  if (bad.length) failed++;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${nr}. ${title}: ${bad.length ? `FAILED: ${bad.join('; ')}. ` : ''}${seen.join('; ')}`);
}
const brief = (list) => list.length ? `${list.length} (${list.slice(0, 3).join(' | ').slice(0, 400)})` : '0';
const setInPage = (s, text) => s.ev(`document.cookie = ${JSON.stringify(text)}; document.cookie`);
// requests the tracker script from the page; says how the page saw it end and what Chrome gave as the reason
const requestTracker = async (s) => { const from = s.events.length, url = `https://www.google-analytics.com/analytics.js?t=${Date.now()}`;
  const end = await s.ev(`new Promise((r) => { const e = document.createElement('script'); e.src = ${JSON.stringify(url)}; e.onload = () => r('loaded'); e.onerror = () => r('error');
    document.head.appendChild(e); setTimeout(() => r('timeout'), 15000); })`);
  await sleep(200);
  const req = s.events.slice(from).find((e) => e.method === 'Network.requestWillBeSent' && e.params.request.url === url);
  const fail = req && s.events.slice(from).find((e) => e.method === 'Network.loadingFailed' && e.params.requestId === req.params.requestId);
  return { end, why: fail ? fail.params.errorText : '', blocked: end === 'error' && !!fail && fail.params.errorText === 'net::ERR_BLOCKED_BY_CLIENT' }; };
const RULE_FILES = { trackers: 'rules.json', 'google-paths': 'rules-google.json', 'url-params': 'rules-params.json' };
const NID = (days = 180) => ({ name: 'NID', value: 'browser-test', domain: '.google.com', path: '/', secure: true, httpOnly: true, sameSite: 'None', expires: Math.floor(Date.now() / 1000) + days * 86400 });

async function main() {
  let online = true;
  try { await within(fetch('https://example.com/', { method: 'HEAD' }), 10000, 'network'); } catch { online = false; }
  const offline = online ? '' : 'no network from this machine';
  if (process.env.TC_VERIFY) { await verify(offline); process.exit(failed ? 1 : 0); }
  if (process.env.TC_REPORT) { await report(offline); process.exit(failed ? 1 : 0); }
  let x;
  try { x = await start(); } catch (e) { console.log(`FAIL 1. The extension loads: ${e.message.split('\n')[0]}`); process.exit(1); }
  const { b, sw, swRed, P } = x;
  let site = null, snapshot = null, setAt = 0;
  try {
    await check(1, 'The extension loads', async (ok, see) => {
      const v = await sw(`await ready; return chrome.runtime.getManifest().version;`);
      ok(v === '1.23', `manifest version ${v}`);
      await sleep(1500);   // the sweep of onInstalled
      const [first, audit1] = swRed();
      ok(!first.length, `service worker errors after start-up: ${brief(first)}`);
      await sw(`await sweep('browser-test');`);
      const [red, audit] = swRed();
      ok(!red.length, `service worker errors after a forced sweep: ${brief(red)}`);
      see(`loaded with Extensions.loadUnpacked as ${x.id}, version ${v}, service worker running, ${red.length} errors after start-up and a forced sweep`
        + (audit.length ? ` (plus ${audit.length} red "Failed to load" lines for the audit server at ${AUDIT}, ${audit1.length} of them at start-up, which is not running)` : ''));
    });

    await check(2, 'Static rulesets enabled, every rule accepted', async (ok, see) => {
      // Chrome only tells how many static rules the extension may still enable: what switching one ruleset off frees
      // is the number of its rules Chrome took
      const r = await sw(`const d = chrome.declarativeNetRequest, on = await d.getEnabledRulesets(), took = {};
        for (const id of on) { const a = await d.getAvailableStaticRuleCount(); await d.updateEnabledRulesets({ disableRulesetIds: [id] });
          took[id] = (await d.getAvailableStaticRuleCount()) - a; await d.updateEnabledRulesets({ enableRulesetIds: [id] }); }
        return { on, took, after: await d.getEnabledRulesets() };`);
      const counts = Object.fromEntries(Object.entries(RULE_FILES).map(([id, f]) => [id, JSON.parse(fs.readFileSync(path.join(EXT, f), 'utf8')).length]));
      ok(Object.keys(RULE_FILES).every((id) => r.on.includes(id)) && r.on.length === 3, `enabled rulesets: ${r.on.join(', ') || 'none'}`);
      for (const [id, n] of Object.entries(counts)) ok(r.took[id] === n, `${id}: Chrome took ${r.took[id]} of the ${n} rules in ${RULE_FILES[id]}`);
      ok(r.after.length === 3, `rulesets after the count: ${r.after.join(', ')}`);
      see(`enabled: ${r.on.join(', ')}; rules Chrome took / rules in the file: ${Object.entries(counts).map(([k, n]) => `${k} ${r.took[k]}/${n}`).join(', ')}`);
    });

    await check(3, 'Popup renders, cleaning off on a fresh profile', async (ok, see) => {
      const text = await P.text(), [red, audit] = redLines(x.popup), rows = await x.popup.ev(`document.querySelectorAll('[data-group]').length`);
      ok(text.includes('Cleaning is off until you turn it on'), `popup text: ${text.slice(0, 120)}`);
      ok(/Turn on/.test(text), 'no "Turn on" button');
      ok(rows === 13, `${rows} group rows, expected 13`);
      ok(!red.length, `popup console errors: ${brief(red)}`);
      see(`"Cleaning is off until you turn it on." with Turn on, ${rows} group rows, ${red.length} console errors`
        + (audit.length ? ` (plus ${audit.length} red line for the audit server)` : ''));
    });

    await check(4, 'Cleaning off: _ga is not removed', async (ok, see) => {
      site = await x.tab();
      const nav = await x.go(site, 'https://example.com/');
      if (!ok(!nav.error, `example.com did not load: ${nav.error}`)) return;
      await setInPage(site, '_ga=test; max-age=3600'); setAt = Date.now();
      await sleep(2000); await sw(`await sweep('browser-test');`);
      snapshot = await x.cookie('_ga', 'example.com');
      ok(!!snapshot, '_ga was removed although cleaning is off');
      see(`_ga still on example.com 2 s later and after a sweep`);
    }, offline);

    await check(5, 'Turn on: _ga removed, ordinary cookie kept, shown under "This site"', async (ok, see) => {
      await P.reopen();
      ok(await P.click('Turn on'), 'no "Turn on" button to press');
      ok(await until(async () => (await P.text()).includes('Pause 10 min'), 8000), `popup after Turn on: ${(await P.text()).slice(0, 100)}`);
      ok(await until(async () => !(await x.cookie('_ga', 'example.com'))), 'the _ga from before was not removed by the sweep after Turn on');
      await setInPage(site, 'plain=1; max-age=3600'); await setInPage(site, '_ga=test; max-age=3600'); setAt = Date.now();
      const gone = await until(async () => !(await x.cookie('_ga', 'example.com')));
      ok(gone, 'the newly set _ga is still there after 6 s');
      ok(!!(await x.cookie('plain', 'example.com')), 'the ordinary cookie "plain" was removed');
      await sleep(500); await P.reopen(site);
      const text = await P.text(), line = (/^.*removed\s+example\.com · _ga.*$/m.exec(text) || [''])[0];
      ok(text.includes('This site: example.com'), 'no "This site: example.com" section (tab address not readable?)');
      ok(!!line, `no "removed example.com · _ga" line; popup: ${text.slice(0, 300).replace(/\n+/g, ' / ')}`);
      ok(/Removed in the last 10 minutes: \d+/.test(text), 'no "Removed in the last 10 minutes" line');
      see(`_ga gone ${gone ? 'within 6 s' : 'NOT'}, "plain" kept, popup: "This site: example.com", "${line.replace(/\s+/g, ' ').trim()}"`);
    }, offline);

    await check(6, 'Undo restores the cookie as it was, and it survives a sweep', async (ok, see) => {
      ok(await P.click('Undo'), 'no Undo button on the line');
      ok(await until(async () => (await P.note()) === 'Restored 1.'), `note says "${await P.note()}"`);
      const back = await x.cookie('_ga', 'example.com');
      if (!ok(!!back, '_ga is not back')) return;
      const diff = ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'session', 'sameSite'].filter((k) => back[k] !== snapshot[k]).map((k) => `${k}: ${snapshot[k]} -> ${back[k]}`);
      if (Math.abs(back.expires - (setAt / 1000 + 3600)) > 3) diff.push(`expires: ${setAt / 1000 + 3600} -> ${back.expires}`);
      ok(!diff.length, `restored with other attributes: ${diff.join(', ')}`);
      await sw(`await sweep('browser-test');`); await sleep(500);
      ok(!!(await x.cookie('_ga', 'example.com')), 'the restored _ga was removed by the next sweep');
      const text = await P.text();
      ok(/Your exceptions/.test(text), 'the restored cookie is not under "Your exceptions"');
      // back to normal for the next checks: Revert the exception, the cookie is then cleaned again
      ok(await P.click('Revert'), 'no Revert button');
      ok(await until(async () => !(await x.cookie('_ga', 'example.com'))), 'after Revert the cookie was not cleaned again');
      see(`"Restored 1.", _ga back with the same value, domain, path, flags and expiry (storage.session works), kept by a sweep, listed under "Your exceptions"; Revert cleaned it again`
        + (back.sourceScheme !== snapshot.sourceScheme ? `; note: Chrome's internal source scheme went ${snapshot.sourceScheme} -> ${back.sourceScheme}` : ''));
    }, offline || (!snapshot && 'check 4 did not leave a cookie to compare with'));

    const pendingOf = (st) => st.groups.reduce((n, g) => n + (g.postponedUntil === 'restart' || g.postponedUntil > st.now ? 0 : g.pending), 0);
    await check(7, 'Google identity cookie: pending, badge, "Remove 1 cookie"', async (ok, see) => {
      await b.send('Storage.setCookies', { cookies: [NID()] });
      const st = await until(async () => { const s = await P.state(); return s.groups.find((g) => g.id === 'google').pending ? s : null; });
      if (!ok(!!st, 'NID did not become pending')) return;
      await sleep(1500); await sw(`await sweep('browser-test');`);
      ok(!!(await x.cookie('NID', 'google.com')), 'NID was removed without approval');
      await P.reopen();
      const st2 = await P.state(), g = st2.groups.find((q) => q.id === 'google'), row = await P.row('google'), n = pendingOf(st2);
      const badge = await until(async () => { const t = await sw(`return chrome.action.getBadgeText({});`); return t === String(n) ? t : null; }, 3000) ?? await sw(`return chrome.action.getBadgeText({});`);
      ok(g.items.some((i) => i.name === 'NID'), 'NID is not among the pending items');
      const button = `Remove ${g.pending} cookie${g.pending === 1 ? '' : 's'}`;
      ok(row.includes(`${g.pending} pending`) && row.includes(button), `Google row: ${row.replace(/\n+/g, ' / ')}`);
      ok(badge === String(n), `badge "${badge}", pending ${n}`);
      ok(await P.click(button, 'google'), `no "${button}" button`);
      ok(await until(async () => (await P.note()) === `Cleaned ${g.pending} of ${g.pending}.`), `note says "${await P.note()}"`);
      ok(await until(async () => !(await x.cookie('NID', 'google.com'))), 'NID is still there after Approve');
      const after = await until(async () => (await sw(`return chrome.action.getBadgeText({});`)) === '', 3000);
      ok(after, `badge after Approve: "${await sw(`return chrome.action.getBadgeText({});`)}"`);
      see(`NID kept through a sweep, row "${g.pending} pending" with the button "${button}", badge "${badge}" = ${n} pending; Approve: "Cleaned ${g.pending} of ${g.pending}.", NID gone, badge empty`);
    });

    await check(8, 'Sign-in guard holds while accounts.google.com is in front', async (ok, see) => {
      const acc = await x.tab();
      const nav = await x.go(acc, 'https://accounts.google.com/');
      const url = await acc.ev('location.href').catch(() => '');
      if (!ok(new URL(url || 'about:blank').hostname === 'accounts.google.com', `the tab is on ${url || nav.error}`)) { await b.send('Target.closeTarget', { targetId: acc.targetId }); return; }
      const st = await P.state();
      ok(st.hold.guard === true, 'state.hold.guard is not true');
      ok(st.hold.tab === true, 'state.hold.tab is not true: the address of the tab in front was not read');
      ok(st.hold.guardUntil > st.now, 'guardUntil was not armed by the navigation');
      await setInPage(site, '_ga=test; max-age=3600');
      await sleep(2500);
      ok(!!(await x.cookie('_ga', 'example.com')), '_ga was removed during the sign-in guard');
      const log = (await P.state()).log.filter((l) => l.name === '_ga' && l.did === 'held');
      ok(log.length > 0, 'no "held" entry for _ga in the log');
      await P.reopen(acc);
      const text = await P.text();
      ok(text.includes('Sign-in in progress: cleaning is held.'), 'the popup does not say "Sign-in in progress"');
      ok(text.includes('This site: accounts.google.com'), 'the popup does not show "This site: accounts.google.com"');
      // end the guard (it would hold 5 more minutes): close the tab, forget guardUntil; the held cookie is then cleaned
      await b.send('Target.closeTarget', { targetId: acc.targetId }); await sleep(300);
      await sw(`await chrome.storage.local.remove('guardUntil'); await sweep('browser-test');`);
      ok(await until(async () => !(await x.cookie('_ga', 'example.com'))), 'the held _ga was not cleaned after the guard ended');
      see(`tab on ${url.slice(0, 60)}: hold.guard and hold.tab true (tab address readable without "tabs"), _ga kept and logged "held", popup says "Sign-in in progress: cleaning is held."; cleaned once the guard was ended`);
    }, offline);

    await check(9, 'Pause disables the rulesets and shows II; Resume restores', async (ok, see) => {
      await P.reopen();
      const rulesets = () => sw(`return chrome.declarativeNetRequest.getEnabledRulesets();`), badge = () => sw(`return chrome.action.getBadgeText({});`);
      ok(await P.click('Pause 10 min'), 'no "Pause 10 min" button');
      const off = await until(async () => (await rulesets()).length === 0);
      ok(off, `rulesets still enabled while paused: ${(await rulesets()).join(', ')}`);
      const b1 = await until(async () => (await badge()) === 'II', 3000);
      ok(b1, `badge while paused: "${await badge()}"`);
      const text = await P.text();
      ok(/Paused until \d\d:\d\d/.test(text), 'the popup does not say "Paused until"');
      ok(await P.click('Resume'), 'no Resume button');
      const on = await until(async () => (await rulesets()).length === 3);
      ok(on, `rulesets after Resume: ${(await rulesets()).join(', ') || 'none'}`);
      const b2 = await until(async () => (await badge()) !== 'II', 3000);
      ok(b2, 'badge still II after Resume');
      see(`paused: 0 rulesets enabled, badge "II", "${(/Paused until \d\d:\d\d/.exec(text) || [''])[0]}"; resumed: 3 rulesets, badge "${await badge()}"`);
    });

    await check(10, 'Request blocking, and "Don\'t clean on this site"', async (ok, see) => {
      await x.go(site, 'https://example.com/');
      const r1 = await requestTracker(site);
      ok(r1.blocked, `the tracker request was not blocked: ${r1.end} ${r1.why}`);
      await P.reopen(site);
      const t1 = await P.text(), count = (/(\d+) requests? blocked on this tab/.exec(t1) || [])[1];
      ok(Number(count) >= 1, `blocked-request count in the popup: ${count === undefined ? 'no line' : count}`);
      ok(await P.click("Don't clean on this site"), 'no "Don\'t clean on this site" box');
      ok(await until(async () => (await P.state()).sitesOff.includes('example.com')), 'example.com did not get into sitesOff');
      const dyn = await sw(`return chrome.declarativeNetRequest.getDynamicRules();`);
      ok(dyn.length === 2 && dyn.map((d) => d.action.type).sort().join() === 'allow,allowAllRequests', `dynamic rules: ${JSON.stringify(dyn).slice(0, 300)}`);
      const r2 = await requestTracker(site);   // the page as it is, loaded before the box was ticked
      await x.go(site, 'https://example.com/');
      const r3 = await requestTracker(site);
      ok(!r3.blocked && r3.end === 'loaded', `after "Don't clean on this site" and a reload the request ended: ${r3.end} ${r3.why}`);
      ok(!r2.blocked && r2.end === 'loaded', `in the page that was already open the request ended: ${r2.end} ${r2.why}`);
      // and back
      await P.reopen(site);
      ok(await P.click("Don't clean on this site"), 'the box could not be unticked');
      ok(await until(async () => !(await P.state()).sitesOff.length), 'example.com stayed in sitesOff');
      await x.go(site, 'https://example.com/');
      const r4 = await requestTracker(site);
      ok(r4.blocked, `after unticking the request is not blocked again: ${r4.end} ${r4.why}`);
      see(`analytics.js blocked (${r1.why}); popup count: "${count} request${count === '1' ? '' : 's'} blocked on this tab" (getMatchedRules works); with the box ticked: `
        + `${r2.blocked ? 'still blocked' : r2.end} in the open page, ${r3.end} after a reload; unticked: ${r4.blocked ? 'blocked again' : r4.end}`);
    }, offline);

    await check(11, 'Tracking parameters are stripped, but not on accounts.google.com', async (ok, see) => {
      await x.go(site, 'https://example.com/?utm_source=x&gclid=y&keep=1');
      const end = await site.ev('location.href');
      ok(end === 'https://example.com/?keep=1', `ended on ${end}`);
      const acc = await x.tab(), start = 'https://accounts.google.com/?utm_source=x&gclid=y&keep=1';
      await x.go(acc, start);
      const docs = acc.events.filter((e) => e.method === 'Network.requestWillBeSent' && e.params.type === 'Document');
      const first = docs.find((e) => e.params.request.url === start), next = docs.find((e) => e.params.redirectResponse && e.params.redirectResponse.url === start);
      const internal = !!next && /internal redirect/i.test(next.params.redirectResponse.statusText || '');
      ok(!!first, 'the request with the parameters was never sent');
      ok(!internal, `Chrome redirected it internally to ${next && next.params.request.url}`);
      const how = next ? `Google's own ${next.params.redirectResponse.status} redirect followed` : 'answered without a redirect';
      const accEnd = await acc.ev('location.href').catch(() => '');
      await b.send('Target.closeTarget', { targetId: acc.targetId });
      await sw(`await chrome.storage.local.remove('guardUntil');`);
      see(`example.com ended on ${end}; accounts.google.com was requested with its parameters, no extension redirect (${how}${next ? `, to ${next.params.request.url.slice(0, 90)}` : ''}; page ended on ${accEnd.slice(0, 60)})`);
    }, offline);

    await check(12, 'YouTube loads with the content script', async (ok, see) => {
      const scripts = await sw(`return (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);`);
      ok(scripts.includes('yt-adfree') && scripts.includes('yt-adfree-css'), `registered content scripts: ${scripts.join(', ') || 'none'}`);
      const yt = await x.tab(), nav = await x.go(yt, 'https://www.youtube.com/');
      await sleep(3000);
      const url = await yt.ev('location.href').catch(() => ''), host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
      ok(!nav.error || host.endsWith('youtube.com'), `youtube.com did not load: ${nav.error}`);
      const patched = await yt.ev(`!/\\[native code\\]/.test(Function.prototype.toString.call(JSON.parse)) && !/\\[native code\\]/.test(Function.prototype.toString.call(Response.prototype.json))`).catch(() => false);
      if (host.endsWith('youtube.com')) ok(patched, 'yt-adfree.js did not run in the page (JSON.parse is untouched)');
      const title = await yt.ev('document.title').catch(() => '');
      const thrown = yt.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params.exceptionDetails);
      const ours = thrown.filter((d) => JSON.stringify(d).includes('yt-adfree') || JSON.stringify(d).includes(x.id));
      ok(!ours.length, `page errors from the content script: ${brief(ours.map((d) => (d.exception || {}).description || d.text))}`);
      await b.send('Target.closeTarget', { targetId: yt.targetId });
      see(`scripts registered: ${scripts.join(', ')}; ended on ${url.slice(0, 70)} ("${title}"), yt-adfree.js ${patched ? 'ran' : 'did not run'} in the page, ${thrown.length} uncaught page errors, ${ours.length} from the extension`);
    }, offline);

    await check(13, 'Wi-Fi row without the helper, and nothing else broke', async (ok, see) => {
      await sw(`await sweep('browser-test');`);
      await P.reopen();
      const row = await P.row('wifi'), opts = await x.popup.ev(`[...document.querySelectorAll('[data-group="wifi"] option')].map((o) => o.textContent)`);
      ok(row.includes('Helper not installed (see wifi-helper/README.md)'), `Wi-Fi row: ${row.replace(/\n+/g, ' / ')}`);
      ok(opts.join(',') === 'Off,Ask first', `Wi-Fi choices: ${opts.join(', ')}`);
      ok(row.includes('Nothing waiting'), 'the Wi-Fi row has something waiting');
      const st = await P.state(), [red, audit] = swRed(), [pred] = redLines(x.popup);
      ok(st && st.groups.length === 13, 'the state message did not answer with 13 groups');
      ok(!red.length, `service worker errors during the run: ${brief(red)}`);
      ok(!pred.length, `popup errors during the run: ${brief(pred)}`);
      see(`row: "${row.replace(/\n+/g, ' / ')}", choices ${opts.join(' / ')}; over the whole run ${red.length} service worker errors and ${pred.length} popup errors`
        + (audit.length ? ` (${audit.length} red lines for the audit server ${AUDIT} not counted)` : ''));
    });

    // ---- 1.22: the "now and history" page (history.html)
    const DAY = `${new Date().getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date().getMonth()]} ${new Date().getFullYear()}`;
    let page = null;
    const pageText = () => page.ev(`document.querySelector('main').innerText`);
    await check(14, 'The page opens from the popup and shows what was removed in this run, under today', async (ok, see) => {
      await P.reopen();
      ok(await x.popup.ev(`(() => { const a = document.querySelector('a[href="history.html"]'); if (!a || a.textContent !== 'See everything and its history') return false; a.click(); return true; })()`), 'no link "See everything and its history" in the popup');
      const t = await until(async () => (await b.send('Target.getTargets')).targetInfos.find((i) => i.type === 'page' && i.url === `${x.origin}/history.html`), 8000);
      if (!ok(!!t, 'the link opened no tab on history.html')) return;
      page = await b.attach(t.targetId, ['Runtime', 'Log', 'Page', 'Network']);
      ok(await until(() => page.ev(`document.querySelectorAll('#out section').length === 9`), 8000), `the page did not show its 9 blocks: ${(await pageText()).slice(0, 200)}`);
      const text = await pageText(), h = await page.ev(`chrome.runtime.sendMessage({ type: 'history' })`), days = Object.keys(h.days), today = h.days[days[0]] || {};
      const n = (today.cookies || 0) + (today.google || 0), line = (/Removed: .*/.exec(text) || [''])[0];
      ok(days.length === 1 && n >= 3, `the history has ${days.length} day(s) and ${n} cookie removals today; this run removed _ga three times and NID once`);
      ok(line.startsWith(`Removed: ${n} today, ${n} in the last 30 days.`), `the cookie block says "${line.slice(0, 80)}", the history has ${n}`);
      // the rows of one collapsed list of the cookie block
      const list = (heading) => page.ev(`[...([...document.querySelectorAll('#cookies details')].find((d) => d.querySelector('summary').textContent.startsWith(${JSON.stringify(heading)})) || document.createElement('p')).querySelectorAll('.c')].map((r) => r.textContent)`);
      const perDay = await list('Removed, day by day'), often = await list('Removed most often');
      ok(perDay.length === 1 && perDay[0] === `${DAY}: ${n}`, `"Removed, day by day" is not just "${DAY}: ${n}": ${perDay.join(' | ')}`);
      ok(often.some((r) => /^example\.com · _ga: \d+ times, first on /.test(r)) && often.some((r) => r.startsWith(`google.com · NID: 1 time, first on ${DAY}, last on ${DAY}`)), `"Removed most often": ${often.join(' | ')}`);
      ok(text.includes(`Clear history (1 day)`), 'no button "Clear history (1 day)"');
      const open = await page.ev(`document.querySelectorAll('details[open]').length`), copies = await page.ev(`document.querySelectorAll('button[data-copy]').length`);
      ok(open === 0, `${open} lists are open at the start`); ok(copies === 8, `${copies} "Copy command" buttons, expected 8`);
      const asked = page.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url).filter((u) => !u.startsWith(x.origin));
      ok(!asked.length, `opening the page sent requests: ${brief(asked)}`);
      const sync = await sw(`return Object.keys(await chrome.storage.sync.get(null)).length;`), [red] = redLines(page);
      ok(sync === 0, `${sync} keys in storage.sync`); ok(!red.length, `page console errors: ${brief(red)}`);
      see(`a tab on history.html with 9 blocks; cookies: "${line.slice(0, 60)}"; day by day "${DAY}: ${n}"; most often "${often.join(' | ')}"; all lists collapsed, ${copies} copy buttons, `
        + `no request left the page on opening, storage.sync empty, ${red.length} console errors`);
    });

    await check(15, 'The Tor check runs only at its button and answers from inside Chrome', async (ok, see) => {
      const before = (await pageText()).includes('Websites see you as');
      ok(!before, 'an answer is shown before the button was pressed');
      ok(await page.ev(`(() => { const b = document.querySelector('button[data-act="tor"]'); if (!b || b.textContent !== 'Check how websites see me') return false; b.click(); return true; })()`), 'no button "Check how websites see me"');
      const said = await until(async () => (/Websites see you as [^\n]*|There was no answer[^\n]*/.exec(await pageText()) || [null])[0], 30000);
      const asked = page.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url).filter((u) => !u.startsWith(x.origin));
      ok(asked.length === 1 && asked[0] === 'https://check.torproject.org/api/ip', `requests after one press: ${brief(asked)}`);
      ok(!!said && /This is not Tor: it is your own address, or that of your VPN\.$/.test(said), `the page said: ${String(said).replace(/\d+\.\d+$|(\d+\.\d+)\.\d+\.\d+/g, '$1.x.x')}`);
      const set = (await pageText()).includes('There now: Chrome is not set to use Tor.');
      ok(set, 'the block does not say "Chrome is not set to use Tor."');
      see(`nothing asked before the press; one press sent exactly one request, to check.torproject.org; the page said "${String(said).replace(/(\d+\.\d+)\.\d+\.\d+/g, '$1.x.x').replace(/([0-9a-f]+:[0-9a-f]+):[0-9a-f:]+/i, '$1:x:x')}" and "Chrome is not set to use Tor."`);
    }, offline || (!page && 'check 14 did not open the page'));

    await check(16, 'A web page cannot fetch, frame or message the page', async (ok, see) => {
      await x.go(site, 'https://example.com/');
      const url = `${x.origin}/history.html`;
      const got = await site.ev(`fetch(${JSON.stringify(url)}).then((r) => 'fetched ' + r.status, (e) => 'refused')`);
      ok(got === 'refused', `fetch from example.com: ${got}`);
      const framed = await site.ev(`new Promise((done) => { const f = document.createElement('iframe'); f.src = ${JSON.stringify(url)}; f.onload = () => setTimeout(() => { let inside; try { inside = f.contentDocument ? 'readable: ' + f.contentDocument.body.innerText.slice(0, 40) : 'not readable'; } catch { inside = 'not readable'; } done(inside); }, 500);
        document.body.appendChild(f); setTimeout(() => done('never loaded'), 6000); })`);
      const tree = await site.send('Page.getFrameTree'), frames = (tree.frameTree.childFrames || []).map((c) => c.frame.url + (c.frame.unreachableUrl ? ` (wanted ${c.frame.unreachableUrl})` : ''));
      ok(!frames.some((u) => u.startsWith(url)), `the frame shows the page: ${frames.join(', ')}`);
      ok(!framed.startsWith('readable: ') || !/Tracker Cleaner|Removed|cookies/.test(framed), `the frame's content is readable from example.com: ${framed}`);
      const runtime = await site.ev(`typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function' ? 'no chrome.runtime.sendMessage' : chrome.runtime.sendMessage(${JSON.stringify(x.id)}, { type: 'history' }).then((r) => 'answered: ' + JSON.stringify(r).slice(0, 80), (e) => 'refused')`);
      ok(!runtime.startsWith('answered'), `a message from example.com was ${runtime}`);
      see(`from example.com: fetch ${got}; an iframe on the page ended as ${frames.join(', ') || 'no frame'} (${framed}); messaging: ${runtime}`);
    }, offline || (!site && 'no web page tab'));

    await check(17, '"Clear history" empties the history', async (ok, see) => {
      ok(await page.ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Clear history (1 day)'); if (!b) return false; b.click(); return true; })()`), 'no button "Clear history (1 day)" to press');
      ok(await until(async () => (await pageText()).includes('Nothing has been removed yet, so there is no history.'), 6000), `the page after the press: ${(await pageText()).slice(0, 300).replace(/\n+/g, ' / ')}`);
      const note = await page.ev(`document.getElementById('note').textContent`), h = await page.ev(`chrome.runtime.sendMessage({ type: 'history' })`), stored = await sw(`return 'history' in await chrome.storage.local.get('history');`);
      ok(note === 'Done.', `note says "${note}"`); ok(Object.keys(h.days).length === 0 && Object.keys(h.cookies).length === 0, `the history still has ${JSON.stringify(h).slice(0, 120)}`);
      ok(stored === false, 'chrome.storage.local still has a "history" entry');
      const line = (/Removed: .*/.exec(await pageText()) || [''])[0];
      ok(line.startsWith('Removed: none in the last 30 days.'), `the cookie block now says "${line.slice(0, 80)}"`);
      see(`"${note}", the page says "Nothing has been removed yet, so there is no history.", the cookie block "${line.slice(0, 40)}", storage has no history entry`);
    }, !page && 'check 14 did not open the page');
  } finally { await x.close(); }

  // ---- second run, fresh profile: Postpone instead of Approve
  await check('7b', 'Postpone 1 h clears the badge and keeps the cookie (second run)', async (ok, see) => {
    const y = await start();
    try {
      await y.sw(`await ready;`); await sleep(1000);
      ok(await y.P.click('Turn on'), 'no "Turn on" button');
      await until(async () => (await y.P.text()).includes('Pause 10 min'));
      await y.b.send('Storage.setCookies', { cookies: [NID()] });
      const badge = () => y.sw(`return chrome.action.getBadgeText({});`);
      const b1 = await until(async () => (await badge()) === '1');
      ok(b1, `badge with NID pending: "${await badge()}"`);
      await y.P.reopen();
      ok(await y.P.click('Postpone 1 h', 'google'), 'no "Postpone 1 h" button');
      const b2 = await until(async () => (await badge()) === '');
      ok(b2, `badge after Postpone: "${await badge()}"`);
      const row = await until(async () => { const r = await y.P.row('google'); return /Postponed until \d\d:\d\d/.test(r) ? r : null; });
      ok(row, `Google row after Postpone: ${(await y.P.row('google')).replace(/\n+/g, ' / ')}`);
      await y.sw(`await sweep('browser-test');`); await sleep(500);
      ok(!!(await y.cookie('NID', 'google.com')), 'NID was removed');
      ok((await badge()) === '', `badge after a sweep: "${await badge()}"`);
      const [red] = y.swRed();
      ok(!red.length, `service worker errors: ${brief(red)}`);
      see(`badge "1" with NID pending; after Postpone 1 h: badge empty, "${(/1 pending.*/.exec(row || '') || [''])[0]}", NID kept through a sweep`);
    } finally { await y.close(); }
  });

  await verify(offline);
  await report(offline);

  console.log(failed ? `${failed} check${failed === 1 ? '' : 's'} FAILED` + (skipped ? `, ${skipped} not run` : '') : skipped ? `no failures, but ${skipped} checks NOT RUN` : 'all checks passed');
  process.exit(failed ? 1 : 0);
}

// ---- third run, fresh profile: what Chrome really does for the "to verify" items of PLAN.md ("Todo for 1.22").
// These checks report (FOUND: ...); one fails only when it could not look at all. Where headless Chrome gives no
// answer it says NOT DECIDED instead of guessing. Cleaning stays off in this run, so the extension changes nothing by
// itself. Chrome's own files are read from the throwaway profile only, the SQLite ones read-only.
const filesIn = (d) => { try { return fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name)); } catch { return []; } };
const rows = (file, query) => { try { return JSON.parse(execFileSync('python3', ['-c',
  "import sqlite3,sys,json,urllib.parse as u; print(json.dumps(sqlite3.connect('file:'+u.quote(sys.argv[1])+'?mode=ro&immutable=1',uri=True).execute(sys.argv[2]).fetchall()))", file, query],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } };
const one = (file, query) => { const r = rows(file, query); return r ? r[0][0] : null; };
async function verify(offline) {
  let v;
  try { v = await start(); } catch (e) { failed++; console.log(`FAIL V. Verification run: ${e.message.split('\n')[0]}`); return; }
  const prof = path.join(v.b.dir, 'Default'), cacheDir = path.join(prof, 'Cache', 'Cache_Data'), remove = (what, types) => v.sw(`await chrome.browsingData.remove(${JSON.stringify(what)}, ${JSON.stringify(types)});`);
  const json = (f, pick) => { try { return pick(JSON.parse(fs.readFileSync(path.join(prof, f), 'utf8'))).length; } catch { return null; } };
  // The "always connect securely" (HSTS) list: its file is not written within minutes, so Chrome's own page is asked
  // whether www.iana.org, which sends the header, is on the part of the list that visits add
  let hstsPage = null;
  const sts = async () => { try { hstsPage = hstsPage || await v.tab('chrome://net-internals/#hsts');
    await hstsPage.ev(`(() => { const id = (x) => document.getElementById('hsts-view-query-' + x); id('output').textContent = ''; id('input').value = 'www.iana.org'; id('submit').click(); })()`);
    const t = await until(() => hstsPage.ev(`document.getElementById('hsts-view-query-output').innerText`), 5000);
    return !t ? null : /dynamic_sts_domain:\s*\S/.test(t) ? 1 : 0; } catch { return null; } };
  const servers = () => json('Network Persistent State', (j) => j.net.http_server_properties.servers);
  const codeFiles = () => filesIn(path.join(prof, 'Code Cache')).filter((f) => !/index/.test(f)), pageFiles = () => filesIn(cacheDir).filter((f) => !/index/.test(f));
  const icons = () => one(path.join(prof, 'Favicons'), 'select count(*) from favicons'), urls = () => one(path.join(prof, 'History'), 'select count(*) from urls');
  // Chrome writes these files a little late: wait until fn() is true, at most `ms`
  const settles = (fn, ms = 20000) => until(fn, ms, 500);
  try {
    await v.sw(`await ready;`);
    let com, org;
    if (!offline) { com = await v.tab('https://example.com/'); org = await v.tab('https://example.org/');
      for (const u of ['https://www.iana.org/', 'https://www.youtube.com/', 'https://www.youtube.com/']) { const t = await v.tab(u); await sleep(2500); await v.b.send('Target.closeTarget', { targetId: t.targetId }); } }

    await check('V1', 'One site\'s saved copies cleared alone (browsingData.remove with origins and cache)', async (ok, see) => {
      const fill = (s) => s.ev(`fetch('/?tc-verify', { cache: 'force-cache' }).then((r) => r.status, () => 0)`);
      const has = (s) => s.ev(`fetch('/?tc-verify', { cache: 'only-if-cached', mode: 'same-origin' }).then((r) => r.status, () => 0)`);
      await fill(com); await fill(org);
      const before = [await has(com), await has(org)];
      if (before.join() !== '200,200') return see(`NOT DECIDED: Chrome did not save the two test pages (answers from the saved copies: ${before.join(', ')})`);
      let err = ''; try { await remove({ origins: ['https://example.com'] }, { cache: true }); } catch (e) { err = e.message.split('\n')[0]; }
      const after = [await has(com), await has(org)];
      see(err ? `FOUND: Chrome refused the call: ${err}` : `FOUND: after clearing example.com alone, its saved copy ${after[0] === 200 ? 'is still there' : 'is gone'} and the copy of example.org ${after[1] === 200 ? 'is still there' : 'is gone too'}`
        + ` => per-site clearing ${after[0] !== 200 && after[1] === 200 ? 'works: clean possible' : 'does not work: show only'}`);
    }, offline);

    await check('V2', 'A saved copy on disk: is the site in its key, and are its headers (ETag, Last-Modified) plain text?', async (ok, see) => {
      const find = () => pageFiles().map((f) => [f, fs.readFileSync(f, 'latin1')]).find(([, t]) => t.includes('example.org/?tc-verify'));
      const hit = await settles(find);
      if (!hit) return see(`NOT DECIDED: no file under Cache_Data names the test page in plain text (${pageFiles().length} entry files looked at)`);
      const key = (/[\x20-\x7e]*example\.org\/\?tc-verify/.exec(hit[1]) || [''])[0], heads = ['HTTP/1.1 200', 'last-modified:', 'etag:', 'cache-control:', 'content-encoding:'].filter((h) => hit[1].toLowerCase().includes(h.toLowerCase()));
      const all = pageFiles().map((f) => fs.readFileSync(f, 'latin1')), etags = all.filter((t) => /\0etag:/i.test(t) || /\netag:/i.test(t) || /etag: ?["W]/i.test(t)).length;
      see(`FOUND: the key is plain text: "${key}"; plain header lines in the same file: ${heads.join(', ') || 'none'}; ${etags} of ${all.length} entry files carry a plain "etag:" line => a command can sort the saved copies by site and count validator tags`);
    }, offline);

    await check('V3', 'What a page learns from asking how much space it has (navigator.storage.estimate)', async (ok, see) => {
      const e = await com.ev(`navigator.storage.estimate().then((e) => ({ usage: e.usage, quota: e.quota }))`), disk = fs.statfsSync(v.b.dir), total = disk.blocks * disk.bsize, free = disk.bavail * disk.bsize;
      const gb = (b) => `${Math.round(b / 2 ** 30)} GB`;
      // Chrome once offered a share (60%) of the disk, which gave the disk's size away. Run this with TC_BROWSER_TMP on disks of different sizes to see whether the answer follows them.
      const share = e.quota / total, tied = share > 0.4 && share < 0.8;
      see(`FOUND: example.com is told usage ${e.usage} bytes and quota ${gb(e.quota)}; the disk under the throwaway profile is ${gb(total)} with ${gb(free)} free, so the quota is ${Math.round(100 * share)}% of the disk's size`
        + ` => ${tied ? 'it may follow the size of the disk: compare with a run on another disk' : 'it does not follow the size of this disk'}`);
    }, offline);

    await check('V4', 'How far back getMatchedRules reaches', async (ok, see) => {
      const t = await v.tab('https://example.com/'), r = await requestTracker(t), tabId = await v.sw(`return (await chrome.tabs.query({})).map((x) => x.id);`);
      const ask = () => v.sw(`try { return (await chrome.declarativeNetRequest.getMatchedRules({})).rulesMatchedInfo.map((m) => ({ tabId: m.tabId, age: Date.now() - m.timeStamp, set: m.rule.rulesetId })); } catch (e) { return String(e.message || e); }`);
      const open = await ask();
      await v.b.send('Target.closeTarget', { targetId: t.targetId }); await sleep(1500);
      const closed = await ask();
      if (!r.blocked || typeof open === 'string' || typeof closed === 'string') return see(`NOT DECIDED: ${!r.blocked ? 'the tracker request was not blocked' : `Chrome refused the question: ${typeof open === 'string' ? open : closed}`}`);
      see(`FOUND: with the tab open ${open.length} match${open.length === 1 ? '' : 'es'} (tab ids ${[...new Set(open.map((m) => m.tabId))].join(', ')} of open tabs ${tabId.join(', ')}); after closing that tab ${closed.length} left`
        + `${closed.length ? ` (tab ids ${[...new Set(closed.map((m) => m.tabId))].join(', ')})` : ''} => ${closed.length < open.length ? 'a match goes with its tab: only open tabs can be counted, nothing per day' : 'a match outlives its tab for now; Chrome documents 5 minutes, not waited for here'}`);
    }, offline);

    let iconsBefore = null, urlsBefore = null;
    await check('V5', 'Favicons: is there a browsingData type for them, and what does Chrome keep?', async (ok, see) => {
      const types = await v.sw(`return Object.keys((await chrome.browsingData.settings()).dataRemovalPermitted);`);
      iconsBefore = await settles(icons, 25000); urlsBefore = await settles(urls, 15000);
      const tables = (rows(path.join(prof, 'Favicons'), "select name from sqlite_master where type = 'table' order by 1") || []).map((r) => r[0]);
      see(`FOUND: the types an extension can clear are ${types.join(', ')}: ${types.some((t) => /icon/i.test(t)) ? 'one is for favicons' : 'none is for favicons'}; tables in the Favicons file: ${tables.join(', ') || 'not readable'}; `
        + `stored icons after the visits: ${iconsBefore ?? 'none seen within 25 s'}; addresses in the History file: ${urlsBefore ?? 'none seen'}`);
    }, offline);

    await check('V6', 'Clearing all saved copies: does it also empty the code cache, the remembered servers and the "always connect securely" list?', async (ok, see) => {
      await settles(() => servers() > 0, 75000);   // Chrome writes the list of servers up to a minute late
      const before = { pages: pageFiles().length, code: (await settles(() => codeFiles().length ? codeFiles() : null, 8000) || []).length, servers: servers(), sts: await sts() };
      await remove({ since: 0 }, { cache: true });
      await settles(() => servers() === 0 && codeFiles().length === 0 && pageFiles().length === 0, 20000);
      const after = { pages: pageFiles().length, code: codeFiles().length, servers: servers(), sts: await sts() }, went = (k) => before[k] ? `${before[k]} -> ${after[k]}` : `NOT DECIDED (${before[k] === null ? 'it could not be read' : 'there were none'} before)`;
      const listed = (n) => n === null ? 'could not be asked' : n ? 'on the list' : 'not on the list';
      see(`FOUND: saved copies of pages ${went('pages')} files; code cache ${went('code')} files; remembered servers ${went('servers')}; "always connect securely" list: www.iana.org ${listed(before.sts)} before, ${listed(after.sts)} after`);
      // the list again after each further thing an extension can clear
      const steps = [];
      for (const [name, types] of [['cookies', { cookies: true }], ['history', { history: true }]]) { const n = await sts(); await remove({ since: 0 }, types); await sleep(1000);
        if (n) steps.push(`after clearing ${name}: ${listed(await sts())}`); }
      const iconsAfter = await settles(() => icons() === 0, 15000) ? 0 : icons(), urlsAfter = urls();
      if (steps.length) see(`the list ${steps.join('; ')}`);
      see(`after clearing history: stored icons ${iconsBefore ?? 'none'} -> ${iconsAfter ?? 'not readable'}, addresses in the History file ${urlsBefore ?? 'none'} -> ${urlsAfter ?? 'not readable'}`);
    }, offline);
  } finally { await v.close(); }
}

// ---- fourth run, fresh profile: the report of 1.23 (report.html), beside the page or in a tab of its own.
// R1 and R2 report what Chrome really does for the two open questions of PLAN.md ("Todo for 1.23"): can the popup's
// button open the side panel, and is the report told when another tab comes to the front.
const portOpen = (port) => new Promise((done) => { const s = require('node:net').connect(port, '127.0.0.1'); s.on('connect', () => { s.destroy(); done(true); }); s.on('error', () => done(false)); });
async function report(offline) {
  let r;
  try { r = await start(); } catch (e) { failed++; console.log(`FAIL R. Report run: ${e.message.split('\n')[0]}`); return; }
  const { b, sw } = r, targets = async () => (await b.send('Target.getTargets')).targetInfos, isReport = (t) => t.url.startsWith(`${r.origin}/report.html`);
  const tabId = async (s) => { const u = await s.ev('location.href'); return sw(`return ((await chrome.tabs.query({})).find((t) => t.url === ${JSON.stringify(u)}) || {}).id;`); };
  let rep = null, how = '', site = null, other = null;
  // the report page, driven like the popup: R.text() is everything on it, also what is inside closed lists
  const R = { text: () => rep.ev(`document.getElementById('out').textContent`), note: () => rep.ev(`document.getElementById('note').textContent`),
    drawn: () => until(() => rep.ev(`(() => { const o = document.getElementById('out'); return !!o && o.children.length > 0 && !o.textContent.includes('Loading'); })()`), 8000),
    row: (group) => rep.ev(`(document.querySelector('[data-group="${group}"]') || {}).innerText || ''`),
    // presses the first button whose label starts so; cookie: inside the row of the cookie with that name
    click: (label, cookie) => rep.ev(`(() => { const rows = [...document.querySelectorAll('#cookies > .c')], root = ${cookie ? `rows.find((x) => x.querySelector('b').textContent === ${JSON.stringify(cookie)})` : `document.getElementById('out')`};
      const el = root && [...root.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}));
      if (!el || el.disabled) return false; el.click(); return true; })()`),
    cookieRow: (name) => rep.ev(`(([...document.querySelectorAll('#cookies > .c')].find((x) => x.querySelector('b').textContent === ${JSON.stringify(name)}) || {}).textContent) || ''`),
    again: async () => { await R.click('Read again'); await sleep(400); await R.drawn(); },
    // a real mouse click on the element the expression gives, which Chrome takes for the user's own (lists are opened so it can be seen)
    mouse: async (expr) => { const at = await rep.ev(`(() => { document.querySelectorAll('details').forEach((d) => { d.open = true; }); const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'center' });
        const q = el.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
      if (!at) return false;
      for (const type of ['mousePressed', 'mouseReleased']) await rep.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
      return true; } };
  const cookieButton = (name, label) => `[...([...document.querySelectorAll('#cookies > .c')].find((x) => x.querySelector('b').textContent === ${JSON.stringify(name)}) || document.createElement('p')).querySelectorAll('button')].find((x) => x.textContent.startsWith(${JSON.stringify(label)}))`;
  try {
    await sw(`await ready;`); await sleep(1000);
    if (!offline) { site = await r.tab('https://example.com/'); other = await r.tab('https://example.org/'); }

    await check('R1', 'Can the popup\'s button open the report beside the page (chrome.sidePanel.open)?', async (ok, see) => {
      const pop = await r.tab(`${r.origin}/popup.html`); await sleep(800);
      const has = await pop.ev(`(() => { const x = document.getElementById('report'); return !!x && x.textContent === 'Open the report beside the page'; })()`);
      if (!ok(has, 'the popup has no button "Open the report beside the page"')) return;
      // asked directly first, once without and once with what Chrome takes for a click
      const ask = async (userGesture) => { const v = await pop.send('Runtime.evaluate', { userGesture, awaitPromise: true, returnByValue: true,
        expression: `chrome.windows.getCurrent().then((w) => chrome.sidePanel.open({ windowId: w.id })).then(() => 'opened', (e) => 'refused: ' + e.message)` }); return v.result.value; };
      const plain = await ask(false), before = (await targets()).filter(isReport).length;
      // then the button itself, pressed with a real mouse click
      const at = await pop.ev(`(() => { const q = document.getElementById('report').getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; })()`);
      await b.send('Target.activateTarget', { targetId: pop.targetId }); await sleep(200);
      for (const type of ['mousePressed', 'mouseReleased']) await pop.send('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 });
      await sleep(1500);
      const all = await targets(), reports = all.filter(isReport), popGone = !all.some((t) => t.targetId === pop.targetId);
      const panel = reports.find((t) => !t.url.includes('?tab=')), tab = reports.find((t) => t.url.includes('?tab='));
      see(`FOUND: asked without a click, Chrome answered "${plain}"; after a real mouse click on the button: ${panel ? `a "${panel.type}" target on report.html appeared (the side panel)` : 'no side panel target appeared'}`
        + `${tab ? `, and the report opened in a tab instead (${tab.url.replace(r.origin, '')})` : ''}; the popup ${popGone ? 'closed itself, as it does after opening the panel' : 'stayed open'}; report targets before the click: ${before}`);
      ok(reports.length > 0 || plain === 'opened', 'the button opened neither the side panel nor a tab with the report');
      if (panel) { try { rep = await b.attach(panel.targetId, ['Runtime', 'Log', 'Page', 'Network']); how = 'the side panel'; } catch (e) { see(`the side panel target could not be driven: ${e.message.split('\n')[0]}`); } }
      if (!rep && tab) { rep = await b.attach(tab.targetId, ['Runtime', 'Log', 'Page', 'Network']); how = 'a tab opened by the button'; }
      if (!popGone) await b.send('Target.closeTarget', { targetId: pop.targetId }).catch(() => {});
    });
    // the remaining checks need the report page: if the button gave none that can be driven, it is opened as a tab
    if (!rep) { rep = await r.tab(`${r.origin}/report.html${site ? `?tab=${await tabId(site)}` : ''}`); how = 'a tab opened by this script (report.html?tab=...)'; }
    await R.drawn();
    console.log(`     the report for R2 to R9 is ${how}`);

    await check('R2', 'Is the report told when another tab comes to the front, or the tab goes to another address?', async (ok, see) => {
      const about = async () => (/This page: ([^ ]+)|This tab is not a web page/.exec(await R.text()) || [''])[0];
      const seen = [];
      for (const [t, host] of [[site, 'example.com'], [other, 'example.org'], [site, 'example.com']]) { await b.send('Target.activateTarget', { targetId: t.targetId });
        const got = await until(async () => (await about()) === `This page: ${host}` ? host : null, 5000); seen.push(`${host} to the front: ${got ? 'followed' : `not followed (still "${await about()}")`}`); ok(!!got, `the report did not follow to ${host}`); }
      await r.go(site, 'https://example.com/?page=2'); await sleep(300);
      const t0 = (/Read at (\d\d:\d\d:\d\d)/.exec(await R.text()) || [])[1]; await sleep(1100);
      await r.go(site, 'https://www.iana.org/help/example-domains');
      const moved = await until(async () => (await about()) === 'This page: www.iana.org', 8000);
      ok(moved, `after the tab went to www.iana.org the report says "${await about()}"`);
      see(`FOUND: ${seen.join('; ')}; the tab went to another site: ${moved ? 'the report was drawn again for www.iana.org' : 'not noticed'} (read at ${t0} before)`);
      await r.go(site, 'https://example.com/');
      await until(async () => (await about()) === 'This page: example.com', 8000);
    }, offline);

    await check('R3', 'Turn on from the report; the count of blocked requests moves when a tracker is blocked', async (ok, see) => {
      ok((await R.text()).includes('Cleaning is off until you turn it on.'), 'a fresh profile does not say "Cleaning is off until you turn it on."');
      ok(await R.click('Turn on'), 'no "Turn on" button'); ok(await until(async () => (await R.text()).includes('Cleaning is on'), 8000), 'the report does not say "Cleaning is on"');
      const n = async () => { const row = await R.row('blocking'); return /Chrome did not say/.test(row) ? 'Chrome did not say' : Number((/(\d+) blocked on this page/.exec(row) || [])[1]); };
      const before = await n(), t = await requestTracker(site);
      ok(t.blocked, `the tracker request was not blocked: ${t.end} ${t.why}`);
      await R.again(); const after = await n();
      ok(Number.isInteger(before) && after === before + 1, `blocked on this page: ${before} before, ${after} after one blocked request`);
      see(`"Turn on" in the report: "Cleaning is on"; "${before} blocked on this page" before, "${after} blocked on this page" after one request to google-analytics.com was blocked and "Read again"`);
    }, offline);

    const LONG = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';
    await check('R4', 'A cookie\'s value shows cut to 24 characters, and whole after "Show all of it"', async (ok, see) => {
      await setInPage(site, `tclong=${LONG}; max-age=3600`); await setInPage(site, 'tcplain=1; max-age=3600');
      await R.again();
      const row = await R.cookieRow('tclong'), all = await R.text();
      ok(row.includes(LONG.slice(0, 24) + '…'), `the row of tclong: ${row.slice(0, 160)}`); ok(!all.includes(LONG), 'the whole value is on the page before "Show all of it"');
      ok(/until \d+ [A-Z][a-z]{2} \d{4}/.test(row) && row.includes('on no tracker list, kept'), `the row does not say how long it stays and what it is: ${row.slice(0, 160)}`);
      ok(await R.click('Show all of it', 'tclong'), 'no "Show all of it" button in the row');
      const full = await until(async () => (await R.cookieRow('tclong')).includes(LONG), 4000);
      ok(full, `after the press the row says: ${(await R.cookieRow('tclong')).slice(0, 160)}`);
      const kept = await sw(`return JSON.stringify([await chrome.storage.local.get(null), await chrome.storage.session.get(null)]).includes(${JSON.stringify(LONG.slice(0, 24))});`);
      ok(kept === false, 'the value is in the extension\'s storage');
      see(`"${(/\d+ cookies? on example\.com/.exec(all) || [''])[0]}"; tclong shows "${LONG.slice(0, 24)}…" and after "Show all of it" all ${LONG.length} characters; nothing of it in storage.local or storage.session`);
    }, offline);

    await check('R5', 'The buttons work on real cookies: Copy, Delete, Keep, Always delete, and "Delete N cookies on this site"', async (ok, see) => {
      const seen = [];
      // Copy: the clipboard of a headless Chrome is allowed here first; what the page says is what counts
      await b.send('Browser.grantPermissions', { origin: r.origin, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => {});
      await b.send('Target.activateTarget', { targetId: rep.targetId }).catch(() => {});
      // pressed twice: as a script presses it, and with a real mouse click, which is what Chrome wants before it lets a page copy
      ok(await R.click('Copy what it holds', 'tclong'), 'no "Copy what it holds" button');
      const byScript = await until(async () => { const n = await R.note(); return /^Copied|^Could not copy/.test(n) ? n : null; }, 4000);
      await rep.ev(`document.getElementById('note').textContent = ''`);
      ok(await R.mouse(cookieButton('tclong', 'Copy what it holds')), 'the Copy button could not be clicked with the mouse');
      const copied = await until(async () => { const n = await R.note(); return /^Copied|^Could not copy/.test(n) ? n : null; }, 4000);
      const clip = await rep.ev(`navigator.clipboard.readText().catch((e) => 'not readable: ' + e.message)`);
      seen.push(`Copy: pressed by a script the page said "${byScript}"; after a real mouse click it said "${copied}", and the clipboard then held ${clip === LONG ? 'the whole value' : `"${String(clip).slice(0, 90)}"`}`);
      ok(!!copied && !!byScript, `Copy gave no answer: "${byScript}", "${copied}"`);
      await b.send('Target.activateTarget', { targetId: site.targetId });
      // Delete
      ok(await R.click('Delete', 'tcplain'), 'no Delete button for tcplain');
      ok(await until(async () => !(await r.cookie('tcplain', 'example.com'))), 'tcplain is still there after Delete'); seen.push('Delete: tcplain gone');
      ok(await until(async () => /Put back 1 deleted cookie/.test(await R.text()), 4000), 'the top line does not offer "Put back 1 deleted cookie"');
      // Keep: a tracker's cookie that waits (that group set to ask first, so it is still there to press on)
      await rep.ev(`chrome.runtime.sendMessage({ type: 'setMode', group: 'cookies', mode: 'ask' })`);
      await setInPage(site, '_ga=GA1.2.3; max-age=3600'); await sleep(800); await R.again();
      const waits = (/Trackers' cookies: \d+ waiting/.exec(await R.text()) || [''])[0];
      ok(!!waits && (await R.cookieRow('_ga')).includes("has a tracker's name, deleted only after you say so"), `_ga does not wait: "${waits}", row: ${(await R.cookieRow('_ga')).slice(0, 120)}`);
      ok(await R.click('Keep', '_ga'), 'no Keep button for _ga');
      ok(await until(async () => (await R.cookieRow('_ga')).includes('kept because you chose Keep'), 5000), `after Keep the row says: ${(await R.cookieRow('_ga')).slice(0, 140)}`);
      await rep.ev(`chrome.runtime.sendMessage({ type: 'setMode', group: 'cookies', mode: 'auto' })`); await sleep(800);
      ok(!!(await r.cookie('_ga', 'example.com')), '_ga was deleted although Keep was pressed'); seen.push(`Keep: "${waits}" before, then "kept because you chose Keep", and _ga survived cleaning set back to automatic`);
      // Always delete: gone now, and gone again when the site puts it back, with its group still on "asks first"
      await setInPage(site, 'tcalways=1; max-age=3600'); await R.again();
      ok(await R.click('Always delete', 'tcalways'), 'no "Always delete" button for tcalways');
      ok(await until(async () => !(await r.cookie('tcalways', 'example.com'))), 'tcalways is still there after "Always delete"');
      await setInPage(site, 'tcalways=2; max-age=3600');
      const again = await until(async () => !(await r.cookie('tcalways', 'example.com')), 6000);
      const mode = (await rep.ev(`chrome.runtime.sendMessage({ type: 'state' })`)).groups.find((g) => g.id === 'storage');
      ok(again, 'tcalways came back and was not deleted'); ok(mode.mode === 'ask' && mode.pending === 0, `its group: mode ${mode.mode}, ${mode.pending} waiting`);
      await R.again(); ok((await R.text()).includes('Always deleted on this site (1)'), 'no list "Always deleted on this site (1)"');
      seen.push(`Always delete: tcalways gone, and gone again ${again ? 'within 6 s' : 'NOT'} when the page set it anew, with its group on "asks first" and nothing waiting`);
      // Delete all: _ga stays (Keep), the rest goes
      await setInPage(site, 'tcone=1; max-age=3600'); await R.again();
      const label = await rep.ev(`([...document.querySelectorAll('button')].find((x) => /^Delete \\d+ cookies? on this site$/.test(x.textContent)) || {}).textContent || ''`);
      const stay = (/\d+ stays?: .*?(?= also the)/.exec(await R.text()) || [''])[0];
      const names = async () => (await r.cookies()).filter((c) => c.domain.replace(/^\./, '') === 'example.com').map((c) => c.name).sort();
      const had = await names();
      ok(await R.click('Delete '), 'no "Delete N cookies on this site" button');
      const left = await until(async () => { const n = await names(); return n.length === 1 ? n : null; }, 6000) || await names();
      ok(label === `Delete ${had.length - 1} cookies on this site` && left.join() === '_ga', `button "${label}", cookies before ${had.join(', ')}, after ${left.join(', ')}`);
      seen.push(`"${label}" with "${stay}" beside it: of ${had.join(', ')} only ${left.join(', ')} is left; the page said "${await R.note()}"`);
      see(seen.join('; '));
    }, offline);

    await check('R6', 'What the page has saved is counted in the tab only when asked, kind by kind', async (ok, see) => {
      await site.ev(`(async () => { localStorage.setItem('tc-uid', ${JSON.stringify(LONG)}); localStorage.setItem('tc-theme', 'dark'); sessionStorage.setItem('tc-step', '3');
        await new Promise((done, no) => { const q = indexedDB.open('tc-db'); q.onsuccess = () => { q.result.close(); done(); }; q.onerror = no; }); await caches.open('tc-cache'); return true; })()`);
      await R.again();
      ok((await R.text()).includes('Nothing on the page is looked at until you press this.'), 'the report does not wait for the press');
      ok(await R.click('Count what this page has saved'), 'no button "Count what this page has saved"');
      ok(await until(async () => (await R.text()).includes('Read from the page just now.'), 6000), `after the press: ${(await R.text()).slice(-300)}`);
      const counts = await rep.ev(`Object.fromEntries([...document.querySelectorAll('[data-kind]')].map((k) => [k.dataset.kind, k.querySelector('.h .m').textContent]))`);
      const want = { local: '2 on this page', session: '1 on this page', databases: '1 on this page', caches: '1 on this page', workers: '0 on this page' };
      for (const [k, v] of Object.entries(want)) ok(counts[k] === v, `${k}: "${counts[k]}", expected "${v}"`);
      ok(await rep.ev(`(() => { const x = document.querySelector('[data-kind="local"] button[data-msg]'); if (!x || x.textContent !== 'Show the 2') return false; x.click(); return true; })()`), 'no button "Show the 2" for local storage');
      const shown = await until(async () => { const t = await rep.ev(`(document.querySelector('[data-kind="local"]') || {}).textContent || ''`); return t.includes('tc-uid') ? t : null; }, 6000) || '';
      ok(shown.includes(`tc-uid ${LONG.slice(0, 24)}…`) && shown.includes('tc-theme dark') && !shown.includes(LONG), `the list: ${shown.slice(-160)}`);
      see(`before the press nothing is read; after it: ${Object.entries(counts).map(([k, v]) => `${k} "${v}"`).join(', ')}; "Show the 2" lists tc-uid cut to 24 characters and tc-theme`);
    }, offline);

    const torHere = await portOpen(9050);
    await check('R7', 'Tor switched on with nothing listening on port 9050: nothing is routed, and the row says so', async (ok, see) => {
      const ms = await sw(`const t = Date.now(), a = await torRuns(); return [a, Date.now() - t];`);
      ok(ms[0] === false, 'the port check says Tor is running'); ok(ms[1] < 3000, `the port check took ${ms[1]} ms`);
      await rep.ev(`chrome.runtime.sendMessage({ type: 'setMode', group: 'tor', mode: 'auto' })`); await R.again();
      const row = (await R.row('tor')).replace(/\n+/g, ' / '), proxy = await sw(`return (await chrome.proxy.settings.get({})).value.mode;`);
      ok(row.includes('Tor is not running on this computer; nothing is routed'), `the Tor row: ${row}`); ok(proxy !== 'fixed_servers', `Chrome's proxy setting is ${proxy}`);
      const loads = await site.ev(`fetch('https://example.com/?tor-check', { cache: 'no-store' }).then((x) => x.status, () => 0)`);
      ok(loads === 200, `a page request after switching Tor on ended with ${loads}`);
      await rep.ev(`chrome.runtime.sendMessage({ type: 'setMode', group: 'tor', mode: 'off' })`); await R.again();
      const off = (await R.row('tor')).replace(/\n+/g, ' / ');
      ok(off.includes('off · Routed over Tor: no'), `the Tor row after switching off: ${off}`);
      see(`FOUND: a request to http://127.0.0.1:9050/ with nothing listening failed after ${ms[1]} ms; row with Tor switched on: "${row.split(' / ')[1] || row}"; Chrome's proxy setting stayed "${proxy}" and example.com still loaded; switched off: "${off.split(' / ')[1] || off}"`);
    }, offline || (torHere && 'something is listening on port 9050 of this computer, so "not running" cannot be shown'));

    await check('R8', 'The report page and the service worker ran without errors', async (ok, see) => {
      const quiet = (l) => !l.includes('127.0.0.1:9050');   // the port check itself: Chrome prints a red line for a refused connection
      const [red] = redLines(rep), [swRed] = r.swRed(), mine = red.filter(quiet), bg = swRed.filter(quiet);
      const asked = rep.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url).filter((u) => !u.startsWith(r.origin));
      ok(!mine.length, `report page errors: ${brief(mine)}`); ok(!bg.length, `service worker errors: ${brief(bg)}`); ok(!asked.length, `the report page sent requests: ${brief(asked)}`);
      see(`${mine.length} errors on the report page, ${bg.length} in the service worker (${red.length - mine.length + swRed.length - bg.length} red lines for the refused port check not counted), no request left the report page`);
    });

    await check('R9', 'How often may the report ask Chrome what it blocked (getMatchedRules), and does a press of "Read again" still get an answer?', async (ok, see) => {
      const draws = await sw(`let n = 0; try { for (; n < 30; n++) await chrome.declarativeNetRequest.getMatchedRules({}); } catch (e) { return n + ' more answers, then "' + e.message + '"'; } return 'no limit reached in 30 more questions';`);
      await R.again(); const byScript = (await R.row('blocking')).split('\n')[1] || '';
      ok(await R.mouse(`[...document.querySelectorAll('button')].find((x) => x.textContent === 'Read again')`), 'no "Read again" button to click'); await sleep(800); await R.drawn();
      const byMouse = (await R.row('blocking')).split('\n')[1] || '';
      ok(/Chrome did not say how many it blocked; press "Read again" to ask it/.test(byScript) || /\d+ blocked on this page/.test(byScript), `the row after the limit: "${byScript}"`);
      ok(/\d+ blocked on this page/.test(byMouse), `after a real click on "Read again" the row says "${byMouse}"`);
      see(`FOUND: asked over and over from the service worker: ${draws}; the report then drawn again by a script: "${byScript}"; after a real mouse click on "Read again": "${byMouse}"`);
    }, offline);
  } finally { await r.close(); }
}
main().catch((e) => { console.log(`FAIL: the run itself broke: ${e.stack || e}`); process.exit(1); });
