// The inspector command (tools/inspect.js) on the fixture profile of test/fixtures/build.js. No test reads the
// user's real profile: every call names --profile and --cache, and curl is a fake.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const { spawnSync, execSync } = require('node:child_process');
const fx = require('./fixtures/build.js'), { main } = require('../tools/inspect.js');
const TOOL = path.join(__dirname, '..', 'tools', 'inspect.js');
test.before(() => fx.build());
// the command as the user runs it: [exit code, what it printed, what it printed as errors]
const cli = (...args) => { const r = spawnSync('node', [TOOL, ...args, '--profile', fx.DIR, '--cache', fx.CACHE], { encoding: 'utf8' }); return [r.status, r.stdout, r.stderr]; };
// the same in this process, for the blocks that need a fake runner
const call = (args, deps = {}) => { const out = []; const code = main([...args, '--profile', fx.DIR, '--cache', fx.CACHE], { print: (s) => out.push(s), ...deps }); return [code, out.join('\n')]; };
// a printed command, run as the user would paste it; curl, resolvectl and ip resolve to the fakes in the fixture
const paste = (cmd) => execSync(cmd, { encoding: 'utf8', env: { ...process.env, PATH: fx.BIN + ':' + process.env.PATH } });

test('cookies: each cookie lands in the right line with the right reason, and the totals add up', () => {
  const [code, out] = cli('cookies');
  assert.equal(code, 0);
  assert.equal(out, [
    'Small files sites leave to recognise you (cookies)',
    '  There now:         5 cookies from 3 sites',
    "  Kept:              2 (1 that keeps you signed in, 1 that is on no tracker list)",
    "  Would be removed:  3 (1 with a tracker's name, 1 from a tracker's site, 1 that Google uses to recognise you)",
    '  What happens if you clean this: Trackers recognise you less from one site to the next, and you stay signed in. Without Google\'s cookies you may be asked to prove you are human more often.',
    '  Add --list to see which ones.', ''].join('\n'));
});
test('cookies --list: every cookie under its reason, by site and name', () => {
  const [code, out] = cli('cookies', '--list');
  assert.equal(code, 0);
  const lines = out.split('\n'), under = (heading) => { const rows = [];
    for (let i = lines.indexOf('  ' + heading) + 1; i > 0 && /^    /.test(lines[i] || ''); i++) rows.push(lines[i].trim());
    return rows; };
  assert.deepEqual(under("Would be removed: has a tracker's name (1)"), ['example.com  _ga']);
  assert.deepEqual(under("Would be removed: comes from a tracker's site (1)"), ['doubleclick.net  id']);
  assert.deepEqual(under('Would be removed: Google uses it to recognise you (1)'), ['google.com  NID']);
  assert.deepEqual(under('Kept: keeps you signed in (1)'), ['google.com  SID']);
  assert.deepEqual(under('Kept: on no tracker list (1)'), ['example.com  session']);
  assert.equal(out.includes('Add --list'), false);
});
test('cookies: no value is ever printed, in any form of the output', () => {
  assert.ok(fs.readFileSync(path.join(fx.DIR, 'Cookies')).includes(fx.MARK), 'the fixture holds the marker');
  for (const flags of [[], ['--list'], ['--json'], ['--raw']]) { const [code, out, err] = cli('cookies', ...flags);
    assert.equal(code, 0, flags.join()); assert.equal((out + err).includes(fx.MARK), false, flags.join()); }
});
test('cookies --json: the same answers as data', () => {
  const j = JSON.parse(cli('cookies', '--json')[1]);
  assert.equal(j.now, '5 cookies from 3 sites');
  assert.deepEqual(j.lists.map(([h, rows]) => rows.length), [1, 1, 1, 1, 1]);
});
test('cookies --raw: one command that runs as printed and returns the same site and name pairs', () => {
  const [code, raw] = cli('cookies', '--raw');
  assert.equal(code, 0); assert.equal(raw.trim().split('\n').length, 1);
  assert.ok(raw.startsWith('python3 -c ') && raw.includes('mode=ro&immutable=1'), raw);
  assert.deepEqual(paste(raw).trim().split('\n').sort(), fx.COOKIES.map(([h, n]) => `${h} ${n}`).sort());
});
test('cookies: a missing or unreadable file gives one plain sentence, exit code 1, no stack trace', () => {
  const bad = path.join(fx.DIR, 'broken'); fs.mkdirSync(bad, { recursive: true }); fs.writeFileSync(path.join(bad, 'Cookies'), 'this is not a database');
  const run = (dir) => { const r = spawnSync('node', [TOOL, 'cookies', '--profile', dir], { encoding: 'utf8' }); return [r.status, r.stdout + r.stderr]; };
  assert.deepEqual(run(path.join(fx.DIR, 'nowhere')), [1, `There is no cookie file at ${path.join(fx.DIR, 'nowhere', 'Cookies')}.\n`]);
  assert.deepEqual(run(bad), [1, `The cookie file at ${path.join(bad, 'Cookies')} could not be read.\n`]);
});
test('without --profile: the profile that has this extension loaded is found; none found is one plain sentence', () => {
  const run = (home) => { const out = []; return [main(['cookies'], { home, print: (s) => out.push(s) }), out.join('\n')]; };
  const [code, out] = run(fx.HOME);
  assert.equal(code, 0); assert.ok(out.includes('There now:         5 cookies from 3 sites'), out);
  assert.deepEqual(run(path.join(fx.DIR, 'nowhere')), [1, 'Could not find a Chrome profile that has Tracker Cleaner loaded. Name the profile folder with --profile <folder>.']);
});
test('no block, or an unknown one: says what can be asked, in plain words, exit code 2', () => {
  for (const args of [[], ['nonsense']]) { const [code, out] = call(args);
    assert.equal(code, 2); assert.ok(out.startsWith('Usage: node tools/inspect.js <what> [--list] [--raw] [--json]'), out);
    assert.ok(out.includes('  cookies      Small files sites leave to recognise you (cookies)'), out); assert.equal(/\b[BCT]\d\d?\b/.test(out), false); }
});

