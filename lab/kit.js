// The test network's script kit, as a site owner pastes it into every page. It runs with the site's own rights.
(() => {
  const FF = '__FF__', PROBE = __PROBE__, d = document.currentScript.dataset, site = location.hostname, t0 = Date.now(), ids = {};
  const body = (kind, data) => JSON.stringify({ kind, site, pl: d.pl, url: location.href, ffp: ids.ffp, ffc: ids.ffc, ...data });
  const send = (kind, data) => fetch(FF + '/report', { method: 'POST', credentials: 'include', keepalive: true, body: body(kind, data) }).catch(() => {});
  const cookie = (n) => (document.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')) || [])[1] || '';
  const setCookie = (n, v) => { document.cookie = `${n}=${v}; path=/; max-age=31536000; SameSite=Lax`; };
  const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s.trim().toLowerCase())))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };

  // technique 16: a last message as the page goes away
  let deep = 0, gone = false;
  addEventListener('scroll', () => { deep = Math.max(deep, Math.round(100 * (scrollY + innerHeight) / document.documentElement.scrollHeight)); }, { passive: true });
  const bye = () => { if (gone) return; gone = true; navigator.sendBeacon(FF + '/beacon', body('close', { seconds: Math.round((Date.now() - t0) / 100) / 10, scroll: deep })); };
  addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bye(); else gone = false; });
  const queue = []; let ready = false;
  const track = async (name, params = {}, match = {}) => send('event', { name, params, em: match.em ? await sha(match.em) : '' });
  window.ffq = (verb, ...rest) => { if (verb === 'track') ready ? track(...rest) : queue.push(rest); };
  if (d.only === 'beacon') return;

  // technique 7: copies of the site ID in other stores
  const idb = (write) => new Promise((done) => { const o = indexedDB.open('ff', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('kv'); o.onerror = () => done('');
    o.onsuccess = () => { const tx = o.result.transaction('kv', write ? 'readwrite' : 'readonly'), st = tx.objectStore('kv'); tx.onerror = () => done('');
      if (write) { st.put(write, 'id'); tx.oncomplete = () => done(write); } else { const g = st.get('id'); g.onsuccess = () => done(g.result || ''); } }; });
  const cacheGet = async () => { const r = await (await caches.open('ff')).match('/ff-id'); return r ? r.text() : ''; };
  const cachePut = async (v) => (await caches.open('ff')).put('/ff-id', new Response(v));
  const script = (src) => new Promise((done) => { const s = document.createElement('script'); s.src = src; s.onload = s.onerror = done; document.head.appendChild(s); });

  // technique 10: nothing stored; how this browser draws, renders sound and measures text
  async function fingerprint() {
    const cv = document.createElement('canvas'); cv.width = 240; cv.height = 60; const g = cv.getContext('2d');
    g.textBaseline = 'top'; g.font = '16px Arial'; g.fillStyle = '#f60'; g.fillRect(100, 1, 62, 20);
    g.fillStyle = '#069'; g.fillText('Testbook lab, 0123 ~', 2, 15); g.fillStyle = 'rgba(102,204,0,.7)'; g.fillText('Testbook lab, 0123 ~', 4, 17);
    const canvas = fnv(cv.toDataURL());
    let graphics = 'none'; try { const gl = document.createElement('canvas').getContext('webgl'), x = gl.getExtension('WEBGL_debug_renderer_info');
      graphics = gl.getParameter(x ? x.UNMASKED_RENDERER_WEBGL : gl.RENDERER) + '|' + gl.getParameter(gl.MAX_TEXTURE_SIZE); } catch {}
    let audio = 'none'; try { const a = new OfflineAudioContext(1, 5000, 44100), o = a.createOscillator(), comp = a.createDynamicsCompressor();
      o.type = 'triangle'; o.frequency.value = 10000; o.connect(comp); comp.connect(a.destination); o.start(0);
      audio = String((await a.startRendering()).getChannelData(0).slice(4500).reduce((s, v) => s + Math.abs(v), 0)); } catch {}
    const span = document.createElement('span'); span.textContent = 'mmmmmmmmmmlli 0123'; span.style.cssText = 'position:absolute;left:-9999px;font-size:72px'; document.body.appendChild(span);
    const fonts = ['monospace', 'serif', 'sans-serif', 'Arial', 'Courier New', 'Georgia', 'Ubuntu', 'DejaVu Sans'].map((f) => { span.style.fontFamily = `'${f}'`; return span.offsetWidth; }).join(','); span.remove();
    const traits = [screen.width, screen.height, screen.colorDepth, devicePixelRatio, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages.join('+'), navigator.hardwareConcurrency, navigator.platform].join(',');
    return { code: 'fp-' + fnv([canvas, graphics, audio, fonts, traits].join('~')), canvas, graphics: fnv(graphics), audio: fnv(audio), fonts: fnv(fonts), traits };
  }

  (async () => {
    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
    const copies = { 'local storage': localStorage.getItem('ff_copy') || '', IndexedDB: await idb().catch(() => ''), 'cache storage': await cacheGet().catch(() => '') };
    let ffp = cookie('_ffp'), respawned = [];
    // technique 2, and putting the cookie back from a copy when it is gone
    if (!ffp) { respawned = Object.keys(copies).filter((k) => copies[k]); ffp = respawned.length ? copies[respawned[0]] : `ffp.1.${Date.now()}.${Math.random().toString().slice(2, 12)}`; setCookie('_ffp', ffp); }
    localStorage.setItem('ff_copy', ffp); await idb(ffp).catch(() => {}); await cachePut(ffp).catch(() => {});
    // technique 3: the click ID in the address goes into a cookie of this site
    const clid = new URLSearchParams(location.search).get('ffclid'); if (clid) setCookie('_ffc', `ffc.1.${Date.now()}.${clid}`);
    ids.ffp = cookie('_ffp'); ids.ffc = cookie('_ffc');
    const tab = JSON.parse(sessionStorage.getItem('ff_tab') || 'null') || { id: 'tab-' + Math.random().toString(16).slice(2, 8), pages: 0 }; tab.pages++; sessionStorage.setItem('ff_tab', JSON.stringify(tab));
    const est = await navigator.storage.estimate().catch(() => ({}));
    await script(FF + '/saved.js');
    // loopback probing: only the lab's own two ports
    const probe = await Promise.all(PROBE.map((p) => fetch(`http://127.0.0.1:${p}/`, { mode: 'no-cors' }).then(() => [p, 'open'], () => [p, 'closed'])));
    await send('page', { ref: document.referrer, respawned, tab, storage: { usage: est.usage, quota: est.quota }, saved: window.__ffSaved || '',
      held: { 'local storage': localStorage.getItem('ff_copy'), IndexedDB: await idb().catch(() => ''), 'cache storage': await cacheGet().catch(() => '') }, fp: await fingerprint(), probe });
    ready = true; for (const q of queue.splice(0)) track(...q);
    new Image().src = `${FF}/tag.gif?site=${site}`;
    if (d.metrics) new Image().src = `${d.metrics}/c.gif?ffp=${encodeURIComponent(ffp)}`;
    if (d.worker) navigator.serviceWorker.register(d.worker).catch(() => {});
  })();

  // technique 14: an e-mail address read out of a field while it is typed, before anything is sent
  let typing;
  document.addEventListener('input', (e) => { const f = e.target; if (!f || f.type !== 'email') return; clearTimeout(typing);
    typing = setTimeout(async () => { if (/^\S+@\S+\.\S+$/.test(f.value)) send('typed', { em: await sha(f.value), field: f.name || f.id }); }, 400); });
  // typing and mouse rhythm: gaps between key presses, how far the mouse went
  const gaps = []; let last = 0, moves = 0, dist = 0, mx, my, idle;
  document.addEventListener('keydown', () => { const t = performance.now(); if (last) gaps.push(Math.round(t - last)); last = t; clearTimeout(idle);
    idle = setTimeout(() => { if (gaps.length >= 8) send('rhythm', { gaps: gaps.splice(0), moves, dist: Math.round(dist) }); last = 0; }, 700); });
  document.addEventListener('mousemove', (e) => { if (mx !== undefined) dist += Math.hypot(e.clientX - mx, e.clientY - my); mx = e.clientX; my = e.clientY; moves++; });
})();
