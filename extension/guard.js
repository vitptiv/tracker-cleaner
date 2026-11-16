// Sign-in guard (C19) and pause (C18): when must the extension keep its hands off? Pure: the caller
// passes what is stored (guardUntil, pauseUntil: timestamps), the open tabs and the time.
const GUARD_MS = 5 * 60e3;   // the guard holds this long after the last sign-in page was seen
const SIGNIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'login.microsoftonline.com', 'login.live.com', 'appleid.apple.com'];
const SIGNIN_SEGMENTS = ['oauth', 'oauth2', 'authorize', 'signin', 'sign-in', 'login', 'sso', 'saml'];
const isSignIn = (url) => {
  let u; try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const seg = u.pathname.toLowerCase().split('/');
  return SIGNIN_HOSTS.includes(u.hostname) || (u.hostname === 'github.com' && seg[1] === 'sessions')
    || (u.searchParams.has('client_id') && u.searchParams.has('redirect_uri')) || seg.some((s) => SIGNIN_SEGMENTS.includes(s));
};
// tab: a sign-in page is the active tab of its window right now. guard: that, or one was seen less than
// GUARD_MS ago. A sign-in tab left in the background does not count (isSignIn is broad: any /login path),
// it only has the GUARD_MS from when it navigated there.
const holdNow = (stored, tabs, now) => {
  const tab = (tabs || []).some((t) => t.active && isSignIn(t.url || t.pendingUrl));
  return { paused: stored.pauseUntil > now, guard: tab || stored.guardUntil > now, tab };
};
if (typeof module !== 'undefined') module.exports = { GUARD_MS, SIGNIN_HOSTS, isSignIn, holdNow };
