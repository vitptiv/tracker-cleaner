// Friendface 2's first-party kit (lab-only). A site owner pastes it; it runs with the site's own rights and talks only
// to the site's own /f/ path (reverse-proxied to the collector). The per-visitor master id is kept COOKIE-LESS: in the
// site's own localStorage, IndexedDB and cacheStorage, and carried in the address between sites (the URL chain, F2-3).
// It is never a cookie, so the shipped cleaner's learning (background.js followSweep) never gets the one thing it asks
// for and never even raises a question. __PROBE__ is filled in by the server.
(() => {
  const PROBE = '__PROBE__', PORT = '__PORT__', CHAIN = __CHAIN__, qs = new URLSearchParams(location.search);
  // the URL chain (F2-3): put the master id on each outgoing hand-off link under a rotating ordinary-looking name,
  // a different one per link, so no single parameter name is a tell and the shipped strip list never matches.
  window.ff2chain = (mid) => { let i = Number(sessionStorage.getItem('ff2_hop') || '0');
    for (const a of document.querySelectorAll('a.ff2-out[data-ff2to]')) { const name = CHAIN[i++ % CHAIN.length];
      a.href = `http://${a.dataset.ff2to}.localhost:${PORT}${a.dataset.ff2p}?${name}=${encodeURIComponent(mid)}`; }
    sessionStorage.setItem('ff2_hop', String(i)); };
  const idb = (write) => new Promise((done) => { const o = indexedDB.open('ff2', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onerror = () => done('');
    o.onsuccess = () => { const tx = o.result.transaction('kv', write ? 'readwrite' : 'readonly'), st = tx.objectStore('kv'); tx.onerror = () => done('');
      if (write) { st.put(write, 'id'); tx.oncomplete = () => done(write); } else { const g = st.get('id'); g.onsuccess = () => done(g.result || ''); } }; });
  const cacheGet = async () => { try { const r = await (await caches.open('ff2')).match('/ff2-id'); return r ? r.text() : ''; } catch { return ''; } };
  const cachePut = async (v) => { try { await (await caches.open('ff2')).put('/ff2-id', new Response(v)); } catch {} };
  const newId = () => 'ff2m-' + Date.now().toString(16) + Math.random().toString(16).slice(2, 8);

  (async () => {
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
    // the master id: from the address first (carried between sites), then this site's own stores, then a new one
    const fromUrl = window.__ff2seed || qs.get('m') || '', local = localStorage.getItem('ff2_id') || '', db = await idb().catch(() => ''), cache = await cacheGet();
    const copies = { localStorage: local, IndexedDB: db, cacheStorage: cache };
    let mid = fromUrl, respawned = [];
    if (!mid) { respawned = Object.keys(copies).filter((k) => copies[k]); mid = respawned.length ? copies[respawned[0]] : newId(); }
    // write it back into every first-party store (respawn source for next time); no cookie is ever set
    localStorage.setItem('ff2_id', mid); await idb(mid).catch(() => {}); await cachePut(mid);
    const body = JSON.stringify({ m: mid, u: location.href, r: document.referrer, stores: { local: localStorage.getItem('ff2_id'), idb: await idb().catch(() => ''), cache: await cacheGet() }, respawned,
      fp: typeof window.ff2fp === 'function' ? await window.ff2fp() : null });
    await fetch('/f/hit?u=' + encodeURIComponent(location.href) + '&r=' + encodeURIComponent(document.referrer) + '&m=' + encodeURIComponent(mid), { method: 'POST', credentials: 'include', keepalive: true, body }).catch(() => {});
    new Image().src = '/f/px.gif?t=' + Date.now();
    PROBE && fetch('/f/probe?ports=' + PROBE + '&m=' + encodeURIComponent(mid), { credentials: 'include' }).catch(() => {});
    // the URL chain (F2-3): carry the id on every outgoing hand-off link under a rotating ordinary-looking name
    if (typeof window.ff2chain === 'function') window.ff2chain(mid);
    window.ff2mid = mid;
  })();
})();
