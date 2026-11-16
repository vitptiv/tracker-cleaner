#!/usr/bin/env node
// The inspector: what Chrome has stored right now, read from Chrome's own files and sorted by the extension's own
// lists (extension/lists.js, core.js). It runs without the extension and changes nothing.
//   node tools/inspect.js cookies [--list] [--raw] [--json] [--profile <folder>] [--cache <folder>]
// Every block answers the same questions in the same words: what is there now, what is kept and why, what would
// be removed and why, and what cleaning costs you. --raw prints the plain command underneath instead.
// What it cannot see: your own exceptions and switches (they live inside Chrome), the open tabs, and what was
// removed earlier. Chrome writes its files a little late, so the numbers can lag the browser by half a minute.
// SQLite files are read through python3, read-only and immutable, so a running Chrome is not disturbed.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const lists = require('../extension/lists.js'), core = require('../extension/core.js')(lists);

// An error whose message is a sentence for the user; anything else is reported without its stack as well.
const plain = (sentence) => Object.assign(new Error(sentence), { plain: true });
const system = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' } });
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;   // one shell word
const num = (n) => n.toLocaleString('en-US'), count = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
// "3 (1 with a tracker's name, 2 from a tracker's site)": parts are [n, text for one, text for more], empty ones left out
const sum = (parts) => { const n = parts.reduce((a, p) => a + p[0], 0);
  return n ? `${num(n)} (${parts.filter((p) => p[0]).map(([k, one, many]) => `${num(k)} ${k === 1 ? one : many}`).join(', ')})` : 'none'; };

const OPEN = "sqlite3.connect('file:'+u.quote(sys.argv[1])+'?mode=ro&immutable=1',uri=True).execute(sys.argv[2])";
const sql = (run, file, what, query) => {
  if (!fs.existsSync(file)) throw plain(`There is no ${what} at ${file}.`);
  try { return JSON.parse(run('python3', ['-c', `import sqlite3,sys,json,urllib.parse as u; print(json.dumps(${OPEN}.fetchall()))`, file, query])); }
  catch { throw plain(`The ${what} at ${file} could not be read.`); }
};
const rawSql = (file, query) => `python3 -c "import sqlite3,sys,urllib.parse as u; [print(*r) for r in ${OPEN}]" ${q(file)} ${q(query)}`;

function cookies({ profile, run }) {
  const file = path.join(profile(), 'Cookies'), query = 'select host_key, name from cookies order by 1, 2';
  const by = { name: [], host: [], google: [], keep: [], other: [] }, sites = new Set();
  for (const [host, name] of sql(run, file, 'cookie file', query)) { const site = core.realHost(host); sites.add(site);
    by[core.reason({ domain: host, name }) || (lists.KEEP_RE.test(name) ? 'keep' : 'other')].push(`${site}  ${name}`); }
  const n = (k) => by[k].length;
  return { now: `${count(n('name') + n('host') + n('google') + n('keep') + n('other'), 'cookie')} from ${count(sites.size, 'site')}`,
    kept: sum([[n('keep'), 'that keeps you signed in', 'that keep you signed in'], [n('other'), 'that is on no tracker list', 'that are on no tracker list']]),
    remove: sum([[n('name'), "with a tracker's name", "with a tracker's name"], [n('host'), "from a tracker's site", "from trackers' sites"],
      [n('google'), 'that Google uses to recognise you', 'that Google uses to recognise you']]),
    after: "Trackers recognise you less from one site to the next, and you stay signed in. Without Google's cookies you may be asked to prove you are human more often.",
    lists: [["Would be removed: has a tracker's name", by.name], ["Would be removed: comes from a tracker's site", by.host], ['Would be removed: Google uses it to recognise you', by.google],
      ['Kept: keeps you signed in', by.keep], ['Kept: on no tracker list', by.other]], raw: rawSql(file, query) };
}