// ---- the other blocks
const lines = (out) => out.split('\n'), listed = (out, heading) => { const l = lines(out), rows = [];
  for (let i = l.indexOf('  ' + heading) + 1; i > 0 && /^    /.test(l[i] || ''); i++) rows.push(l[i].trim());
  return rows; };
test('cache: size, file count and oldest entry match the fixture', () => {
  const [code, out] = call(['cache']);
  assert.equal(code, 0);
  assert.equal(out, [
    'Saved copies of pages (HTTP cache)',
    '  There now:         7.0 KB in 3 files, the oldest from 1 Oct 2026',
    '  Kept:              none (the copies are cleared all together, not site by site)',
    '  Would be removed:  all of it, at most once a day',
    '  What happens if you clean this: Pages load a little slower until Chrome has saved them again. You stay signed in.'].join('\n'));
  assert.equal(paste(call(['cache', '--raw'])[1]), '7168 bytes in 3 files, oldest 2026-10-01\n');
});
test('code cache: size and file count, and that it goes together with the saved copies of pages (seen in a real Chrome)', () => {
  const [code, out] = call(['code-cache']);
  assert.equal(code, 0);
  assert.equal(out, [
    'Ready-made copies of page scripts (code cache)',
    '  There now:         2.0 KB in 2 files',
    '  Kept:              none (it is emptied together with the saved copies of pages)',
    '  Would be removed:  all of it, together with the saved copies of pages',
    '  What happens if you clean this: Pages start a little slower the first time. Websites cannot read these files, so little is gained.'].join('\n'));
  assert.equal(paste(call(['code-cache', '--raw'])[1]), '2048 bytes in 2 files, oldest 2026-11-02\n');
});
test('a cache folder that is not there: one plain sentence, exit code 1', () => {
  const out = [], gone = path.join(fx.DIR, 'nowhere');
  assert.equal(main(['cache', '--profile', fx.DIR, '--cache', gone], { print: (s) => out.push(s) }), 1);
  assert.deepEqual(out, [`There is no cache folder at ${path.join(gone, 'Cache')}.`]);
});
test('servers: the counts match the JSON, trackers among them are counted and listed', () => {
  const [code, out] = call(['servers', '--list']);
  assert.equal(code, 0);
  assert.equal(out, [
    'Servers Chrome remembers how to reach (remembered servers)',
    '  There now:         3 remembered servers, 1 of them a tracker\'s; 2 sites on the "always connect securely" list',
    '  Kept:              none (both lists are emptied together with the saved copies of pages)',
    '  Would be removed:  all 3 remembered servers and what visits added to the "always connect securely" list, together with the saved copies of pages',
    '  What happens if you clean this: The first visit to each site connects a little slower. A site that asked Chrome to always connect securely is remembered again at its next visit.',
    '  Remembered servers of trackers (1)',
    '    www.google-analytics.com'].join('\n'));
  assert.equal(paste(call(['servers', '--raw'])[1]).trim(), '3');
});
test('permissions: the counts match the JSON; engagement scores and the like are not permissions', () => {
  const [code, out] = call(['permissions', '--list']);
  assert.equal(code, 0);
  assert.deepEqual(lines(out).slice(0, 5), [
    'What sites may do, such as send notifications or use the camera (site permissions)',
    '  There now:         4 permissions on 4 sites: 3 allowed, 1 blocked',
    '  Kept:              all of them, unless you put one on your always-block list',
    "  Would be removed:  none by itself; 1 of the allowed ones is for a tracker's site",
    '  What happens if you clean this: The site can no longer do that thing, and cannot ask you for it again.']);
  assert.deepEqual(listed(out, "Allowed, for a tracker's site (1)"), ['ads.doubleclick.net  notifications']);
  assert.deepEqual(listed(out, 'Allowed (2)'), ['maps.example  geolocation', 'news.example  notifications']);
  assert.deepEqual(listed(out, 'Blocked (1)'), ['shop.example  notifications']);
  assert.deepEqual(JSON.parse(paste(call(['permissions', '--raw'])[1])), { geolocation: { 'https://maps.example:443,*': 1 },
    notifications: { 'https://news.example:443,*': 1, 'https://ads.doubleclick.net:443,*': 1, 'https://shop.example:443,*': 2 } });
});
test('storage: sites and kinds match; trackers and "prove you are human" checks are named apart', () => {
  const [code, out] = call(['storage', '--list']);
  assert.equal(code, 0);
  assert.deepEqual(lines(out).slice(0, 5), [
    'Data that sites keep in your browser (site storage)',
    '  There now:         4 sites keep data here, 2 of them in a database (IndexedDB)',
    '  Kept:              2 (2 that are on no tracker list)',
    '  Would be removed:  2 (1 tracker\'s site, 1 "prove you are human" check)',
    '  What happens if you clean this: Those sites forget what they stored about you. Without the data of a "prove you are human" check you will be asked to prove you are human more often.']);
  assert.deepEqual(listed(out, "Would be removed: a tracker's site (1)"), ['mixpanel.com  other storage']);
  assert.deepEqual(listed(out, 'Would be removed: a "prove you are human" check (1)'), ['hcaptcha.com  database']);
  assert.deepEqual(listed(out, 'Kept: on no tracker list (2)'), ['app.example  database', 'news.example  other storage']);
  assert.deepEqual(paste(call(['storage', '--raw'])[1]).trim().split('\n'), ['app.example', 'hcaptcha.com', 'mixpanel.com', 'news.example',
    'https_app.example_0.indexeddb.leveldb', 'https_hcaptcha.com_0.indexeddb.leveldb']);
});

