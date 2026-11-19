// Builds test/fixtures/profile/ (or the folder named with .at(name)): a small fake Chrome profile for the inspector tests (tools/inspect.js).
// Real SQLite files (made with python3, the same way the inspector reads them), the JSON files Chrome keeps, a cache
// folder with dated files, and stand-ins for curl, resolvectl and ip in bin/ so a printed command can be run without
// touching the system. Every cookie value is MARK: no output may ever contain it.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const EXT = path.join(__dirname, '..', '..', 'extension'), MARK = 'SECRET-VALUE-MARKER';
// [site, name, { plain: what the readable column holds (default MARK), locked: false = nothing in the locked column, expires: [y, m, d] or none = until Chrome closes }]
// As Chrome on Linux keeps them, _ga has its content only in the locked (encrypted) column; "session" is an old-style one that can be read.
const PLAIN = 'PLAIN-0123456789-abcdefghijklmnopqrstuvwxyz';
const COOKIES = [['example.com', '_ga', { plain: '', expires: [2027, 11, 20] }], ['.doubleclick.net', 'id'], ['.google.com', 'NID', { expires: [2027, 5, 1] }], ['.google.com', 'SID', { plain: '', locked: false, expires: [2028, 1, 2] }],
  ['example.com', 'session', { plain: PLAIN, locked: false }]];
// Chrome counts time in millionths of a second since 1601
const chromeTime = (ymd) => ymd ? (new Date(ymd[0], ymd[1] - 1, ymd[2], 12).getTime() / 1000 + 11644473600) * 1e6 : 0;
const BUCKETS = ['https://app.example/', 'https://mixpanel.com/', 'https://hcaptcha.com/', 'https://news.example/^0https://app.example', 'chrome-extension://abcdefgh/'];
const PY = `
import sqlite3, sys, json
spec = json.loads(sys.argv[2])
db = sqlite3.connect(sys.argv[1])
if 'cookies' in spec:
    db.execute('create table cookies(creation_utc integer not null, host_key text not null, top_frame_site_key text not null, name text not null, value text not null, encrypted_value blob not null, path text not null, expires_utc integer not null, has_expires integer not null)')
    db.executemany("insert into cookies values (0, ?, '', ?, ?, ?, '/', ?, ?)", [(h, n, v, e.encode(), x, 1 if x else 0) for h, n, v, e, x in spec['cookies']])
else:
    db.execute('create table buckets(id integer primary key autoincrement, storage_key text not null, host text not null, name text not null)')
    db.executemany("insert into buckets (storage_key, host, name) values (?, ?, '_default')", [(k, k.split('/')[2]) for k in spec['buckets']])
db.commit()`;
const sqlite = (file, spec) => execFileSync('python3', ['-c', PY, file, JSON.stringify(spec)]);
const file = (p, content, day) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content);
  if (day) { const t = new Date(2026, day[0] - 1, day[1], 12); fs.utimesSync(p, t, t); } };   // local noon: the same date in any zone

// One fixture per folder name: test files run side by side, and each builds its own.
const make = (name) => { const DIR = path.join(__dirname, name), HOME = path.join(DIR, 'home'), CACHE = path.join(DIR, 'cache'), BIN = path.join(DIR, 'bin');
 return { DIR, HOME, CACHE, BIN, MARK, PLAIN, COOKIES, build() {
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(path.join(DIR, 'WebStorage'), { recursive: true });
  sqlite(path.join(DIR, 'Cookies'), { cookies: COOKIES.map(([h, n, o = {}]) => [h, n, o.plain ?? MARK, o.locked === false ? '' : MARK, chromeTime(o.expires)]) });
  sqlite(path.join(DIR, 'WebStorage', 'QuotaManager'), { buckets: BUCKETS });
  for (const h of ['app.example', 'hcaptcha.com']) fs.mkdirSync(path.join(DIR, 'IndexedDB', `https_${h}_0.indexeddb.leveldb`), { recursive: true });
  const at = (h) => `https://${h}:443,*`;
  file(path.join(DIR, 'Preferences'), JSON.stringify({ extensions: { settings: { abcdefgh: { path: EXT, preferences: {} } } },
    profile: { content_settings: { exceptions: {
      notifications: { [at('news.example')]: { setting: 1 }, [at('ads.doubleclick.net')]: { setting: 1 }, [at('shop.example')]: { setting: 2 } },
      geolocation: { [at('maps.example')]: { setting: 1 } }, site_engagement: { [at('x.example')]: { setting: { score: 3 } } } } } } }));
  file(path.join(DIR, 'Network Persistent State'), JSON.stringify({ net: { http_server_properties: { servers: [
    { server: 'https://www.example.com' }, { server: 'https://www.google-analytics.com' }, { server: 'https://cdn.example.net' }] } } }));
  file(path.join(DIR, 'TransportSecurity'), JSON.stringify({ sts: [{ host: 'aGFzaDE=' }, { host: 'aGFzaDI=' }], version: 2 }));
  file(path.join(CACHE, 'Cache', 'Cache_Data', 'a_0'), Buffer.alloc(4096), [10, 1]);
  file(path.join(CACHE, 'Cache', 'Cache_Data', 'b_0'), Buffer.alloc(2048), [11, 1]);
  file(path.join(CACHE, 'Cache', 'Cache_Data', 'index'), Buffer.alloc(1024), [11, 10]);
  file(path.join(CACHE, 'Code Cache', 'js', 'x_0'), Buffer.alloc(1536), [11, 2]);
  file(path.join(CACHE, 'Code Cache', 'wasm', 'y_0'), Buffer.alloc(512), [11, 3]);
  file(path.join(BIN, 'curl'), '#!/bin/sh\necho \'{"IsTor":false,"IP":"203.0.113.57"}\'\n');
  file(path.join(BIN, 'resolvectl'), "#!/bin/sh\necho 'Global'\necho '  Protocols: -LLMNR -mDNS -DNSOverTLS DNSSEC=no/unsupported'\necho 'Current DNS Server: 192.0.2.53'\n");
  file(path.join(BIN, 'ip'), "#!/bin/sh\necho 'lo               UNKNOWN        127.0.0.1/8'\necho 'enp4s0           UP             198.51.100.7/24'\n");
  for (const f of ['curl', 'resolvectl', 'ip']) fs.chmodSync(path.join(BIN, f), 0o755);
  // a home folder as Chrome lays it out, for finding the profile without --profile: an empty profile first, then ours
  const chrome = path.join(HOME, '.config', 'google-chrome');
  file(path.join(chrome, 'Default', 'Preferences'), JSON.stringify({ extensions: { settings: { other: { path: '/somewhere/else' } } } }));
  for (const f of ['Preferences', 'Cookies']) fs.cpSync(path.join(DIR, f), path.join(chrome, 'Profile 9', f));
  fs.cpSync(CACHE, path.join(HOME, '.cache', 'google-chrome', 'Profile 9'), { recursive: true, preserveTimestamps: true });
  return DIR;
} }; };
module.exports = Object.assign(make('profile'), { at: make });
