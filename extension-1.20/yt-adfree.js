// YouTube ad remover (runs in the page itself, before YouTube's own scripts).
// YouTube sends its ads inside the same data as the video ("adPlacements", "playerAds", …), so blocking
// addresses isn't enough: we delete those fields from the data before the player reads them.
(() => {
  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams'];
  const strip = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 4) return o;
    for (const k of AD_KEYS) if (k in o) delete o[k];
    if (o.playerResponse) strip(o.playerResponse, depth + 1);
    if (Array.isArray(o)) for (const x of o) strip(x, depth + 1);
    else if (o.response) strip(o.response, depth + 1);
    return o;
  };
  // 1. data parsed from JSON (API responses)
  const parse = JSON.parse;
  JSON.parse = function (...a) { return strip(parse.apply(this, a)); };
  // 2. data embedded in the first page load
  for (const name of ['ytInitialPlayerResponse', 'ytInitialData']) {
    let v;
    try { Object.defineProperty(window, name, { configurable: true, get: () => v, set: (x) => { v = strip(x); } }); } catch {}
  }
  // 3. data fetched later (fetch().json())
  const json = Response.prototype.json;
  Response.prototype.json = function () { return json.call(this).then(strip); };
})();
