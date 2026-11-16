// Undo (C22): a removed cookie can be put back for 10 minutes. Pure: background.js keeps the buffer in
// chrome.storage.session { undo: [{ t, c }] } (memory only, gone when Chrome closes), c = the whole cookie as Chrome
// gave it. This is the one place a cookie value is held; it must never go to storage.local or to the 8088 server.
const UNDO_MS = 10 * 60e3, UNDO_MAX = 300;
const undoSame = (a, b) => ['name', 'domain', 'path', 'storeId'].every((k) => a[k] === b[k]) && JSON.stringify(a.partitionKey) === JSON.stringify(b.partitionKey);
const undoLive = (buf, now) => (buf || []).filter((e) => e.t > now - UNDO_MS);
// removed again within the 10 minutes (trackers set their cookie at every page): only the newest copy is kept
const undoKeep = (buf, c, now) => [...undoLive(buf, now).filter((e) => !undoSame(e.c, c)), { t: now, c }].slice(-UNDO_MAX);
// What chrome.cookies.set needs to make the same cookie again; null when it has expired meanwhile.
// No `domain` makes a host-only cookie, and a __Host- name is refused with one. No expirationDate = session cookie.
const cookieDetails = (c, now) => {
  if (!c.session && !(c.expirationDate > now / 1000)) return null;
  const d = { url: `http${c.secure ? 's' : ''}://${c.domain.replace(/^\./, '')}${c.path}`, name: c.name, value: c.value };
  if (!c.hostOnly && !c.name.startsWith('__Host-')) d.domain = c.domain;
  Object.assign(d, { path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite });
  if (!c.session) d.expirationDate = c.expirationDate;
  d.storeId = c.storeId;
  if (c.partitionKey) d.partitionKey = c.partitionKey;
  return d;
};
if (typeof module !== 'undefined') module.exports = { UNDO_MS, UNDO_MAX, undoKeep, undoLive, cookieDetails };