// ---- Folders: the saved copies of pages, and of their scripts. Sizes are those of the files themselves.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (t) => { const d = new Date(t); return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
const size = (b) => { let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return i ? `${b < 10 ? b.toFixed(1) : Math.round(b)} ${' KMGT'[i]}B` : count(b, 'byte'); };
const folder = (dir) => {
  if (!fs.existsSync(dir)) throw plain(`There is no cache folder at ${dir}.`);
  const t = { bytes: 0, files: 0, oldest: Infinity };
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) { if (!e.isFile()) continue;
    try { const s = fs.statSync(path.join(e.parentPath, e.name)); t.bytes += s.size; t.files++; t.oldest = Math.min(t.oldest, s.mtimeMs); } catch {} }   // Chrome may delete a file meanwhile
  return { ...t, text: `${size(t.bytes)} in ${count(t.files, 'file')}`, raw: `find ${q(dir)} -type f -printf '%s %TF\\n' | sort -k2 | awk '{ bytes += $1 } NR == 1 { oldest = $2 } END { print bytes " bytes in " NR " files, oldest " oldest }'` };
};
function cache({ cache }) {
  const f = folder(path.join(cache(), 'Cache'));
  return { now: f.text + (f.files ? `, the oldest from ${day(f.oldest)}` : ''), kept: 'none (the copies are cleared all together, not site by site)',
    remove: f.files ? 'all of it, at most once a day' : 'none', after: 'Pages load a little slower until Chrome has saved them again. You stay signed in.', lists: [], raw: f.raw };
}
function codeCache({ cache }) {
  const f = folder(path.join(cache(), 'Code Cache'));
  return { now: f.text, kept: 'none (it is emptied together with the saved copies of pages)', remove: f.files ? 'all of it, together with the saved copies of pages' : 'none',
    after: 'Pages start a little slower the first time. Websites cannot read these files, so little is gained.', lists: [], raw: f.raw };
}

// ---- Chrome's JSON files
const json = (file, what) => {
  if (!fs.existsSync(file)) throw plain(`There is no ${what} at ${file}.`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw plain(`The ${what} at ${file} could not be read.`); }
};
const hostOf = (url) => { try { return new URL(url).hostname || url; } catch { return url; } };
const trackers = (n) => `${n ? num(n) : 'none'} of them ${n > 1 ? "trackers'" : "a tracker's"}`;
function servers({ profile }) {
  const file = path.join(profile(), 'Network Persistent State'), sts = path.join(profile(), 'TransportSecurity');
  const all = (((json(file, 'list of remembered servers').net || {}).http_server_properties || {}).servers || []).map((s) => hostOf(s.server));
  const bad = [...new Set(all.filter(core.isTrackerHost))].sort(), secure = fs.existsSync(sts) ? (json(sts, 'list of secure sites').sts || []).length : 0;
  return { now: `${count(all.length, 'remembered server')}, ${trackers(bad.length)}; ${count(secure, 'site')} on the "always connect securely" list`,
    kept: 'none (both lists are emptied together with the saved copies of pages)',
    remove: all.length || secure ? `all ${count(all.length, 'remembered server')} and what visits added to the "always connect securely" list, together with the saved copies of pages` : 'none',
    after: 'The first visit to each site connects a little slower. A site that asked Chrome to always connect securely is remembered again at its next visit.', lists: [['Remembered servers of trackers', bad]],
    raw: `jq '.net.http_server_properties.servers | length' ${q(file)}` };
}
// Chrome keeps much more under "exceptions" (how often you visit a site, and so on): a permission is an entry whose
// setting is a plain number, 1 = allowed, 2 = blocked.
function permissions({ profile }) {
  const file = path.join(profile(), 'Preferences'), by = { allowed: [], tracker: [], blocked: [] }, sites = new Set();
  const all = ((json(file, 'settings file').profile || {}).content_settings || {}).exceptions || {};
  for (const [kind, entries] of Object.entries(all)) for (const [pattern, e] of Object.entries(entries && typeof entries === 'object' ? entries : {})) {
    if (!e || typeof e.setting !== 'number') continue;
    const site = hostOf(pattern.split(',')[0]); sites.add(site);
    by[e.setting !== 1 ? 'blocked' : core.isTrackerHost(site) ? 'tracker' : 'allowed'].push(`${site}  ${kind.replace(/_/g, ' ')}`); }
  const n = by.allowed.length + by.tracker.length, t = by.tracker.length;
  return { now: `${count(n + by.blocked.length, 'permission')} on ${count(sites.size, 'site')}: ${num(n)} allowed, ${num(by.blocked.length)} blocked`,
    kept: 'all of them, unless you put one on your always-block list',
    remove: 'none by itself' + (t ? `; ${num(t)} of the allowed ones ${t > 1 ? "are for trackers' sites" : "is for a tracker's site"}` : ''),
    after: 'The site can no longer do that thing, and cannot ask you for it again.',
    lists: [["Allowed, for a tracker's site", by.tracker.sort()], ['Allowed', by.allowed.sort()], ['Blocked', by.blocked.sort()]],
    raw: `jq '.profile.content_settings.exceptions | map_values(select(type == "object") | map_values(select(type == "object") | .setting | select(type == "number"))) | map_values(select(. != {}))' ${q(file)}` };
}

