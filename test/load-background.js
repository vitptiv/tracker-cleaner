// Runs background.js as the service worker would, inside a node:vm context: the chrome fake, a stub
// fetch and an importScripts that evaluates the named files into the same context. Nothing real is touched.
// const bg = await load({ limits: { chromeTabs: 1 }, storage: { master: true }, cookies: [...], tabs: [...] });
// limits undefined = the 8088 server is unreachable. bg.limits can be changed later.
// tor: what answers on Tor's port 9050: true = Tor, 'other' = some other program, nothing = no one. bg.tor can be changed later.
// dir 'extension-1.20' loads the untouched baseline, to pin what 1.20 did.
const vm = require('node:vm'), fs = require('fs'), path = require('path');
const makeChrome = require('./chrome-fake.js');

module.exports = async function load({ dir = 'extension', limits, tor, ...init } = {}) {
  const root = path.join(__dirname, '..', dir), bg = makeChrome({ manifest: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')), ...init });
  bg.limits = limits; bg.tor = tor; bg.asked = []; bg.reports = []; bg.timers = []; bg.now = 1.8e12;   // the clock: tests move bg.now
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  // the clock: Date.now() and new Date() are bg.now; new Date(t) is the real thing
  const Clock = class extends Date { constructor(...a) { super(...(a.length ? a : [bg.now])); } static now() { return bg.now; } };
  const ctx = vm.createContext({ chrome: bg.chrome, URL, console, Date: Clock, AbortSignal, crypto: globalThis.crypto, TextDecoder, Uint8Array,
    // timers never fire by themselves (1.20 batches its live report for 5 s); a test may call bg.timers[i]()
    setTimeout: (f) => bg.timers.push(f), clearTimeout: () => {},
    importScripts: (...files) => files.forEach(run),
    fetch: async (url, opt = {}) => {
      bg.asked.push(String(url));
      // Tor's own port answers a web request with a short refusal page; nothing listening = the connection is refused
      if (String(url).startsWith('http://127.0.0.1:9050')) { if (!bg.tor) throw new TypeError('Failed to fetch');
        return { ok: false, status: 501, text: async () => bg.tor === true ? 'Tor is not an HTTP Proxy\nIt appears you have configured your web browser to use Tor as an HTTP proxy.' : 'hello' }; }
      if (bg.limits === undefined) throw new TypeError('fetch failed');
      if (opt.method === 'POST') { bg.reports.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => JSON.parse(JSON.stringify(bg.limits)) };
    } });
  // listeners start async work without returning it; everything is promise-driven, so a few turns of the loop drain it
  bg.settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  bg.alarm = async (name) => { await bg.fireAlarm(name); await bg.settle(); };
  bg.setCookie = async (c) => { await bg.chrome.cookies.set(c); await bg.settle(); };
  // the user opens a page and stays: the timers started by it are run (the worker waits 3 s before it counts a page as opened)
  bg.opens = async (url) => { await bg.visit(url); await bg.settle(); for (const t of bg.timers.splice(0)) t(); await bg.settle(); };
  // what the block rules for learned hosts stop (one anchored rule per host, ids from 101000), and the press on "Block"
  bg.blocks = (url) => bg.state.dynamic.some((r) => r.id >= 101000 && r.action.type === 'block' && new RegExp(r.condition.regexFilter, 'i').test(url));
  bg.blockedHosts = () => (bg.state.storage.stopped || []).filter((h) => bg.blocks(`https://${h}/`));
  bg.block = async (site) => { const it = ((bg.state.storage.pending || {}).unknown || { items: [] }).items.find((i) => i.kind === 'tracker' && i.site === site);
    const r = it ? await bg.send({ type: 'approve', group: 'unknown', site, name: it.name }) : { ok: false }; await bg.settle(); return r; };
  bg.names = async () => (await bg.chrome.cookies.getAll({})).map((c) => c.name);
  run('background.js'); await bg.settle();
  return bg;
};
// 1.25 made four groups automatic. Tests written for "ask first" load with these modes stored, as a user who chose
// "Ask first" for them has; a test's own modes win. The defaults themselves are tested in auto-default.test.js.
const ASK = { C11: 'ask', C25: 'ask', C27: 'ask', C28: 'ask' };
module.exports.asks = (o = {}) => module.exports({ ...o, storage: { ...o.storage, modes: { ...ASK, ...(o.storage || {}).modes } } });
// 1.25, L1: a learned host is only blocked at the user's press on "Block". Tests written for what follows a block load
// with a user who presses Block on every such question as soon as it is there. That nothing is blocked without the
// press is tested in l1-ask.test.js.
module.exports.pressing = async (o) => { const bg = await module.exports(o), settle = bg.settle;
  bg.settle = async () => { await settle();
    for (let n = 0; n < 50; n++) { const it = ((bg.state.storage.pending || {}).unknown || { items: [] }).items.find((i) => i.kind === 'tracker'); if (!it) break;
      await bg.send({ type: 'approve', group: 'unknown', site: it.site, name: it.name }); await settle(); } };
  return bg; };
