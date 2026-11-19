// The hidden collector (lab-only), F2-4: the scripted hand-off. Loaded first-party after the kit. When a hand-off link is
// clicked it records the click first-party (a fetch to the site's own /f/hop, which stands in for the stripped link
// ping) and then moves the browser on by a SCRIPTED navigation -- never an HTTP 302. So the shipped noteRedirect
// (onBeforeRedirect) never sees it, skip.js never engages, and there is no ping attribute for no-ping.js to remove.
// One site (atlas) instead hands off by a <meta refresh> page, which is the same to the cleaner.
(() => {
  const jump = (href, mid, from) => {
    try { navigator.sendBeacon('/f/hop', JSON.stringify({ m: mid, from, to: href })); } catch {}
    fetch('/f/hop', { method: 'POST', credentials: 'include', keepalive: true, body: JSON.stringify({ m: mid, from, to: href }) }).catch(() => {});
    location.assign(href);   // a scripted navigation: a fresh main_frame, not a redirect
  };
  window.ff2handoff = (mid) => { for (const a of document.querySelectorAll('a.ff2-out[href^="http"]')) {
    a.addEventListener('click', (e) => { e.preventDefault(); jump(a.href, mid, location.href); }); } };
})();
