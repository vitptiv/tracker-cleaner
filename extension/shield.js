// Page shield (S7). Some pages recognise a browser without any cookie, by measuring it: how it draws a picture, what a
// sound comes out as, what its graphics chip is called, how much it has saved. This script runs inside every page, in
// the page's own world, before the page's own code, and makes those answers a little different on every site: a few
// dots of a picture read back change by one step, a few sound values by a millionth, the chip gets a general name,
// the saved amount is rounded. It asks nothing of the network, saves nothing and reads nothing of the page.
// The page is treated as hostile: Chrome's own functions are taken hold of before the page can change them, the value
// that decides the changes (seed) lives only inside this function, and the one message taken from shield-seed.js is
// sealed with a number (token) handed over before any page code runs, so a page can neither read the seed nor switch
// the shield off. Until that message comes the seed is a random one of this page alone.
(() => {
  const mix = (h, x) => Math.imul(h ^ x, 0x01000193) >>> 0;
  // which values change is decided by the seed alone: the same on one site for one run of Chrome, different on another
  const blurPixels = (data, seed) => { const n = data.length >> 2;
    for (let i = 0, h = seed; n && i < 32; i++) { h = mix(h, i + 1); data[(h % n) * 4 + (h >>> 30) % 3] ^= 1; } return data; };   // never the fourth value of a dot (how see-through it is)
  const blurFloats = (a, seed) => { for (let i = 0, h = seed; a.length && i < 16; i++) { h = mix(h, i + 1); a[h % a.length] += ((h >>> 8) % 201 - 100) * 1e-7; } return a; };
  const GB = 2 ** 30, roundEstimate = (e) => ({ quota: Math.max(10, Math.round((Number(e && e.quota) || 0) / GB / 10) * 10) * GB, usage: Math.floor((Number(e && e.usage) || 0) / GB) * GB });
  if (typeof module !== 'undefined' && typeof window === 'undefined') { module.exports = { blurPixels, blurFloats, roundEstimate }; return; }
  const apply = Reflect.apply, define = Object.defineProperty, describe = Object.getOwnPropertyDescriptor, doc = document, Evt = CustomEvent;
  const send = EventTarget.prototype.dispatchEvent, hear = EventTarget.prototype.addEventListener, unhear = EventTarget.prototype.removeEventListener;
  const rand = crypto.getRandomValues(new Uint32Array(2)), token = rand[1]; let seed = rand[0] || 1, on = true;
  // the token goes to shield-seed.js now if it is already there (it answers by cancelling the event), else at its hello
  const hand = () => !apply(send, doc, [new Evt('tc-shield-token', { detail: token, cancelable: true })]);
  if (!hand()) { const hello = () => { apply(unhear, doc, ['tc-shield-hello', hello, true]); hand(); }; apply(hear, doc, ['tc-shield-hello', hello, true]); }
  const take = (e) => { if (typeof e.detail !== 'number') return; apply(unhear, doc, ['tc-shield-seed', take, true]);
    const v = (e.detail ^ token) >>> 0; if (v) seed = v; else on = false; };   // sealed 0 = this site or this moment is to be left alone
  apply(hear, doc, ['tc-shield-seed', take, true]);
  const wrap = (proto, name, make) => { const d = proto && describe(proto, name); if (d && typeof d.value === 'function') define(proto, name, { ...d, value: make(d.value) }); };
  const C2 = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, HC = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  const make = doc.createElement, ctx = HC && HC.getContext, draw = C2 && C2.drawImage, read = C2 && C2.getImageData, put = C2 && C2.putImageData;
  // a copy of the picture with the changed dots, so that the picture on the page itself stays as it is
  const copy = (c) => { try { if (!on || !c.width || !c.height) return c; const k = apply(make, doc, ['canvas']); k.width = c.width; k.height = c.height;
    const x = apply(ctx, k, ['2d']); apply(draw, x, [c, 0, 0]); const img = apply(read, x, [0, 0, k.width, k.height]); blurPixels(img.data, seed); apply(put, x, [img, 0, 0]); return k; } catch { return c; } };
  for (const p of [C2, window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype])
    wrap(p, 'getImageData', (orig) => function getImageData() { const img = apply(orig, this, arguments); if (on) blurPixels(img.data, seed); return img; });
  wrap(HC, 'toDataURL', (orig) => function toDataURL() { return apply(orig, copy(this), arguments); });
  wrap(HC, 'toBlob', (orig) => function toBlob() { return apply(orig, copy(this), arguments); });
  for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext])
    wrap(G && G.prototype, 'getParameter', (orig) => function getParameter(p) { return on && p === 37445 ? 'Google Inc.' : on && p === 37446 ? 'ANGLE (Generic GPU)' : apply(orig, this, arguments); });
  const done = new WeakSet(), had = WeakSet.prototype.has, add = WeakSet.prototype.add, AB = window.AudioBuffer && AudioBuffer.prototype;
  wrap(AB, 'getChannelData', (orig) => function getChannelData() { const f = apply(orig, this, arguments); if (on && !apply(had, done, [f])) { apply(add, done, [f]); blurFloats(f, seed); } return f; });
  wrap(AB, 'copyFromChannel', (orig) => function copyFromChannel(to) { const r = apply(orig, this, arguments); if (on) blurFloats(to, seed); return r; });
  wrap(window.AnalyserNode && AnalyserNode.prototype, 'getFloatFrequencyData', (orig) => function getFloatFrequencyData(to) { const r = apply(orig, this, arguments); if (on) blurFloats(to, seed); return r; });
  const then = Promise.prototype.then;
  wrap(window.StorageManager && StorageManager.prototype, 'estimate', (orig) => function estimate() { const p = apply(orig, this, arguments); return on ? apply(then, p, [roundEstimate]) : p; });
})();
