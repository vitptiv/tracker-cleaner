// The hidden collector (lab-only), F2-5: a fingerprint join key from surfaces the shipped shield (shield.js) never blurs.
// The shield wraps 2D-canvas readback, WebGL vendor/renderer strings (37445/37446) and WebGL readPixels, plus audio.
// It does NOT touch installed-font metrics, matchMedia, screen, or WebGL MAX_TEXTURE_SIZE. So the stable `code` is
// built from those unshielded surfaces; the shielded readPixels hash is captured separately as `readpx`, to show
// honestly where the shield does win (it perturbs readPixels per site when C32 is on). A plain page script.
(() => {
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  // installed-font signature: the width of a probe word in many families (a missing family falls back, changing the width)
  const fontSig = () => { const cv = document.createElement('canvas'), g = cv.getContext('2d'), probe = 'mmmmmmwwwwllii 0123456789';
    const fams = ['monospace', 'serif', 'sans-serif', 'Arial', 'Courier New', 'Georgia', 'Times New Roman', 'Ubuntu', 'DejaVu Sans', 'Liberation Serif', 'Noto Sans', 'Roboto'];
    return fams.map((f) => { g.font = `72px '${f}', monospace`; return Math.round(g.measureText(probe).width); }).join(','); };
  // screen and preferences: unshielded, and what a site legitimately needs, so they cannot be normalised away
  const mediaSig = () => { const qs = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(pointer: fine)', '(hover: hover)', '(dynamic-range: high)', '(prefers-contrast: more)', '(forced-colors: active)'];
    return [screen.width, screen.height, screen.colorDepth, screen.pixelDepth, devicePixelRatio, innerWidth === 0,
      Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages.join('+'), navigator.hardwareConcurrency, navigator.platform || '', navigator.maxTouchPoints,
      ...qs.map((q) => { try { return matchMedia(q).matches ? 1 : 0; } catch { return 0; } })].join(','); };
  const glSig = () => { try { const gl = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl'); if (!gl) return 'none';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return [gl.getParameter(dbg ? dbg.UNMASKED_VENDOR_WEBGL : gl.VENDOR), gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER), gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), (gl.getSupportedExtensions() || []).length].join('|'); } catch { return 'none'; } };
  // the shielded surface, measured apart: draw a fixed scene and read the pixels back
  const readpxSig = () => { try { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const gl = cv.getContext('webgl'); if (!gl) return 'none';
    gl.clearColor(0.2, 0.4, 0.6, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.SCISSOR_TEST); gl.scissor(8, 8, 40, 24); gl.clearColor(0.9, 0.3, 0.1, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(64 * 64 * 4); gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let h = 0x811c9dc5; for (let i = 0; i < px.length; i++) { h ^= px[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); } catch { return 'none'; } };   // every byte, so the shield's blur is caught deterministically

  window.ff2fp = async () => { const fonts = fnv(fontSig()), media = fnv(mediaSig()), gl = fnv(glSig()), readpx = readpxSig();
    // the join key uses ONLY the surfaces the shield never touches -- installed fonts (measureText) and matchMedia/screen --
    // so it is identical with the shield off and on. The WebGL vendor/renderer (gl) and readPixels (readpx) ARE perturbed by
    // the shield when C32 is on; they are reported apart, not folded into the key, so the key stays stable.
    return { code: 'fp2-' + fnv([fonts, media].join('~')), fonts, media, gl, readpx }; };
})();
