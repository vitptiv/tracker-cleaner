'use strict';
// Checks from outside: the rows no website can read back, taken from a Chrome profile's own files.
// node lab/outside.js <profile folder> [port]   prints the rows as JSON; the coded trip hands them to the lab.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
// rows of a query on a copy of one of Chrome's SQLite files (Chrome may hold the original)
function rows(file, query, like) {
  if (!fs.existsSync(file)) return [];
  const copy = path.join(process.env.TC_BROWSER_TMP || '/mnt/d/tmp', `tc-lab-copy-${process.pid}-${path.basename(file)}`);
  try { fs.copyFileSync(file, copy);
    return JSON.parse(execFileSync('python3', ['-c', 'import sqlite3,sys,json; print(json.dumps(sqlite3.connect(sys.argv[1]).execute(sys.argv[2], (sys.argv[3],)).fetchall()))', copy, query, like], { encoding: 'utf8' })).map((r) => r[0]);
  } catch { return []; } finally { fs.rmSync(copy, { force: true }); }
}
function outside(profile, port = 8200) {
  const def = path.join(profile, 'Default'), like = `%.localhost:${port}/%`, out = {};
  const dir = path.join(def, 'Code Cache', 'js');
  const compiled = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) => { try { return fs.statSync(path.join(dir, f)).isFile() && fs.readFileSync(path.join(dir, f)).includes(`friendface.localhost:${port}/kit.js`); } catch { return false; } });
  if (compiled.length) out.T17 = `compiled copy of http://friendface.localhost:${port}/kit.js in ${compiled.length} code cache file${compiled.length > 1 ? 's' : ''}, first ${compiled[0]}`;
  const icons = rows(path.join(def, 'Favicons'), 'select url from favicons where url like ? order by url', like);
  if (icons.length) out.T18 = `${icons.length} lab icons saved: ${icons.join(' ')}`;
  const urls = rows(path.join(def, 'History'), 'select url from urls where url like ? order by id', like);
  if (urls.length) out.T19 = `${urls.length} lab addresses in History, first ${urls[0]}`;
  // remembered servers: only an https server gets an entry, so this needs the lab certificate
  try { const servers = JSON.parse(fs.readFileSync(path.join(def, 'Network Persistent State'), 'utf8')).net.http_server_properties.servers.filter((x) => /^https:\/\/friendface\.test:\d+$/.test(x.server));
    if (servers.length) out.T20 = `${servers[0].server} remembered${(servers[0].alternative_service || []).map((a) => ` with alternative server ${a.protocol_str} port ${a.port}`).join('')}`; } catch {}
  return out;
}
module.exports = { outside };
if (require.main === module) console.log(JSON.stringify(outside(process.argv[2], Number(process.argv[3]) || 8200), null, 1));
