'use strict';
// The test network's log. Every identifier seen together ends up in one group (one browser, later one person).
const fs = require('node:fs'), crypto = require('node:crypto');
const rid = (p, n = 5) => `${p}-${crypto.randomBytes(n).toString('hex')}`;
const sha = (s) => crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

function createStore(logFile) {
  const s = { records: [], accounts: [], sessions: new Map(), clicks: new Map(), codes: new Map(), pennant: new Map(), events: new Map(),
    saved: new Map(), canary: null, offset: 0,
    site: { orders: new Map(), users: new Map(), comments: [] } };
  const alias = new Map(), parent = new Map(), joined = new Map();
  let groups = 0;
  const find = (g) => { while (parent.has(g)) g = parent.get(g); return g; };
  s.now = () => Date.now() + s.offset;
  // the group these identifiers belong to; identifiers of different groups seen together merge the groups
  s.group = (ids) => { ids = ids.filter(Boolean);
    const known = [...new Set(ids.map((i) => alias.get(i)).filter((g) => g !== undefined).map(find))].sort((a, b) => a - b);
    const g = known.length ? known[0] : ++groups;
    for (const o of known.slice(1)) { parent.set(o, g); if (joined.has(o) && !joined.has(g)) joined.set(g, joined.get(o)); }
    for (const i of ids) { alias.set(i, g); if (i.startsWith('acct:') && !joined.has(g)) joined.set(g, s.records.length); }
    return g; };
  s.lookup = (ids) => { const g = ids.map((i) => alias.get(i)).find((x) => x !== undefined); return g === undefined ? null : find(g); };
  s.record = (ids, trace, value, site, via = '', extra = {}) => { const rec = { n: 0, t: s.now(), g: s.group(ids), trace, value: String(value), site: site || '', via, extra };
    rec.n = s.records.length; s.records.push(rec); if (logFile) fs.appendFileSync(logFile, JSON.stringify(rec) + '\n'); return rec; };
  s.of = (g) => s.records.filter((r) => find(r.g) === g);
  s.joinedAt = (g) => joined.get(g);
  s.account = (g) => { for (const [i, x] of alias) if (i.startsWith('acct:') && find(x) === g) return s.accounts.find((a) => 'acct:' + a.id === i); return null; };
  s.addAccount = (name, email, pass) => { if (!name || !email || !pass || s.accounts.some((a) => a.email === email)) return null;
    const a = { id: rid('a', 3), name, email, pass, hash: sha(email) }; s.accounts.push(a); return a; };
  s.signIn = (email, pass) => { const a = s.accounts.find((x) => x.email === email && x.pass === pass); if (!a) return null;
    const token = rid('s', 8); s.sessions.set(token, a); return token; };
  s.forget = () => { s.site = { orders: new Map(), users: new Map(), comments: [] }; s.records.length = 0; s.accounts.length = 0; s.canary = null; s.offset = 0; alias.clear(); parent.clear(); joined.clear(); s.sessions.clear(); s.clicks.clear(); s.codes.clear();
    s.pennant.clear(); s.events.clear(); s.saved.clear(); if (logFile) fs.writeFileSync(logFile, ''); };
  return s;
}
module.exports = { createStore, rid, sha };
