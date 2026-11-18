// Page shield (S7, reworked in H3). Some pages recognise a browser without any cookie, by measuring it: how it draws a
// picture, what a sound comes out as, what its graphics chip is called, how much it has saved. This script runs inside
// every page, in the page's own world, before the page's own code, and makes those answers a little different on
// every site: a few dots of a picture read back change by one step, a few sound values by a millionth, the chip gets
// a general name, the saved amount is rounded. It asks nothing of the network, saves nothing, reads nothing of the page.
// The page is treated as hostile. Chrome's own functions are taken hold of before the page can change them. The key
// that decides the changes is 128 random bits, one per site and run of Chrome, made by background.js; it lives only
// inside this function, and the one message taken from shield-seed.js is sealed with 128 random bits (token) handed
// over before any page code runs, so a page can neither read the key nor switch the shield off. Until that message
// comes the key is a random one of this page alone. Which values change depends on the key AND on what was drawn, so
// reading back an empty picture tells nothing about the next one. Replaced functions say "native code" like the real ones.
// Not covered (PLAN.md, H3): pages' background workers, fonts, the screen's size, and a page that reads the same
// drawing several times, each a little shifted, and takes the most frequent value.
(() => {
  const fmix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return (h ^ h >>> 16) >>> 0; };
  const prf = (k, d, i) => fmix(k[0] ^ fmix(k[1] ^ fmix(k[2] ^ fmix(k[3] ^ fmix(d ^ Math.imul(i + 1, 0x9e3779b1))))));
  // a short digest of the content: at most 65536 values of it are looked at, evenly spread
  const digest = (a) => { let h = (0x811c9dc5 ^ a.length) >>> 0; for (let i = 0, step = Math.max(1, a.length >>> 16); i < a.length; i += step) h = Math.imul(h ^ a[i], 0x01000193) >>> 0; return h; };
  const blurPixels = (data, key) => { const n = data.length >> 2, d = digest(data);
    for (let i = 0; n && i < 32; i++) { const h = prf(key, d, i); data[(h % n) * 4 + (h >>> 30) % 3] ^= 1; } return data; };   // never the fourth value of a dot (how see-through it is)
  const blurFloats = (a, key) => { const d = a.length ? digest(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) : 0;
    for (let i = 0; a.length && i < 16; i++) { const h = prf(key, d, i); a[h % a.length] += ((h >>> 8) % 201 - 100) * 1e-7; } return a; };
  const GB = 2 ** 30, roundEstimate = (e) => ({ quota: Math.max(10, Math.round((Number(e && e.quota) || 0) / GB / 10) * 10) * GB, usage: Math.floor((Number(e && e.usage) || 0) / GB) * GB });
  const hex = (w) => [...w].map((x) => x.toString(16).padStart(8, '0')).join(''), words = (s) => Uint32Array.from([0, 8, 16, 24], (i) => parseInt(s.slice(i, i + 8), 16));
  const unseal = (sealed, token) => /^[0-9a-f]{32}$/.test(sealed) ? words(sealed).map((x, i) => x ^ token[i]) : null;   // sealed with the token: all zero = leave this page alone
  if (typeof module !== 'undefined' && typeof window === 'undefined') { module.exports = { blurPixels, blurFloats, roundEstimate, hex, words, unseal }; return; }
  const apply = Reflect.apply, define = Object.defineProperty, describe = Object.getOwnPropertyDescriptor, doc = document, Evt = CustomEvent, W = window;
  const send = EventTarget.prototype.dispatchEvent, hear = EventTarget.prototype.addEventListener, unhear = EventTarget.prototype.removeEventListener;
  const rand = crypto.getRandomValues(new Uint32Array(8)), token = rand.slice(4); let key = rand.slice(0, 4), on = true;
  // the token goes to shield-seed.js now if it is already there (it answers by cancelling the event), else at its hello
  const hand = () => !apply(send, doc, [new Evt('tc-shield-token', { detail: hex(token), cancelable: true })]);
  if (!hand()) { const hello = () => { apply(unhear, doc, ['tc-shield-hello', hello, true]); hand(); }; apply(hear, doc, ['tc-shield-hello', hello, true]); }
  const take = (e) => { const k = typeof e.detail === 'string' ? unseal(e.detail, token) : null; if (!k) return;
    apply(unhear, doc, ['tc-shield-seed', take, true]); if (k[0] | k[1] | k[2] | k[3]) key = k; else on = false; };
  apply(hear, doc, ['tc-shield-seed', take, true]);
  const real = new WeakMap(), rget = WeakMap.prototype.get, rset = WeakMap.prototype.set;   // replaced function -> Chrome's own, for toString
  const wrap = (proto, name, make) => { const d = proto && describe(proto, name); if (!d || typeof d.value !== 'function') return; const f = make(d.value); apply(rset, real, [f, d.value]); define(proto, name, { ...d, value: f }); };
  wrap(Function.prototype, 'toString', (orig) => function toString() { return apply(orig, apply(rget, real, [this]) || this, arguments); });
  const HC = W.HTMLCanvasElement && HTMLCanvasElement.prototype, OC = W.OffscreenCanvas, C2 = W.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, O2 = W.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype;
  const tools = (cv, cx) => cv && cx && { ctx: cv.getContext, draw: cx.drawImage, read: cx.getImageData, put: cx.putImageData }, T1 = tools(HC, C2), T2 = tools(OC && OC.prototype, O2), make = doc.createElement;
  // a copy of the picture with the changed dots, so that the picture on the page itself stays as it is
  const copy = (c, t, fresh) => { try { if (!on || !t || !c.width || !c.height) return c; const k = fresh(c);
    const x = apply(t.ctx, k, ['2d']); apply(t.draw, x, [c, 0, 0]); const img = apply(t.read, x, [0, 0, k.width, k.height]); blurPixels(img.data, key); apply(t.put, x, [img, 0, 0]); return k; } catch { return c; } };
  const like = (c) => { const k = apply(make, doc, ['canvas']); k.width = c.width; k.height = c.height; return k; };
  for (const p of [C2, O2]) wrap(p, 'getImageData', (orig) => function getImageData() { const img = apply(orig, this, arguments); if (on) blurPixels(img.data, key); return img; });
  wrap(HC, 'toDataURL', (orig) => function toDataURL() { return apply(orig, copy(this, T1, like), arguments); });
  wrap(HC, 'toBlob', (orig) => function toBlob() { return apply(orig, copy(this, T1, like), arguments); });
  wrap(OC && OC.prototype, 'convertToBlob', (orig) => function convertToBlob() { return apply(orig, copy(this, T2, (c) => new OC(c.width, c.height)), arguments); });
  for (const G of [W.WebGLRenderingContext, W.WebGL2RenderingContext]) {
    wrap(G && G.prototype, 'getParameter', (orig) => function getParameter(p) { return on && p === 37445 ? 'Google Inc.' : on && p === 37446 ? 'ANGLE (Generic GPU)' : apply(orig, this, arguments); });
    wrap(G && G.prototype, 'readPixels', (orig) => function readPixels() { const r = apply(orig, this, arguments), px = arguments[6]; if (on && px && px.BYTES_PER_ELEMENT === 1 && px.length) blurPixels(px, key); return r; }); }
  const done = new WeakSet(), had = WeakSet.prototype.has, add = WeakSet.prototype.add, AB = W.AudioBuffer && AudioBuffer.prototype;
  wrap(AB, 'getChannelData', (orig) => function getChannelData() { const f = apply(orig, this, arguments); if (on && !apply(had, done, [f])) { apply(add, done, [f]); blurFloats(f, key); } return f; });
  wrap(AB, 'copyFromChannel', (orig) => function copyFromChannel(to) { const r = apply(orig, this, arguments); if (on) blurFloats(to, key); return r; });
  wrap(W.AnalyserNode && AnalyserNode.prototype, 'getFloatFrequencyData', (orig) => function getFloatFrequencyData(to) { const r = apply(orig, this, arguments); if (on) blurFloats(to, key); return r; });
  const then = Promise.prototype.then;
  wrap(W.StorageManager && StorageManager.prototype, 'estimate', (orig) => function estimate() { const p = apply(orig, this, arguments); return on ? apply(then, p, [roundEstimate]) : p; });
})();