// Tor: a fake runner. direct / tor = what check.torproject.org answers on each path, null = no answer; dns and ip =
// what `resolvectl status` and `ip -br addr` print, null = the program is missing
const TITLE = 'Hiding your address from websites (Tor)', COST = '  What happens if you clean this: Nothing is cleaned here. With Tor switched on, pages load slower and you are asked to prove you are human more often.';
const ONLY = '  This command can only check the Tor service on this computer; whether Chrome itself uses Tor is checked on the extension\'s own page.';
const DNS = (tls, server = '192.0.2.53') => `Global\n         Protocols: -LLMNR -mDNS ${tls}DNSOverTLS DNSSEC=no/unsupported\n\nLink 2 (enp4s0)\n    Current Scopes: DNS\nCurrent DNS Server: ${server}\n       DNS Servers: ${server}\n`;
const IP = (...more) => ['lo               UNKNOWN        127.0.0.1/8 ::1/128', 'enp4s0           UP             198.51.100.7/24', 'wlo1             DOWN', ...more, ''].join('\n');
const net = ({ direct = { IsTor: false, IP: '203.0.113.57' }, tor = null, dns = DNS('-'), ip = IP() } = {}) => (cmd, args) => {
  const line = [cmd, ...args].join(' '), a = cmd !== 'curl' ? (line === 'resolvectl status' ? dns : line === 'ip -br addr' ? ip : assert.fail(line)) : args.includes('--socks5-hostname') ? tor : direct;
  if (cmd === 'curl') assert.equal(args.at(-1), 'https://check.torproject.org/api/ip');
  if (!a) throw new Error(`${cmd}: no answer`); return typeof a === 'string' ? a : JSON.stringify(a); };