// ---- Site storage. Chrome's own list says which sites keep anything; the IndexedDB folder says which of them have a
// database. Plain storage (localStorage) and background scripts (service workers) are in compressed files: not told apart.
// The companies behind "prove you are human" checks. Not in security/trackers.js yet: the extension has no use for it so far.
const CAPTCHA = ['recaptcha.net', 'hcaptcha.com', 'challenges.cloudflare.com', 'arkoselabs.com', 'funcaptcha.com', 'datadome.co', 'captcha-delivery.com', 'perimeterx.net', 'px-cdn.net', 'px-cloud.net'];
const isCaptcha = (h) => CAPTCHA.some((d) => h === d || h.endsWith('.' + d));
function storage({ profile, run }) {
  const file = path.join(profile(), 'WebStorage', 'QuotaManager'), idb = path.join(profile(), 'IndexedDB'), query = "select distinct host from buckets where storage_key like 'http%' order by 1";
  const db = new Set((fs.existsSync(idb) ? fs.readdirSync(idb) : []).map((f) => (/^https?_(.+)_\d+\.indexeddb\.leveldb$/.exec(f) || [])[1]).filter(Boolean));
  const sites = [...new Set([...sql(run, file, 'list of site storage', query).map(([h]) => h), ...db])].sort();
  const row = (h) => `${h}  ${db.has(h) ? 'database' : 'other storage'}`, bad = sites.filter(core.isTrackerHost), human = sites.filter((h) => !core.isTrackerHost(h) && isCaptcha(h));
  const rest = sites.filter((h) => !bad.includes(h) && !human.includes(h));
  return { now: `${count(sites.length, 'site keeps', 'sites keep')} data here, ${db.size ? num(db.size) : 'none'} of them in a database (IndexedDB)`,
    kept: sum([[rest.length, 'that is on no tracker list', 'that are on no tracker list']]),
    remove: sum([[bad.length, "tracker's site", "trackers' sites"], [human.length, '"prove you are human" check', '"prove you are human" checks']]),
    after: 'Those sites forget what they stored about you. Without the data of a "prove you are human" check you will be asked to prove you are human more often.',
    lists: [["Would be removed: a tracker's site", bad.map(row)], ['Would be removed: a "prove you are human" check', human.map(row)], ['Kept: on no tracker list', rest.map(row)]],
    raw: `${rawSql(file, query)}; ls ${q(idb)}` };
}

