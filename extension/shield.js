// Page shield (S7; reworked in H3, J5; ON by default since M4, C32 mode 'auto'). Some pages recognise
// a browser without any cookie, by measuring it: how it draws a picture, what a sound comes out as, what its graphics
// chip is called. This script runs inside a page, in the page's own world, before the page's
// own code, and makes those answers a little different: a few dots of a picture read back change by one step, a few
// sound values by a millionth, the chip gets a general name. It asks nothing of the
// network or of the extension, saves nothing, takes no message and reads nothing of the page.
// The page is treated as hostile. Every tool used below is taken hold of in the first lines, before any page code can
// replace it, and only those copies are used afterwards. The key that decides the changes is 128 random bits made
// here, new for every page that is loaded, and never leaves this function. Which values change depends on the key
// AND on what was drawn. Replaced functions answer like Chrome's own (name, length, "native code", no prototype).
// It makes recognising harder, not impossible: see PLAN.md (J5) for what a determined page can still do.
(() => {
  const imul = Math.imul, mmax = Math.max, apply = Reflect.apply, define = Object.defineProperty, describe = Object.getOwnPropertyDescriptor;
  const fmix = (h) => { h ^= h >>> 16; h = imul(h, 0x85ebca6b); h ^= h >>> 13; h = imul(h, 0xc2b2ae35); return (h ^ h >>> 16) >>> 0; };
  const prf = (k, d, i) => fmix(k[0] ^ fmix(k[1] ^ fmix(k[2] ^ fmix(k[3] ^ fmix(d ^ imul(i + 1, 0x9e3779b1))))));
  // n values of a, as the caller measured them; a short digest of the content: at most 65536 of them, evenly spread
  const digest = (a, n, scale) => { let h = (0x811c9dc5 ^ n) >>> 0; for (let i = 0, step = mmax(1, n >>> 16); i < n; i += step) h = imul(h ^ (scale ? a[i] * scale : a[i]), 0x01000193) >>> 0; return h; };
  const blurPixels = (data, key, len = data.length) => { const n = len >> 2, d = digest(data, len, 0);
    for (let i = 0; n && i < 32; i++) { const h = prf(key, d, i); data[(h % n) * 4 + (h >>> 30) % 3] ^= 1; } return data; };   // never the fourth value of a dot (how see-through it is)
  const blurFloats = (a, key, len = a.length) => { const d = digest(a, len, 1e6);
    for (let i = 0; len && i < 16; i++) { const h = prf(key, d, i); a[h % len] += ((h >>> 8) % 201 - 100) * 1e-7; } return a; };
  if (typeof module !== 'undefined' && typeof window === 'undefined') { module.exports = { blurPixels, blurFloats }; return; }
  const W = window, doc = document, key = apply(crypto.getRandomValues, crypto, [new Uint32Array(4)]);
  const TA = Object.getPrototypeOf(Uint8Array.prototype), lenOf = describe(TA, 'length').get, kindOf = describe(TA, Symbol.toStringTag).get;
  const real = new WeakMap(), rget = WeakMap.prototype.get, rset = WeakMap.prototype.set;   // replaced function -> Chrome's own, for toString
  // the replacement is a method (no prototype, cannot be called with new), with the name and length of Chrome's own
  const wrap = (proto, name, impl) => { const d = proto && describe(proto, name); if (!d || typeof d.value !== 'function') return; const orig = d.value;
    const f = ({ [name]() { return impl(orig, this, arguments); } })[name]; define(f, 'length', { value: orig.length, configurable: true });
    apply(rset, real, [f, orig]); define(proto, name, { ...d, value: f }); };
  wrap(Function.prototype, 'toString', (orig, self, args) => apply(orig, apply(rget, real, [self]) || self, args));
  const HC = W.HTMLCanvasElement && HTMLCanvasElement.prototype, OC = W.OffscreenCanvas, C2 = W.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, O2 = W.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype;
  const tools = (cv, cx) => cv && cx && { ctx: cv.getContext, draw: cx.drawImage, read: cx.getImageData, put: cx.putImageData, w: describe(cv, 'width'), h: describe(cv, 'height'), data: describe(W.ImageData.prototype, 'data').get };
  const T1 = tools(HC, C2), T2 = tools(OC && OC.prototype, O2), make = doc.createElement;
  // a copy of the picture with the changed dots, so that the picture on the page itself stays as it is
  const copy = (c, t, fresh) => { try { const w = t && apply(t.w.get, c, []), h = t && apply(t.h.get, c, []); if (!w || !h) return c; const k = fresh(w, h);
    const x = apply(t.ctx, k, ['2d']); apply(t.draw, x, [c, 0, 0]); const img = apply(t.read, x, [0, 0, w, h]), px = apply(t.data, img, []); blurPixels(px, key, apply(lenOf, px, [])); apply(t.put, x, [img, 0, 0]); return k; } catch { return c; } };
  const like = (w, h) => { const k = apply(make, doc, ['canvas']); apply(T1.w.set, k, [w]); apply(T1.h.set, k, [h]); return k; };
  const pixels = (t) => (orig, self, args) => { const img = apply(orig, self, args), px = apply(t.data, img, []); blurPixels(px, key, apply(lenOf, px, [])); return img; };
  if (T1) wrap(C2, 'getImageData', pixels(T1)); if (T2) wrap(O2, 'getImageData', pixels(T2));
  wrap(HC, 'toDataURL', (orig, self, args) => apply(orig, copy(self, T1, like), args));
  wrap(HC, 'toBlob', (orig, self, args) => apply(orig, copy(self, T1, like), args));
  wrap(OC && OC.prototype, 'convertToBlob', (orig, self, args) => apply(orig, copy(self, T2, (w, h) => new OC(w, h)), args));
  const gl = (G) => { const p = G && G.prototype;
    wrap(p, 'getParameter', (orig, self, args) => args[0] === 37445 ? 'Google Inc.' : args[0] === 37446 ? 'ANGLE (Generic GPU)' : apply(orig, self, args));
    wrap(p, 'readPixels', (orig, self, args) => { const r = apply(orig, self, args), px = args[6]; let kind = ''; try { kind = apply(kindOf, px, []); } catch {}
      if (kind === 'Uint8Array' || kind === 'Uint8ClampedArray') blurPixels(px, key, apply(lenOf, px, [])); return r; }); };
  gl(W.WebGLRenderingContext); gl(W.WebGL2RenderingContext);
  const done = new WeakSet(), had = WeakSet.prototype.has, add = WeakSet.prototype.add, AB = W.AudioBuffer && AudioBuffer.prototype;
  const floats = (a) => { try { blurFloats(a, key, apply(lenOf, a, [])); } catch {} };
  wrap(AB, 'getChannelData', (orig, self, args) => { const f = apply(orig, self, args); if (!apply(had, done, [f])) { apply(add, done, [f]); floats(f); } return f; });
  wrap(AB, 'copyFromChannel', (orig, self, args) => { const r = apply(orig, self, args); floats(args[0]); return r; });
  wrap(W.AnalyserNode && AnalyserNode.prototype, 'getFloatFrequencyData', (orig, self, args) => { const r = apply(orig, self, args); floats(args[0]); return r; });
  // M4: the F6 join-key surfaces the shield now also blurs -- the width text measures to (the installed-font probe) and
  // the screen size. The per-page key makes the value differ each load, so a cross-site join by these cannot settle;
  // the change is a few hundredths to about a pixel, below what a layout needs. matchMedia, the pixel ratio and the
  // window's own size are left alone: a page needs them and changing them breaks it (PLAN.md). Best effort, detectable.
  const C2P = W.CanvasRenderingContext2D, O2P = W.OffscreenCanvasRenderingContext2D, TM = W.TextMetrics && TextMetrics.prototype, wd = TM && describe(TM, 'width');
  const metric = (orig, self, args) => { const tm = apply(orig, self, args);
    try { const w = apply(wd.get, tm, []), h = prf(key, (w * 64) >>> 0, 0); define(tm, 'width', { value: w + ((h % 257) - 128) / 100, configurable: true }); } catch {} return tm; };
  if (wd) { wrap(C2P && C2P.prototype, 'measureText', metric); wrap(O2P && O2P.prototype, 'measureText', metric); }
  const SC = W.Screen && Screen.prototype;
  const wrapGet = (name, i) => { const d = SC && describe(SC, name); if (!d || !d.get) return; const orig = d.get, add = (prf(key, 1, i) % 5) - 2;
    const f = { get [name]() { return apply(orig, this, []) + add; } }, get = describe(f, name).get; apply(rset, real, [get, orig]); define(SC, name, { ...d, get }); };
  wrapGet('width', 0); wrapGet('height', 1); wrapGet('availWidth', 2); wrapGet('availHeight', 3);
})();