const EXIT = { IsTor: true, IP: '185.220.101.4' };
const tor = (deps, ...args) => { const out = []; return [main(['tor', ...args], { print: (s) => out.push(s), ...deps }), out.join('\n')]; };
// the block's lines by their label; the first, the cost and the closing sentence are always the same
const says = (run, ...args) => { const [code, out] = tor({ run }, ...args), l = lines(out);
  assert.equal(code, 0); assert.deepEqual([l[0], l[3], l[4], l.length], [TITLE, COST, ONLY, 5]); return [l[1], l[2]]; };
const NOW = '  There now:         ', ISP = '  Your internet provider can see: ';
const OPEN = 'the name of every site you open, and which servers you connect to. Site-name lookups (DNS) are not encrypted; they go to 192.0.x.x.';
test('tor: not running and running each have their own sentence; it needs no profile and does not guess what Chrome does', () => {
  const home = path.join(fx.DIR, 'nowhere');   // no Chrome profile there: the Tor check must not look for one
  assert.equal(says(net(), '--profile', home)[0], NOW + 'Tor is not installed or not running. Websites see your own address, 203.0.x.x.');
  assert.equal(says(net({ tor: EXIT }))[0], NOW + "Tor is running on this computer. What goes through it is seen as Tor's address, 185.220.101.4, not your own address, 203.0.x.x.");
  assert.equal(says(net({ direct: null }))[0], NOW + 'Tor is not installed or not running. Your own address could not be checked: there was no answer from check.torproject.org.');
  assert.equal(says(net({ direct: null, tor: EXIT }))[0], NOW + "Tor is running on this computer. What goes through it is seen as Tor's address, 185.220.101.4.");
  assert.equal(fs.readFileSync(TOOL, 'utf8').includes('preferences'), false, 'Chrome\'s settings file is not read for a proxy');
});
test('tor: what your internet provider can see, with no protection, with a VPN up, and with Tor working', () => {
  assert.equal(says(net())[1], ISP + OPEN);
  const vpn = "only that you use a VPN or tunnel (wg0), as long as your browsing goes through it. The VPN's company then sees the site names and servers instead.";
  assert.equal(says(net({ ip: IP('wg0              UNKNOWN        10.8.0.2/24') }))[1], ISP + vpn);
  assert.equal(says(net({ tor: EXIT }))[1], ISP + 'for what goes through Tor, only that you use Tor: not the sites, not the servers. For everything else: ' + OPEN);
  assert.equal(says(net({ tor: EXIT, ip: IP('tun0             UP             10.8.0.2/24') }))[1].endsWith('For everything else: ' + vpn.replace('wg0', 'tun0')), true);
});
test('tor: encrypted lookups, a tunnel that is down, and a computer that does not answer are told apart', () => {
  const hidden = 'which servers you connect to, and from that usually which sites. Site-name lookups (DNS) are encrypted; they go to 192.0.x.x.';
  assert.equal(says(net({ dns: DNS('+') }))[1], ISP + hidden);
  assert.equal(says(net({ dns: 'Global\n  DNSOverTLS setting: opportunistic\n  DNS Servers: 192.0.2.53\n' }))[1], ISP + hidden);   // older systemd
  for (const name of ['tailscale0', 'ppp0', 'tun3', 'wg-home']) assert.ok(says(net({ ip: IP(`${name}  UNKNOWN  10.8.0.2/24`) }))[1].includes(`VPN or tunnel (${name})`), name);
  for (const other of ['wg0              DOWN', 'docker0          UP             172.17.0.1/16', 'tunnel-like      UP']) assert.equal(says(net({ ip: IP(other) }))[1], ISP + OPEN, other);
  assert.equal(says(net({ dns: null, ip: null }))[1], ISP + 'the name of every site you open, and which servers you connect to. Whether site-name lookups (DNS) are encrypted could not be checked.');
});
test('tor: your own address and the resolver\'s are masked unless --full; --raw is the plain check and runs', () => {
  for (const run of [net(), net({ tor: EXIT })]) { const short = tor({ run })[1], whole = tor({ run }, '--full')[1];
    for (const a of ['203.0.113.57', '192.0.2.53']) { assert.equal(short.includes(a), false, a); assert.ok(whole.includes(a), a); } }
  assert.ok(tor({ run: net({ direct: { IsTor: false, IP: '2001:db8:85a3::8a2e:370:7334' } }) })[1].includes('your own address, 2001:db8:x:x.'));
  assert.ok(tor({ run: net({ dns: DNS('-', '2001:db8::53') }) })[1].includes('they go to 2001:db8:x:x.'));
  const raw = tor({ run: net() }, '--raw')[1];
  assert.equal(raw, 'curl -s --max-time 15 https://check.torproject.org/api/ip; echo; curl -s --max-time 15 --socks5-hostname 127.0.0.1:9050 https://check.torproject.org/api/ip; echo; resolvectl status; ip -br addr');
  const pasted = paste(raw);   // the fake curl, resolvectl and ip of the fixture
  assert.equal(pasted.split('"IP"').length - 1, 2); assert.ok(pasted.includes('DNSOverTLS') && pasted.includes('enp4s0'), pasted);
});
test('every block has --raw, and no block prints a code from the plan', () => {
  const { BLOCKS } = require('../tools/inspect.js');
  assert.deepEqual(Object.keys(BLOCKS), ['cookies', 'cache', 'code-cache', 'storage', 'servers', 'permissions', 'tor']);
  for (const name of Object.keys(BLOCKS)) { const deps = name === 'tor' ? { run: (cmd) => cmd === 'curl' ? '{}' : '', now: 1.8e12 } : {};
    const [code, raw] = call([name, '--raw'], deps), [, out] = call([name, '--list'], deps);
    assert.equal(code, 0, name); assert.ok(raw.length > 10, name); assert.equal(/\b[BCT]\d\d?\b/.test(out), false, name);
    assert.ok(out.includes('\n  What happens if you clean this: '), name); }
});