// ---- Tor. Two questions to check.torproject.org, one directly and one through Tor's local door (port 9050). That
// proves the Tor service, not that Chrome uses it: only Chrome can tell, so the extension's own page asks from inside.
// What the internet provider sees is put together from two read-only answers of this computer: whether site-name
// lookups are encrypted (resolvectl status) and whether a VPN or tunnel is up (ip -br addr). Addresses are shortened.
const TOR_CHECK = 'https://check.torproject.org/api/ip', CURL = ['-s', '--max-time', '15'], VIA_TOR = ['--socks5-hostname', '127.0.0.1:9050'];
const mask = (ip) => ip.includes(':') ? ip.split(':').slice(0, 2).join(':') + ':x:x' : ip.split('.').slice(0, 2).join('.') + '.x.x';
const provider = (run, running, full) => {
  const out = (cmd, args) => { try { return run(cmd, args); } catch { return null; } }, dns = out('resolvectl', ['status']);
  const vpn = (out('ip', ['-br', 'addr']) || '').split('\n').map((l) => l.trim().split(/\s+/)).find(([name, state]) => /^(tun\d|ppp\d|wg|tailscale)/.test(name) && state && state !== 'DOWN');
  const to = (/DNS Servers?: *(\S+)/.exec(dns || '') || [])[1], goes = to ? `; they go to ${full ? to : mask(to)}.` : '.';
  const rest = vpn ? `only that you use a VPN or tunnel (${vpn[0]}), as long as your browsing goes through it. The VPN's company then sees the site names and servers instead.`
    : dns === null ? 'the name of every site you open, and which servers you connect to. Whether site-name lookups (DNS) are encrypted could not be checked.'
    : /\+DNSOverTLS|DNSOverTLS setting: (yes|opportunistic)/.test(dns) ? `which servers you connect to, and from that usually which sites. Site-name lookups (DNS) are encrypted${goes}`
    : `the name of every site you open, and which servers you connect to. Site-name lookups (DNS) are not encrypted${goes}`;
  return running ? `for what goes through Tor, only that you use Tor: not the sites, not the servers. For everything else: ${rest}` : rest;
};
function tor({ run, full }) {
  const ask = (via) => { try { const a = JSON.parse(run('curl', [...CURL, ...via, TOR_CHECK])); return typeof a.IP === 'string' ? a : null; } catch { return null; } };
  const direct = ask([]), through = ask(VIA_TOR), running = !!through && through.IsTor === true;
  const own = direct ? `your own address, ${full ? direct.IP : mask(direct.IP)}` : '';
  return { now: running ? `Tor is running on this computer. What goes through it is seen as Tor's address, ${through.IP}${own ? `, not ${own}` : ''}.`
      : `Tor is not installed or not running. ${direct ? `Websites see ${own}.` : 'Your own address could not be checked: there was no answer from check.torproject.org.'}`,
    provider: provider(run, running, full),
    after: 'Nothing is cleaned here. With Tor switched on, pages load slower and you are asked to prove you are human more often.',
    note: "This command can only check the Tor service on this computer; whether Chrome itself uses Tor is checked on the extension's own page.", lists: [],
    raw: `curl ${CURL.join(' ')} ${TOR_CHECK}; echo; curl ${[...CURL, ...VIA_TOR].join(' ')} ${TOR_CHECK}; echo; resolvectl status; ip -br addr` };
}

// ---- Wi-Fi: the helper's own reading of nmcli (wifi-helper/wifi.js), listing only.
const wifiHelper = require('../wifi-helper/wifi.js');
function wifi({ run, now }) {
  let all; try { all = wifiHelper.list(run); } catch { throw plain('This computer did not answer the question about its Wi-Fi networks (the program nmcli is missing or not running).'); }
  const go = wifiHelper.candidates(all, now), stale = go.filter((c) => c.lastUsed !== 0).length, kept = all.filter((c) => !go.some((x) => x.uuid === c.uuid));
  const why = (c) => c.active ? 'in use now' : c.lastUsed === null ? 'last use cannot be read' : 'used in the last 30 days', n = (w) => kept.filter((c) => why(c) === w).length;
  const rows = (list, text) => list.map((c) => `${c.name}  ${text(c)}`).sort();
  return { now: all.length ? count(all.length, 'remembered network') : 'no remembered networks',
    kept: sum([[n('in use now'), 'in use now', 'in use now'], [n('used in the last 30 days'), 'used in the last 30 days', 'used in the last 30 days'], [n('last use cannot be read'), 'whose last use cannot be read', 'whose last use cannot be read']]),
    remove: sum([[stale, 'not used for 30 days or more', 'not used for 30 days or more'], [go.length - stale, 'never used', 'never used']]) + (go.length ? '; you are always asked first' : ''),
    after: 'This computer forgets those networks and their passwords. To use one again you type its password again.',
    lists: [['Would be removed', rows(go, (c) => c.reason)], ['Kept', rows(kept, why)]], raw: `nmcli -t -f ${wifiHelper.FIELDS} connection show` };
}

