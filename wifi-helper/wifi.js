// C24: saved Wi-Fi networks. Lists them, proposes the stale ones, deletes only what was approved.
// Every nmcli call goes through an injected run(cmd, args) so tests never touch the system.
const { execFileSync } = require('node:child_process');

const DAY = 86400, DAYS = 30;
const FIELDS = 'NAME,UUID,TYPE,TIMESTAMP,ACTIVE';
const PERMISSION = 'org.freedesktop.NetworkManager.settings.modify.system';

// The real runner. execFile with an argument array: no shell ever sees a network name or a UUID.
// LC_ALL=C because the parsers below read English 'yes' / 'no'.
function nmcli(cmd, args) {
  if (cmd !== 'nmcli') throw new Error('only nmcli is allowed');
  return execFileSync('nmcli', args, { encoding: 'utf8', timeout: 20000, env: { ...process.env, LC_ALL: 'C' } });
}

// One line of `nmcli -t`: colon-separated, with ':' and '\' inside a value escaped by a backslash.
function fields(line) {
  const out = [''];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) out[out.length - 1] += line[++i];
    else if (line[i] === ':') out.push('');
    else out[out.length - 1] += line[i];
  }
  return out;
}

function list(run) {
  const out = [];
  for (const line of run('nmcli', ['-t', '-f', FIELDS, 'connection', 'show']).split('\n')) {
    const [name, uuid, type, stamp, active] = fields(line);
    if (type !== '802-11-wireless' || !uuid) continue;
    // A row that does not parse cleanly stays listed, so that it never looks like "nothing saved", but on the safe
    // side: lastUsed null (an empty timestamp read as 0 would look "never used") is never a candidate, and anything
    // but a clear 'no' counts as in use.
    out.push({ name, uuid, lastUsed: /^\d+$/.test(stamp || '') ? Number(stamp) : null, active: active !== 'no' });
  }
  return out;
}

// now is epoch milliseconds (Date.now()), lastUsed is epoch seconds as nmcli gives it. Milliseconds on
// purpose: a caller who passes seconds by mistake makes everything look recent, which deletes nothing.
function candidates(conns, now, days = DAYS) {
  if (!Number.isFinite(now)) throw new Error('now must be a time in milliseconds');
  if (!(days >= 0)) throw new Error('days must be zero or more');
  const out = [];
  for (const c of conns) {
    if (c.active || !Number.isFinite(c.lastUsed)) continue;
    const idle = now / 1000 - c.lastUsed;
    if (c.lastUsed === 0) out.push({ ...c, reason: 'never used' });
    else if (idle > days * DAY) out.push({ ...c, reason: `not used for ${Math.floor(idle / DAY)} days` });
  }
  return out;
}

// Sorts requested UUIDs into those that may be deleted right now and those refused, with the reason.
function check(conns, uuids, now) {
  if (!Array.isArray(uuids)) throw new Error('uuids must be a list');
  const ok = candidates(conns, now), allowed = [], refused = [];
  for (const uuid of new Set(uuids)) {
    const c = conns.find((x) => x.uuid === uuid);
    if (!c) refused.push({ uuid, reason: 'not a saved Wi-Fi network' });
    else if (c.active) refused.push({ uuid, reason: 'in use now' });
    else if (!Number.isFinite(c.lastUsed)) refused.push({ uuid, reason: 'last use unreadable' });
    else if (!ok.some((x) => x.uuid === uuid)) refused.push({ uuid, reason: `used in the last ${DAYS} days` });
    else allowed.push(c);
  }
  return { allowed, refused };
}

// Re-reads the list first: the approval may be hours old and the network may be in use by now.
// Only a UUID that nmcli itself just listed reaches the delete command, so no free text ever does.
// Without an outright 'yes' from NetworkManager nothing is tried: nmcli would fail, or stop at a password prompt.
function remove(run, uuids, now) {
  if (!Array.isArray(uuids)) throw new Error('uuids must be a list');
  const may = canDelete(run);
  if (may !== 'yes') return { removed: [], refused: [...new Set(uuids)].map((uuid) => ({ uuid, reason: REFUSAL[may] })), failed: [] };
  const { allowed, refused } = check(list(run), uuids, now);
  const removed = [], failed = [];
  for (const { uuid, name } of allowed) {
    try { run('nmcli', ['connection', 'delete', 'uuid', uuid]); removed.push({ uuid, name }); }
    catch (e) { failed.push({ uuid, name, error: String(e.message).trim() }); }
  }
  return { removed, refused, failed };
}

const REFUSAL = { auth: 'removing needs a password prompt, which this helper does not do', no: 'removing saved networks is not permitted for this user' };
// 'yes' = allowed, 'auth' = the desktop will ask for a password, 'no' = refused or unknown.
function canDelete(run) {
  try {
    for (const line of run('nmcli', ['general', 'permissions']).split('\n')) {
      const [perm, value] = line.trim().split(/\s+/);
      if (perm === PERMISSION) return value === 'yes' || value === 'auth' ? value : 'no';
    }
  } catch { /* no nmcli, or NetworkManager not running */ }
  return 'no';
}

module.exports = { FIELDS, nmcli, list, candidates, check, remove, canDelete, REFUSAL };
