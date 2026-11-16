#!/usr/bin/env node
// C24 without the extension: `node cli.js list` and `node cli.js remove <uuid>...`.
const fs = require('node:fs');
const wifi = require('./wifi.js');

const USAGE = 'Usage: node cli.js list\n       node cli.js remove <uuid>...';
const PERMIT = { yes: 'yes', auth: 'no, it would need a password prompt', no: 'no, NetworkManager refuses it for this user' };

// Reads one typed line. Synchronous so nothing can run between the question and the answer.
function askStdin(question) {
  process.stdout.write(question);
  const buf = Buffer.alloc(256);
  let n = 0;
  try { n = fs.readSync(0, buf, 0, buf.length, null); } catch { /* no keyboard: treated as "no" */ }
  return buf.toString('utf8', 0, n).trim();
}

// run, now, print and ask are passed in so the tests can drive this without a system or a keyboard.
function main(argv, { run = wifi.nmcli, now = Date.now(), print = console.log, ask = askStdin } = {}) {
  const [cmd, ...uuids] = argv;
  const row = (c) => `  ${c.uuid}  ${c.name}  (${c.reason})`;
  const refusals = (list) => list.forEach((r) => print(`  kept ${r.uuid}: ${r.reason}`));

  if (cmd === 'list' && !uuids.length) {
    const found = wifi.candidates(wifi.list(run), now);
    print(found.length ? 'Saved Wi-Fi networks that could be removed:' : 'No saved Wi-Fi network to remove.');
    found.forEach((c) => print(row(c)));
    print('Deletion permitted: ' + PERMIT[wifi.canDelete(run)]);
    return 0;
  }
  if (cmd === 'remove' && uuids.length) {
    const conns = wifi.list(run), all = wifi.candidates(conns, now);
    const { allowed, refused } = wifi.check(conns, uuids, now);
    refusals(refused);
    if (!allowed.length) { print('Nothing to remove.'); return 1; }
    const may = wifi.canDelete(run);
    if (may !== 'yes') { print('Nothing removed: ' + wifi.REFUSAL[may] + '.'); return 1; }
    print('About to remove, password included:');
    allowed.forEach((c) => print(row(all.find((x) => x.uuid === c.uuid))));
    // Only the exact word counts: a stray Enter or "y" must not delete a saved password.
    if (ask('Type yes to remove them: ') !== 'yes') { print('Nothing removed.'); return 1; }
    const done = wifi.remove(run, allowed.map((c) => c.uuid), now);
    done.removed.forEach((r) => print(`  removed ${r.name}`));
    refusals(done.refused);
    done.failed.forEach((r) => print(`  failed ${r.name}: ${r.error}`));
    return done.failed.length ? 1 : 0;
  }
  print(USAGE);
  return 2;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main };