const BLOCKS = {
  cookies: ['Small files sites leave to recognise you (cookies)', cookies],
  cache: ['Saved copies of pages (HTTP cache)', cache],
  'code-cache': ['Ready-made copies of page scripts (code cache)', codeCache],
  storage: ['Data that sites keep in your browser (site storage)', storage],
  servers: ['Servers Chrome remembers how to reach (remembered servers)', servers],
  permissions: ['What sites may do, such as send notifications or use the camera (site permissions)', permissions],
  tor: ['Hiding your address from websites (Tor)', tor],
  wifi: ['Remembered Wi-Fi networks', wifi],
};
const usage = () => ['Usage: node tools/inspect.js <what> [--list] [--raw] [--json] [--full] [--profile <folder>] [--cache <folder>]',
  'Shows what Chrome has stored right now, read from its own files. Nothing is changed.', '',
  ...Object.entries(BLOCKS).map(([name, [title]]) => `  ${name.padEnd(13)}${title}`), '',
  '  --list       also name each one', '  --raw        print the plain command underneath, to run yourself', '  --json       the same answers as data',
  '  --full       show internet addresses whole (tor)',
  'Without --profile it looks at the Chrome profile that has Tracker Cleaner loaded.'].join('\n');

// The profile that has this copy of the extension loaded: Chrome records the folder of an unpacked extension.
const findProfile = (home) => {
  const root = path.join(home, '.config', 'google-chrome'), ext = path.join(__dirname, '..', 'extension');
  for (const d of fs.existsSync(root) ? fs.readdirSync(root).sort() : []) {
    try { if (Object.values(JSON.parse(fs.readFileSync(path.join(root, d, 'Preferences'), 'utf8')).extensions.settings).some((e) => e.path === ext)) return path.join(root, d); } catch {}
  }
  throw plain('Could not find a Chrome profile that has Tracker Cleaner loaded. Name the profile folder with --profile <folder>.');
};

// run(cmd, args) -> what it printed, now, print and home are passed in so the tests need no system and no real profile.
function main(argv, { run = system, now = Date.now(), print = console.log, home = os.homedir() } = {}) {
  const flag = (f) => argv.includes(f), value = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const block = Object.hasOwn(BLOCKS, argv[0]) && BLOCKS[argv[0]];
  if (!block) { print(usage()); return 2; }
  let found;
  const profile = () => found || (found = value('--profile') || findProfile(home));
  const cache = () => value('--cache') || path.join(home, '.cache', 'google-chrome', path.basename(profile()));
  let r;
  try { r = { title: block[0], ...block[1]({ profile, cache, run, now, full: flag('--full') }) }; }
  catch (e) { print(e.plain ? e.message : `That did not work: ${String(e.message).split('\n')[0]}`); return 1; }
  if (flag('--raw')) { print(r.raw); return 0; }
  if (flag('--json')) { print(JSON.stringify(r, null, 1)); return 0; }
  const shown = r.lists.filter(([, rows]) => rows.length);
  print([r.title, `  There now:         ${r.now}`, ...(r.kept ? [`  Kept:              ${r.kept}`, `  Would be removed:  ${r.remove}`] : []), ...(r.provider ? [`  Your internet provider can see: ${r.provider}`] : []),
    `  What happens if you clean this: ${r.after}`, ...(r.note ? [`  ${r.note}`] : []),
    ...(!shown.length ? [] : !flag('--list') ? ['  Add --list to see which ones.'] : shown.flatMap(([heading, rows]) => [`  ${heading} (${num(rows.length)})`, ...rows.map((x) => `    ${x}`)]))].join('\n'));
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { main, BLOCKS };
