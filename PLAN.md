# Tracker Cleaner: plan for 1.21

Source of 1.20: `~/Downloads/tracker-cleaner-1.20-source.zip` (a Chrome MV3 extension, top folder `chrome-cleaner/`).
Layout of this repo: `extension/` (the extension), `test/` (Node tests), `wifi-helper/` (local script), `PLAN.md`.
`git` is not installed on this machine: do not try to commit. Keep `extension-1.20/` as the untouched baseline copy instead.

## Why this work exists

1.20 cleans without asking, and it sometimes breaks Google sign-in. Goal: nothing destructive happens
unless the group is set to auto or the user pressed Approve; every group can be postponed; sign-in is never disturbed.

Findings in 1.20 (read from the code, not reproduced in a browser):

- `COOKIE_RE` deletes Google's own cookies the moment they are set: `NID`, `OTZ`, `1P_JAR`, `YSC`,
  `VISITOR_INFO1_LIVE`, `VISITOR_PRIVACY_METADATA`, `__Secure-YNID`, `__Secure-YEC`, `GPS`. Sign-in and reCAPTCHA use `NID`.
- The `li_` prefix in `COOKIE_RE` also matches `li_at`, LinkedIn's login cookie.
- Allow-list mode deletes every cookie not listed, including the short-lived state cookies of "Sign in with Google".
- The tab limit closes tabs at the 15-minute sweep and can close a sign-in tab.
- Tor mode, when on, makes Google challenge or refuse sign-in.
- `ON = false` does not stop cookie deletion, tab closing, cache clearing or Tor.
- All switches come from `http://127.0.0.1:8088/audit/limits.json`. When it is unreachable, cookie cleaning and request
  blocking stay on and YouTube stripping stays as last registered (it is only ever registered after a successful
  fetch), while tab limit, cache clearing, permanent drops and Tor do nothing (Tor stays as last set). That server does
  not answer on this machine, so the popup shows "No data" and there are no controls.
- `cookieClean: false` stops all cookie deletion, the cookie blacklist included.
- `KEEP_RE` beats tracker hosts: a keep-listed name such as `SID` set on `doubleclick.net` is kept.
- `build.js` needs `../security/trackers.js`, which is not in the zip.

## Capabilities

Mode: `auto` runs silently, `ask` queues for Approve / Postpone, `off` does nothing. IDs are stable.

| ID | Capability | Status in 1.20 | Default mode |
|---|---|---|---|
| C01 | Block requests to tracker domains | exists | auto |
| C02 | Block Google/YouTube ad and telemetry paths | exists | auto, never on sign-in pages |
| C03 | Delete third-party tracking cookies (live and 15-min sweep) | exists | auto |
| C04 | Delete Google/YouTube identity cookies (`NID`, `YSC`, ...) | bundled into C03 | ask |
| C05 | Strip YouTube ads from page data | exists | auto |
| C06 | Drop tracker site storage (localStorage, IndexedDB, service workers) | manual only | ask |
| C07 | Permanent drops and cookie blacklist | exists | ask |
| C08 | Allow and Revert decisions | exists | n/a |
| C09 | Block site permissions | exists | ask |
| C10 | Audit view: extensions, policies, remembered servers | read-only | n/a |
| C11 | Clear whole HTTP cache ("forget servers") | exists | auto |
| C12 | Allow-list mode: delete every cookie not listed | exists | off |
| C13 | Tab limit | exists | off |
| C14 | Route Chrome through Tor | exists | off |
| C15 | Report to local audit server; self-update | exists | off |
| C18 | Master switch and "Pause 10 min" that stop everything | new | n/a |
| C19 | Sign-in guard: pause all groups during a login flow | new | auto |
| C20 | Approve / Postpone queue per group, with badge count | new | n/a |
| C21 | Current-site panel: what was blocked or deleted here, with Allow | new | n/a |
| C22 | Undo: restore cookies deleted in the last 10 min | new | n/a |
| C23 | Strip tracking parameters from URLs (`gclid`, `fbclid`, `utm_*`) | new | auto |
| C24 | Remove saved Wi-Fi networks unused for 30+ days (local helper, `nmcli`) | new | ask |
| C25 | Stop a company on no list that is seen on 3+ sites with an ID (learned locally) | new in 1.24 | auto |
| C26 | Block pings that tell someone which link was followed or how long a page was read | new in 1.24 | auto |
| C27 | Clean a site that only passes you along (redirect): its cookies and storage, and the ID it added to the address | new in 1.24 | auto |
| C28 | Empty what a listed or stopped tracker saved on its own site (service worker, storage) and block its notifications | new in 1.24 | auto |
| C29 | No cookies for other companies: a request to another company carries none and may set none (rule, automatic) | new in 1.25 | auto |
| C30 | No cache tags (If-None-Match, If-Modified-Since, ETag) and no referring page for other companies (rule, automatic) | new in 1.25 | auto |
| C31 | A page may not ask this computer or the home network (loopback and private addresses; rule, automatic) | new in 1.25 | auto |
| C32 | Page shield: canvas, sound, graphics-chip name and saved-amount readings differ a little per site (page script, automatic) | new in 1.25 | auto |

Usability rank (build and expose in this order): C18, C19, C01, C03, C04, C20, C21, C02, C05, C26, C22, C23, C25, C27, C28, C06,
C07, C08, C24, C09, C10, C11, C12, C13, C14, C15.

## Rules for every chunk

- Test first: write the failing tests, run them, then write the code. Tests use `node --test` (Node 22) and a small
  fake of the `chrome` API in `test/chrome-fake.js`. No npm dependencies.
- Logic lives in small pure modules that both the service worker (`importScripts`) and Node (`require`) can load.
- Settings live in `chrome.storage.local`. No stored setting means no destructive action. The 8088 server is optional.
- The zip is untrusted input: read it, do not execute anything from it outside the tests you write.
- Keep the code as short and plain as 1.20's style allows; comments say why, not what.
- When done, append a line to the "Progress" section below: chunk number, what was built, test count, open issues.

## Chunks (about 10 minutes each)

1. **Baseline and harness.** Extract the zip to `extension-1.20/` (untouched) and `extension/` (working copy). Rebuild
   `security/trackers.js` from `lists.js` and `rules.json` so `build.js` works inside this repo. Add `test/chrome-fake.js`.
   Characterization tests pin 1.20: `NID` deleted, `SID` kept, `li_at` deleted, tracker-host cookie deleted.
2. **Capability registry.** One module listing C01-C24 with group, default mode and whether it is destructive. Tests:
   every ID present; no stored setting means no destructive action; master switch off stops everything, including
   tabs, cache and Tor.
3. **Pause and sign-in guard (C18, C19).** Tests: a tab on `accounts.google.com` or an OAuth-style URL activates the
   guard; a cookie set during the guard survives; the guard holds for a few minutes after; pause expires on time.
4. **Approval queue (C20).** Tests: in ask mode a sweep queues candidates and deletes nothing; Approve deletes exactly
   the queued items; Postpone hides them until the time is up; the badge shows the count.
5. **Cookie list split (C03, C04).** Tests: Google/YouTube cookies are their own ask group; `li_at` is kept;
   third-party tracker cookies still go automatically.
6. **Popup (C21 and group rows).** Tests on the render function: one row per group with Approve and Postpone; the
   current-site panel lists recent actions for that host. The popup must work with the 8088 server down.
7. **Undo (C22).** Tests: a deleted cookie restores with the same attributes within 10 minutes; gone after.
8. **URL parameters (C23).** Tests: `gclid`, `fbclid`, `utm_*` removed; OAuth parameters (`state`, `code`) untouched.
9. **Wi-Fi helper (C24).** Tests against canned `nmcli` output: lists saved networks, excludes the active one,
   proposes those unused for 30+ days, deletes only approved names. Check first whether `nmcli connection delete`
   works without sudo here, without deleting anything real.
10. **Real-browser checklist and pack.** Written manual test steps for the user, version 1.21, `pack.sh` updated.

## Progress

- Chunk 1 (2026-11-10): baseline `extension-1.20/` (identical to the zip) and working copy `extension/`; pure cookie decisions
  moved to `extension/core.js` (`makeCore(lists)` returns `S` settings + `shouldGo` etc.; `background.js` now uses it, `pack.sh`
  ships it); `lists.js` exports for Node; `security/trackers.js` rebuilt, `node extension/build.js` gives 1.20's `rules.json`
  byte-identical and `lists.js` plus one export line; `test/chrome-fake.js`; `package.json`. 22 tests pass (`npm test`, or
  `node --test "test/*.test.js"`: bare `node --test` also runs `chrome-fake.js` as a test file, harmless).
  Open issues: `background.js` itself is never run in Node (untrusted, top-level side effects), so its Chrome wiring is
  pinned only by a 3-line mirror of the live listener in `chrome-fake.test.js`; later chunks should move that wiring into
  testable modules. Correction to the findings above: with the 8088 server down only cookie cleaning, blocking and YouTube
  ad stripping stay on; tab limit, cache clearing, permanent drops and Tor do nothing (Tor stays as last set). Also
  `cookieClean: false` disables the blacklist too, and KEEP_RE beats tracker hosts (`SID` on doubleclick.net is kept).
- Chunk 1 follow-ups (2026-11-10): findings corrected above; `core.js` has `reason(c)` ('blacklist' | 'allowlist' | 'name' |
  'host' | null) and `shouldGo = !!reason`; `test/load-background.js` runs `background.js` in a `node:vm` context with the
  fake, a stub `fetch` and `importScripts`; `test/baseline-1.20.test.js` pins 1.20 end to end from `extension-1.20/`.
- Chunk 2 (2026-11-10): `extension/registry.js` (22 capabilities, `cap(id)`, `mayRun(id, settings)` -> 'run' | 'ask' | 'no');
  `background.js` gated at every action (cookies live and sweep, ruleset, YouTube scripts, cache, permanent drops,
  permissions, tabs, Tor, report, self-update), reacts to `chrome.storage.onChanged`; manifest has `storage`; fake has
  `storage.onChanged` and `contentSettings`. 45 tests pass.
  Rule chosen where plan and brief pulled apart: a destructive capability runs only with `master: true` stored; with
  nothing stored its default 'auto' counts as 'ask', while non-destructive ones (blocking, YouTube) run by default.
  Cookie capability by reason: blacklist -> C07, allow-list mode -> C12, name/host -> C03; when C07 / C12 do not run their
  lists are ignored and the normal rules judge the cookie.
  Open issues: nothing writes `master` yet, so until the popup (chunk 6) no cookie is deleted on a fresh install;
  'ask' is "do nothing" until chunk 4; C02 shares C01's ruleset and follows C01 (splitting needs a second ruleset or
  `updateStaticRules`); settings are read from storage at each action (simple, uncached); a C07/C12 mode change reaches
  the cookie lists at the next 1-minute refresh; the limits switches (`enabled`, `blocking`, `ytAds`, `drops`,
  `cookieClean`) can still turn things off; `popup.js` is untouched and still needs the 8088 server.
- Chunk 2 follow-ups (2026-11-10): rules split: `rules.json` (ruleset `trackers`, C01) and `rules-google.json` (ruleset
  `google-paths`, C02, every rule excludes `accounts.google.com` / `accounts.youtube.com` as initiator and as request
  domain); manifest declares both; `applyFeatures` gates each. `registry.js` exports `GROUPS` (12 popup rows in
  usability order; C19 moved to its own group `signin`).
- Chunk 3 (2026-11-10): `extension/guard.js` (`isSignIn(url)`, `holdNow(stored, tabs, now)` -> `{ paused, guard, tab }`,
  `GUARD_MS`); `registry.js` `gate(id, settings, hold)` -> 'run' | 'ask' | 'no' | 'held'; `background.js` asks one
  `can(id, cx)` everywhere (`cx = await context()`: stored settings + hold), arms `guardUntil` on `tabs.onCreated` /
  `onUpdated`, has `pause(minutes)` / `resume()` behind `chrome.runtime.onMessage` (`{ type: 'pause', minutes }`,
  `{ type: 'resume' }`) and a `resume` alarm. Loader has a test clock (`bg.now`), fake has tab helpers and `send`.
  65 tests pass.
  Decisions: while a sign-in tab is open `context()` re-arms `guardUntil` (at most once a minute), so the 5 minutes
  count from when the tab was last seen, not from when it was opened; during the guard the Tor proxy is left exactly
  as it is (neither set nor cleared); C19 set to off disables the guard; self-reload is skipped during the guard by an
  explicit check, since C15 is not destructive.
  Open issues: `isSignIn` is broad by specification (any `/login` path segment on any site holds cleaning for 5 min,
  and a tab parked on such a page holds it for as long as it stays open); cookies kept during a guard or pause are
  removed at the next sweep after it ends, sign-in cookies with tracker-like names (`NID`) included, until chunk 5;
  `context()` now also queries the tabs at every action (uncached); the manifest has no `tabs` permission, tab URLs
  are visible through `<all_urls>` host permission only: check in the real browser (chunk 10).
- Chunk 3 follow-up (2026-11-10): `holdNow` counts an open sign-in tab only while it is the active tab of its window
  (`t.active`); a sign-in tab parked in the background has just the 5 minutes of `guardUntil` from its navigation. The
  re-arming in `context()` follows (`hold.tab`), so it also only happens for an active tab.
- Chunk 4 (2026-11-10): `extension/queue.js` (`queueAdd`, `queueKeep`, `queuePostpone`, `queueRestart`, `queueCount`,
  `queueBadge`, `queueView`, `queueKey`, `QUEUE_MAX` 500); `background.js` queues whatever the gate answers 'ask' or 'held'
  (live cookies, sweep cookies, storage and permission drops, cache clear, tab closing) under `pending` in storage, has
  `approve(group)`, `postpone(group, minutes | 'restart')`, `state()`, `setMode(group, mode)`, `setMaster(on)` behind one
  `MESSAGES` table, and keeps the badge (`II` while paused). `pack.sh` ships `queue.js`. 86 tests pass.
  Decisions: each sweep makes the queue equal to what waits now (items whose capability now runs were carried out by
  that same sweep, cookies that are gone and groups switched off are forgotten, tab items are replaced), which is how a
  held auto item "goes at the first sweep after the hold"; a cookie item is `site` = cookie domain without the leading
  dot + `name`, and approve removes the cookies matching both that the same capability would still delete now;
  approve is refused when paused (`why: 'paused'`) or master is off (`why: 'off'`), works with nothing stored (fresh
  install: everything destructive asks), and never closes a sign-in tab; tab items carry the tab id as `name`; the
  blacklist is now loaded while C07 asks, and a blacklisted cookie that another running rule wants gone is still
  deleted (`judge`, `core.reason(c, noBlack)`); a group's mode in `state` is that of its first capability; the badge
  is also refreshed by the 1-minute alarm, so a postponement ends within a minute. Fake fix: `storage.local.get`
  returned live references, so an in-place edit followed by `set` fired no change event; it now returns copies.
  Open issues: C12 in ask mode queues nothing (it would queue every cookie); a cookie set after queueing with the same
  site and name is indistinguishable from the queued one (no values stored) and goes with the approval; with the 8088
  server down a sweep forgets queued storage, permission, cache and tab items until it is back; `forgetServers` stays
  set in limits.json unless C15 reports, so the cache item is queued again after every approval; the sweep's "queue =
  what waits now" will wipe items no sweep produces: chunk 9 (Wi-Fi) must exempt its kind; held items of auto groups
  count on the badge; `setMode` / `setMaster` act on the queue only at the next sweep.
- Chunk 4 follow-ups (2026-11-10): every queue change goes through `withQueue(fn)` in `background.js` (one promise
  chain; the 20-cookie burst test fails without it). C11 is local: `cacheClearedAt` in storage, the cache clear is
  offered (ask) or done (auto) at most once per 24 hours and no longer reads `forgetServers` from 8088; with nothing
  stored it is offered at the first sweep, so a fresh install shows it on the badge.
- Chunk 5 (2026-11-10): `security/trackers.js` has `GOOGLE_RE` (the nine Google/YouTube identity names, whole-name) and
  `COOKIE_RE` without them, `li_` narrowed to `li_sugr$|li_fat_id$|li_giant$`, `mp_` to `mp_.*_mixpanel$`; `build.js`
  writes `GOOGLE_RE` into `lists.js`; `core.reason` returns 'google' for those names on `google.<tld>`, `youtube.com`
  and subdomains (`isGoogleHost`), after name and tracker host, so `NID` on doubleclick.net or adservice.google.com
  stays C03 and the names on any other host are not matched; `background.js` maps 'google' to C04.
  `test/cookie-split.test.js` holds the new behaviour, including the motivating sign-in sequence. 103 tests pass.
  Decisions: the 1.20 pins (`characterization.test.js`, the last test of `chrome-fake.test.js`) now run today's
  `core.js` with the lists read from `extension-1.20/lists.js`, so they still prove the logic is 1.20's and only the
  lists changed; `makeCore` accepts lists without `GOOGLE_RE`; `build.test.js` compares the domain and keep lines
  with 1.20 instead of the whole file; `google.<tld>` is the pattern `google.(com?.)?xx[x]`.
  Open issues: `mp_mixpanel__c` (a real Mixpanel cookie) no longer matches; entries left alone that look risky:
  `test_cookie$` (generic name, sites use it to check that cookies work), `bcookie` / `lidc` (LinkedIn uses them at
  sign-in, deleting can bring a challenge), `MUID$` (also set by Microsoft sign-in hosts), `intercom-session-` (the
  logged-in chat session), `__hs` (also HubSpot's opt-out cookies), broad prefixes `amplitude`, `optimizely`, `AMP_`,
  `_cc_`, `_cs_`, `tuuid`; and the host rule deletes every cookie on product sites that are also in DOMAINS
  (`segment.com`, `optimizely.com`, `mixpanel.com`, `amplitude.com`, `braze.com`, `onesignal.com`, `adjust.com`), which
  logs their own customers out of the dashboards.
- Chunk 5 follow-ups + chunk 6 (2026-11-10): C01 rule has `domainType: 'thirdParty'`; `core.firstParty(c, hosts)`: a cookie whose
  only reason is 'host' is neither removed nor queued (nor approved) while a tab is on that tracker domain's own site;
  `onInstalled` stores `cacheClearedAt` when absent. Popup: `popup-view.js` (`renderPopup(state, tab)`, pure), `popup.js`
  (thin, controls carry their message in `data-msg`), `popup-audit.js` (1.20's audit view, moved unchanged, collapsed, only
  when 8088 answered). `background.js`: `why()` wraps `core.reason` with the exceptions; action log (`log`, ring of 200,
  `logAdd` in `queue.js`, same serial chain; a waiting item is logged once); messages `allow`, `revertAllow`, `siteOff`
  (dynamic `allowAllRequests` rules, priority 2); `state()` adds `now`, `log`, `allow`, `sitesOff`. Manifest:
  `declarativeNetRequestFeedback`. 131 tests pass. Not loaded in a browser.
  Decisions: site-off spares blacklisted cookies too; popup adds "Your exceptions" (Revert / Clean again) to undo both.
  Open issues: `thirdParty` compares registrable domains, so `adservice.google.com` on google.com, `bat.bing.com` on
  bing.com, `px.ads.linkedin.com`, `stats.wp.com` etc. are no longer blocked on their parent sites (fix: a second rule
  without `domainType` for the subdomain entries); third-party cookies are logged under their own domain, so "This
  site" lists only this site's cookies; "Ask first" on the sign-in guard row means off; a mode or master change reaches
  the queue only at the next sweep, so "Turn on" leaves the counts stale for up to 15 min.
- Chunk 6 follow-ups (2026-11-10): `build.js` writes two C01 rules, split by label count (two labels: `thirdParty`; more:
  blocked everywhere); `setMaster`, `setMode`, `allow`, `revertAllow`, `siteOff` run a sweep before replying; `state()` gives
  each group `ask` (false when nothing in it is destructive: signin, blocking, params, server) and the popup then offers
  only On / Off, since 'ask' there acts as off; live cookie log entries carry `page` (host of the active tab of the
  last-focused window) and "This site" also lists those, marked "set while you were on this site".
- Chunk 7 (2026-11-10): `extension/undo.js` (`undoKeep`, `undoLive`, `cookieDetails`, 10 min, 300 cookies); `remove()` in
  `background.js` keeps every removed cookie whole in `chrome.storage.session` (`undo`), purged at each sweep and on the
  1-minute alarm; messages `restore` (site, name) and `restoreAll`; a restored cookie is allowed first, then set;
  `state()` gives `undo: [{ t, site, name }]` without values; popup: "Removed in the last 10 minutes: N" + "Restore all",
  "Undo" on removed entries. Fake has `storage.session` and full attributes on preloaded cookies. `test/undo.test.js`.
  Decisions: the same cookie removed again replaces its older copy; undo writes go through the serial chain.
  Open issues: a restored blacklisted cookie is removed again (allow does not beat the blacklist); "Restore all" adds one
  exception per cookie; the audit view's own "Drop" (popup-audit.js) bypasses undo and the log; a sweep from a popup
  message can overlap the 15-minute one; `storage.session` behaviour is unverified until chunk 10.
- Chunk 8 (2026-11-10): `URL_PARAMS` (27) in `security/trackers.js` and `lists.js`; `rules-params.json` (ruleset `url-params`,
  one `queryTransform.removeParams` redirect, `main_frame`, sign-in hosts of guard.js excluded: `SIGNIN_HOSTS` exported);
  `applyFeatures` gates it by C23 alone (not the server's `blocking` switch); C23 moved to its own group `params`
  (13 popup rows); `core.stripParams(url)` mirrors the rule for the tests (`test/params.test.js`). 152 tests pass.
  Open issues: sign-in pages on other hosts (any `/login`, `/oauth` path) are not excluded, only protected by the list
  holding no sign-in parameter; sites switched off in the popup are exempt (their `allowAllRequests` rule wins); DNR
  matches parameter names exactly and case-sensitively, `stripParams` does the same but is not the rule itself.
- Chunks 7-8 follow-ups (2026-11-10): `remove(c, undo)`: a cookie removed for the blacklist (sweep, live, approval) is not
  kept for Undo, and its log entry (cap C07) shows "on your always-drop list" instead of Undo / Allow; message `drop`
  (kind, site, name, perm) does the audit view's drops in `background.js`: refused while paused or switched off, logged
  (cookie C10, storage C06, permission C09, cache C11), cookies kept for Undo; `popup-audit.js` calls no destructive
  Chrome API any more; `sweep()` runs one at a time, requests during a run share one follow-up run. `test/drop-sweep.test.js`;
  161 of my tests pass (`test/wifi*.test.js`, chunk 9 by another agent, fail until `wifi-helper/` exists).
  Open issue: a drop is also refused with the master switch off, which was not asked for (same rule as approve).
- Chunk 9 follow-ups, C24 wiring, chunk 10 (2026-11-10): helper: a Wi-Fi row with an unreadable timestamp stays in `list`
  (`lastUsed: null`, never a candidate, refused "last use unreadable"; an unclear ACTIVE counts as in use); `remove` and the
  CLI refuse everything unless `canDelete` is 'yes'. Extension: `nativeMessaging`; `wifiHelper(msg)` in `background.js`
  (host `com.tracker_cleaner.wifi`, null when missing or erroring); `wifiSweep` queues the helper's candidates as kind
  'wifi' under `wifi` and stores `wifi: { helper, canDelete }` for the row; `approve('wifi')` sends the queued UUIDs to
  `remove` and logs each as removed or "kept: reason"; `noAuto` in `registry.js` makes a stored 'auto' ask. Fake has
  `runtime.sendNativeMessage` (`native`); `test/wifi-background.test.js` runs the real `host.js` on a fake nmcli.
  Manifest 1.21 with new description and title; `pack.sh` prints the load-unpacked steps when there is no key;
  `test/pack.test.js`; `TESTING.md`; `README.md`. 216 tests pass.
  Open issues: nothing was run in a browser (TESTING.md lists what is unverified); with `canDelete` not 'yes' the networks
  still queue and count on the badge (Postpone or Off only); while paused the queued networks are kept unrefreshed; the
  helper is asked at every sweep, also on a fresh install; an unpacked copy has its own id, which `install.sh` needs.
- Real-browser run (2026-11-12): `test/browser/run.js` (`npm run test:browser`, not in `npm test`) starts its own headless
  Chrome 157 with a fresh profile (`--remote-debugging-pipe --enable-unsafe-extension-debugging`), loads `extension/` with
  the DevTools method `Extensions.loadUnpacked` and runs 13 checks plus a second run for Postpone; all pass. No error in
  the service worker or popup; all 17 rules taken; tab URLs readable without `tabs`; `storage.session`, `getMatchedRules`,
  the dynamic rules and the missing-helper path work.
  Bug fixed: "Don't clean on this site" did nothing for the page already open (Chrome applies `allowAllRequests` only to
  frames loaded afterwards): `siteOff` now adds a second rule per host, `allow` with `initiatorDomains` (ids 2i+1, 2i+2);
  `chrome-fake.js` got `passes(host, { reloaded })` with that behaviour. 216 tests pass.
  Open issues: a restored cookie that was set over https comes back with source scheme NonSecure (`cookieDetails` builds an
  http URL for a non-secure cookie; attributes are equal); the popup prints one red console line for the absent 8088
  server; not covered: a real sign-in, "Sign in with Google", YouTube playback, Allow, the helper installed.
- 1.22 step 1, inspector for cookies (2026-11-12): `tools/inspect.js <what> [--list] [--raw] [--json] [--profile] [--cache]`,
  one file with a table of blocks; `test/fixtures/build.js` builds the fake profile, `test/inspect.test.js`. SQLite is read
  through python3 (`mode=ro&immutable=1`) everywhere, `--raw` prints that one-liner. Without `--profile` it takes the profile
  whose `Preferences` lists this `extension/` folder. 224 tests pass.
  Open issues: the user's exceptions, the modes and what was removed earlier live inside Chrome (compressed LevelDB) and are
  not read, so the third line is "Would be removed" by the built-in lists; "locked" cannot happen with `immutable=1`, the
  tests cover a missing and an unreadable file.
- 1.22 step 2, inspector for cache, code-cache, storage, servers, permissions, tor, wifi (2026-11-12). 235 tests pass; each
  block and its `--raw` was run once, read-only, on the real profile.
  Open issues: storage kinds are only "database" (an IndexedDB folder) or "other storage"; the captcha list is ten host names
  in `tools/inspect.js` (reCAPTCHA on google.com cannot be told by host); the cache has no per-site or captcha breakdown yet;
  the `--raw` for the cache is `find` with `awk`, not `du` (du also counts folders); "Chrome is set to use Tor" is read from
  `extensions.settings.*.preferences.proxy` in `Preferences`, a shape not yet seen in a real profile; DNS and VPN lines are
  left out.
- 1.22 step 3, loop breaker and popup fixes (2026-11-12): `extension/loop.js` (5 removals of one cookie within 10 minutes hold
  it for 24 hours; `judge` then answers 'ask' with the reason "this site keeps putting it back"; storage key `loops`); the
  state has `looping` per group, `server` and, for the cache, `nextAt`; popup: "300+", the cache line, the loop line, and
  no request to the 8088 server unless the worker got an answer from it. `test/loop.test.js`. 247 tests pass.
  Open issues: no Chrome API tells an extension the size of the HTTP cache, so the row shows a size only if the state ever
  carries one (it does not); every removal counts, an approved one too; "Nothing pending" and "Approve cleaning (n)" still
  break the wording rules, left for the popup rows of step 5; the worker's own requests to 8088 still print red lines there.
- 1.22 step 4, private history (2026-11-12): `extension/history.js` (storage key `history`: counts per local day and group,
  per cookie `first`, `last`, `n`; 30 days, the 500 latest cookies, keys of at most 120 characters); messages `history` and
  `clearHistory`; every message is now answered only when its sender is one of the extension's own pages. Manifest 1.22.
  `test/history.test.js`; the harness got `storage.sync`, `runtime.id`, a sender for `send`, and `new Date()` in the worker.
  257 tests pass; `npm run test:browser`: all 14 checks pass.
  Open issues: "Clear history" is a message, the button belongs on the page (step 5); `first` is the first removal, the
  extension does not see a cookie earlier than that.
- 1.22 review follow-ups on steps 1 to 4 (2026-11-12): `inspect.js tor` has a line "Your internet provider can see:" from
  `resolvectl status` (DNSOverTLS, resolver address) and `ip -br addr` (tun, wg, ppp, tailscale up), addresses masked
  unless `--full`; it no longer reads `Preferences` to guess whether Chrome uses Tor and says in one sentence that only
  the extension's page can check Chrome. Each test file builds its own fixture folder (`build.js` `.at(name)`).
  Open issues: with Tor running the line names both paths, because the command cannot know which one Chrome takes;
  Chrome's own "Use secure DNS" setting is not looked at.
- 1.22 step 5, the page with cookies, saved copies, site storage and Tor (2026-11-12): `extension/history.html`,
  `history-view.js` (pure `renderHistoryPage(state)`), `history-page.js`; the popup has the link "See everything and
  its history", per row "N removed today" and "Copy command", and buttons that say what they do ("Remove 2 cookies",
  "Close 4 tabs"; "Nothing waiting"). "Clear history (N days)" is on the page. The Tor check is a button; one request
  to check.torproject.org per press. `test/history-view.test.js` holds the page's words against the inspector's.
  Open issues: an extension cannot see the size of the cache or which sites keep data, so those lines point to the
  command; the popup's group titles ("HTTP cache", "Tor") still put the technical name first.
- 1.22 step 6, real-Chrome verification (2026-11-12): a third run in `test/browser/run.js`, checks V1 to V6
  (`TC_VERIFY=1` runs only these); every "to verify" above now reads "Found". In short: per-site cache clear works; cache
  keys and headers are plain text; the code cache, the remembered servers and the visit-made HSTS entries go with the
  cache clear; no favicon type, favicons go with history; the storage quota is a fixed 10 GB; `getMatchedRules` keeps a
  match after its tab closes. Decided: B6 not shown, B3, B7 and B8 not on the page. No new cleaning was built.
  Open issues: the five-minute limit of `getMatchedRules` was not waited for; `TransportSecurity` is not written within
  minutes, so the HSTS answer comes from `chrome://net-internals`. The system disk had 227 MB free: set `TC_BROWSER_TMP`.
- 1.22 step 7, the page's remaining blocks (2026-11-12): code cache, remembered servers, permissions, blocked requests
  (the count Chrome still has, by site, no command) and Wi-Fi; nine blocks in all. The inspector's `code-cache` and
  `servers` now say both go with the saved copies of pages. 281 tests pass.
  Open issues: no rule counts in the blocking block; the inspector has no block for favicons, history or cache tags.
- 1.22 step 8, browser checks for the page (2026-11-12): checks 14 to 17: the page opens from the popup's link and shows
  this run's removals under today; nothing leaves the page on opening; the Tor button sends exactly one request and the
  answer is "not Tor"; example.com can neither fetch, frame nor message the page; "Clear history" empties it.
  `npm run test:browser`: all 24 checks pass (1 to 17, 7b, V1 to V6).
  Open issues: the page was tested as a tab opened by a script's click, and the copy buttons were not pressed there.

## Todo for 1.22 (all eight steps are built, see Progress)

Written 2026-11-12 from the user's requests after trying 1.21. Every block below has the same three parts:
**Clean** (what the extension removes, and in which mode), **Show** (what the extension's own page shows: now and
history) and **Command** (a terminal command that reads Chrome's own files, independent of the extension).
"To verify" marked a claim nobody had checked; each was looked at in a real Chrome on 2026-11-12 (`npm run test:browser`,
checks V1 to V6, Chrome 157 headless, fresh profile) and now reads "Found:", with "clean possible" or "show only".

Facts from the read-only look at this machine (2026-11-12): the profile is `~/.config/google-chrome/Profile 1`,
extension id `bnejmnaojaiobbkjfhmfcljlbjedmgag`; 1,469 cookies on 388 hosts; HTTP cache 778 MB in 38,586 files under
`~/.cache/google-chrome/Profile 1/Cache`, code cache 245 MB; 500 remembered servers; no saved Wi-Fi; Tor not installed,
no VPN, DNS to the router unencrypted. Tools: python3 with sqlite3 and `jq` work; the `sqlite3` command is missing;
`node:sqlite` needs `--experimental-sqlite`. Databases must be opened read-only with `immutable=1`. The cookie file
lags the browser by up to 30 s; open tabs cannot be read from disk.

### Cross-cutting pieces

- **T1 Inspector command.** `tools/inspect.js <block> [--raw]`: what is there now, sorted into would remove / kept /
  allowed by the extension's own lists; `--raw` prints the plain underlying command. Test-driven on fixture files.
- **T2 Private history.** Bounded store in `chrome.storage.local`: per-day counts per group, per-cookie counters
  (first seen, last removed, times removed), 30 days, "Clear history" button, no values. Tests: not in `storage.sync`,
  not in any report to 8088, no `web_accessible_resources`, no `externally_connectable`, messages refused from any
  sender that is not one of the extension's own pages.
- **T3 "Now and history" page.** An extension page opened from the popup, one section per block below. Each popup row
  gets its numbers (there, kept, removed today) and a "Copy command" button.
- **T4 Loop breaker.** A cookie removed and set again several times within a few minutes is no longer deleted; it
  moves to ask and the row says so. Found in use: `google.com NID` removed 30 times in 9 minutes with the Google row
  on Automatic.
- **T5 Popup fixes.** "Removed in the last 10 minutes" shows "300+" at the buffer cap; the cache row shows size and
  when it is next offered instead of "Nothing pending"; silence the red console line for the absent 8088 server.

### Blocks

**B1 Cookies (C03, C04, C07, C12)**
- Clean: as in 1.21, plus T4.
- Show: total, would remove by reason, kept by reason (keep-list, allow, site off), removed per day, repeat offenders.
- Command: python3 sqlite3 on `Profile 1/Cookies`, `select host_key, name from cookies`, classified by `core.js`.

**B2 HTTP cache (C11)**
- Clean: whole-cache clear, ask, at most once per 24 hours (1.21). Per-site cache clear. Found (V1): `browsingData.remove`
  with `origins` and `cache` removed the copy of example.com and left the one of example.org: clean possible. Not built.
- Show: size, file count, age of the oldest entry, top sites by size, and which captcha and bot-detection providers
  have entries (reCAPTCHA, hCaptcha, Cloudflare, Arkose, DataDome, PerimeterX: list to be written).
- Command: `du` and `find` on the cache folder; per-site breakdown needs the cache key parsed from each entry file.
  Found (V2): the key is plain text in the entry file, `1/0/_dk_<top site> <frame site> <address>`. The breakdown is not built.

**B3 Cache tags used as identifiers (ETag, Last-Modified)**
- Clean: nothing separate; they go with the cache entry (B2).
- Show: number of cached entries from tracker and captcha hosts that carry a validator tag, since each can be read
  back by its server at the next visit.
- Command: scan the entry files' stored response headers for `etag:` on those hosts. Found (V2): the header block is
  plain text (`HTTP/1.1 200`, `last-modified:`, `cache-control:`; 9 of 146 files had `etag:`). Show only, and only by a
  command: an extension cannot read these files, so the page has no block for it. The command is not built.

**B4 Code cache (compiled JavaScript and WebAssembly)**
- Clean: with B2. Found (V6): the whole-cache clear emptied it (38 files to 0): clean possible, and it already
  happens. The inspector and the page say so.
- Show: size and file count.
- Command: `du -sh ~/.cache/google-chrome/Profile\ 1/Code\ Cache`.

**B5 Site storage of trackers and captcha providers (C06)**
- Clean: as in 1.21 (ask), with the captcha and bot-detection providers named as their own sub-list so the user sees
  that removing them means more challenges.
- Show: per site which kinds exist (localStorage, IndexedDB, service worker, cache storage), tracker or captcha
  marked, removed history.
- Command: python3 sqlite3 on `Profile 1/WebStorage/QuotaManager` (table `buckets`), `ls Profile\ 1/IndexedDB`.
  Limit: LevelDB files are compressed, so a plain string scan of localStorage undercounts.

**B6 Storage totals (what a script learns from asking how much space it has)**
- Clean: nothing to clean.
- Found (V3): Chrome 157 tells a page a quota of 10 GB on a 20 GB disk and on a 1.5 TB disk alike, so it no longer gives
  the disk's size away. Not worth showing: no block on the page.
- Show (as planned, dropped): usage and quota as a page would see them, with one line on what the quota reveals.
- Command: `df -h` on the profile's filesystem, beside the profile folder's own size.

**B7 Favicon cache**
- Clean: found (V5, V6): `browsingData` has no type for favicons; clearing `history` emptied them (2 icons to 0). So they
  go only with the history (B8), which is not built: show only.
- Show: number of stored icons and of sites they belong to. An extension has no way to count them, so not on the page.
- Command: python3 sqlite3 on `Profile 1/Favicons`. Found: tables `favicons`, `favicon_bitmaps`, `icon_mapping`, `meta`.
  Not built.

**B8 Browsing history and visited links**
- Clean: `browsingData` history, default off, ask only, never automatic: it is the user's own record. Found (V6):
  it works (5 addresses to 0, favicons with them): clean possible. Not built.
- Show: counts only (URLs, visits, oldest entry). No list of URLs on the page. Decided: not on the page at all, because
  counting needs the "history" permission, which would let the extension read every address visited.
- Command: python3 sqlite3 on `Profile 1/History`, counts only by default, a flag to list hosts.

**B9 Remembered servers and forced-HTTPS list**
- Clean: remembered servers go with the cache clear (B2). Found (V6): 25 servers to 0, and the forced-HTTPS (HSTS)
  entry a visit to www.iana.org had added was gone after the same cache clear (asked on `chrome://net-internals`, the
  file is written too late to read). Clean possible, and it already happens with B2; the inspector and the page say so.
- Show: number of remembered servers and how many are on the tracker list.
- Command: `jq '.net.http_server_properties.servers | length' "Profile 1/Network Persistent State"`; the HSTS file
  stores hashed hosts, so only a count.

**B10 Site permissions (C09)**
- Clean: as in 1.21 (ask).
- Show: each site with a permission and its value; changes over time.
- Command: `jq .profile.content_settings.exceptions "Profile 1/Preferences"`. Limit: written lazily by Chrome.

**B11 Request blocking and link parameters (C01, C02, C05, C23)**
- Clean: not applicable; these prevent rather than remove.
- Show: blocked requests per site per day, the rule lists. Found (V4): `getMatchedRules` still lists a match after its
  tab is closed (tab id -1; Chrome documents five minutes, not waited for), and nothing older. So the page shows the
  count Chrome still has, by site, and says there is none per day. Show only.
- Command: `jq` on `extension/rules.json`, `rules-google.json`, `rules-params.json`. What was blocked is known only
  inside the browser, so no command for that.

**B12 Tor and VPN (C14)**
- Clean: not applicable.
- Show: the address and "is this Tor" answer as seen from inside Chrome, beside the direct one; DNS resolver; a plain
  warning when Tor is selected but not running. Today: Tor is not installed, the computer is seen directly.
- Command: `curl -s https://check.torproject.org/api/ip` directly and with `--socks5-hostname 127.0.0.1:9050`;
  `resolvectl status`; `ip -br addr` for a VPN interface. A terminal check proves the Tor service, not that Chrome
  uses it; the page's own check covers Chrome. Needs `sudo apt install tor` by the user to test for real.

**B13 Saved Wi-Fi networks (C24)**
- Clean: as in 1.21 (ask, through the helper).
- Show: saved networks with last use; none on this machine.
- Command: `nmcli -t -f NAME,UUID,TYPE,TIMESTAMP connection show`.

### Order (about 10 minutes each)

1. T1 with B1.  2. T1 for B2, B4, B5, B9, B10, B12, B13.  3. T4 and T5.  4. T2.  5. T3 with B1, B2, B5, B12.
6. Verify the "to verify" items in a real Chrome and decide B3, B6, B7, B8.  7. T3 for the remaining blocks.
8. Browser checks for the page and the privacy rules.

### Wording rules (the reader is not a developer)

- Say what a thing is in everyday words first, the technical name second and only if useful: "Saved copies of pages
  (HTTP cache)", "Small files sites leave to recognise you (cookies)", "Remembered Wi-Fi networks".
- Every block answers three questions in this order, in one short line each: what is there now, what was kept and
  why, what was removed and when. Numbers before lists; lists are collapsed until asked for.
- Every block ends with one line "What happens if you clean this", for example "Sites load slower for a day" or
  "You will be asked to prove you are human more often".
- No codes (C03, B2) on screen; they stay in the code and this file. No word "pending" without a number beside it.
- The command line gives the same three answers in the same words, as plain aligned text, no JSON unless `--json`.
- A button says what it does and to how many things: "Remove 12 cookies", never just "Approve".

### Tests first, per step

Fixtures live in `test/fixtures/profile/`, a small fake Chrome profile built by a script in the tests (a real SQLite
`Cookies` file made with `node:sqlite` or python3, a `Preferences` JSON, a `Network Persistent State` JSON, a cache
folder with a few entry files). No test reads the user's real profile. The inspector takes `--profile <dir>` and
`--cache <dir>`; without them it finds the profile that has this extension loaded.

1. **Inspector, cookies.** Fixture with a tracker-name cookie, a tracker-host cookie, a Google identity cookie, a
   kept sign-in cookie and an ordinary one: each lands in the right line with the right reason; totals add up; no
   value is ever printed (the fixture's values are a marker string the test searches the output for); `--raw` prints
   a command that runs and returns the same host and name pairs; a locked or missing database gives one plain
   sentence, exit code 1, no stack trace.
2. **Inspector, other blocks.** Cache: size, file count and oldest entry match the fixture. Servers and permissions:
   counts match the JSON. Storage: sites and kinds match. Wi-Fi: uses the existing `wifi-helper` parser with a fake
   runner. Tor: with a fake fetch, "not installed", "running but Chrome not using it" and "working" each give their
   own plain sentence, and the direct address is masked unless `--full`. Every block: `--raw` exists and runs.
3. **Loop breaker and popup fixes.** With the clock: a cookie removed and set again 5 times within 10 minutes is not
   removed the sixth time, is queued under its group with the reason "this site keeps putting it back", and the state
   says so; a cookie removed twice a day is unaffected; the breaker forgets after 24 hours. Popup view: "300+" at
   the cap, the cache row shows size and next offer time, no console error when 8088 is absent.
4. **Private history.** Counts per day and per cookie are right after a scripted day; entries older than 30 days
   go; the store stays under a fixed size after 10,000 removals; no value string anywhere in storage; nothing in
   `storage.sync`; a report to 8088 (C15 on) contains no history; the manifest has no `web_accessible_resources`
   and no `externally_connectable`; a message from a content-script sender or another extension id is refused;
   "Clear history" empties it.
5. **Page, first four blocks.** `renderHistoryPage(state)` is pure: each block shows the three lines and the "what
   happens" line; lists are inside collapsed sections; hostile strings are escaped; no capability code appears in
   the output; the copy button carries exactly the command the inspector prints for that block.
6. **Real-Chrome verification.** Added to `test/browser/run.js`: each "to verify" item becomes a check that reports
   what Chrome really does; the outcome is written back into the block above (clean possible or show only).
7. **Page, remaining blocks.** As step 5, for the blocks step 6 decided are worth showing.
8. **Browser checks.** The page opens from the popup, shows a removal made in the same run under the right day,
   a web page cannot fetch or frame the page, and "Clear history" works.

## Todo for 1.23: the report, modelled on Kitesurf's report bar (all eight steps are built, see Progress below)

Written 2026-11-15. The user's own browser (`/mnt/d/workspace/kitesurf-browser`, journal page
`kitesurf-vs-chrome.html`) has a report bar under the page that the user finds far richer than this extension's
popup. 1.23 brings the extension's report up to it. The repo is now under version control through `./git.sh`
(dulwich; there is no `git` binary): commit at the end of every step.

What Kitesurf's report bar shows (from the user's screenshot of it on google.com):

1. **Top line:** the name, one on/off switch, "Pause 10 min", the state in a word ("on"), "Undo (0)", "Clear saved
   copies".
2. **Waiting line:** "Google identity cookies: 1 waiting: NID on .google.com" with Approve, Postpone, Show.
3. **"What this browser does for you":** one row per feature: its name, one sentence in plain words, its state
   ("on", "asks first") and a live count ("3 blocked", "0 stripped", "0 deleted, 1 waiting").
4. **Cookies in full:** where they are kept and when the list was read, Refresh, Delete all, Hide; "See this list in
   a terminal" and "Delete it yourself", each a command with Copy; then one row per cookie: site, name, the start of
   its value, expiry, what it is and why it is kept ("login, kept (name is on the keep list)", "other"), with
   Delete, Keep, Always delete, Show full, Copy.
5. **Kinds of stored data:** Cookies, Local storage, Session storage, IndexedDB, Cache: what each is, where it
   lives, how many on this site and in total, the command to see it, Copy and Show.

What the extension has today against that: 1 and 2 exist in the popup; 3 exists without counts and without the
sentence; 4 and 5 exist only as collapsed lists on the separate page, with no values, no per-item buttons and no
"where it lives".

Decisions taken here:

- **Where it shows.** Chrome's side panel (`sidePanel` permission, `report.html`): it stays open beside the page and
  follows the tab, which is the nearest thing to a bar under the page. The popup keeps the switch, Pause, the
  waiting lines and a "Open the report" button. To verify in the real browser: that the panel can be opened from the
  popup button and that it is told when the active tab changes.
- **Values are shown, never kept.** This reverses the 1.21 rule "never show a value" for the screen only: a value is
  read live when the report is drawn, cut to 24 characters, shown in full only after "Show full", and never written
  to storage, the history, the queue or any report. The existing no-value-in-storage tests stay and gain the report.
- **"Always delete" becomes local.** Today that list comes only from the absent 8088 server. It moves to
  `chrome.storage.local` beside the allow list, with 8088's list merged in when the server answers.
- **"Delete it yourself" from a terminal is not offered** for cookies: Chrome's cookie file cannot be changed safely
  while Chrome runs. The row says so in one sentence instead of giving a command that would not work.
- **Tor row** (found 2026-11-15: the switch does nothing here, since it waits for 8088 and Tor is not installed):
  works without 8088; before routing it checks that the Tor port answers and otherwise leaves Chrome alone and
  says "Tor is not running on this computer; nothing is routed"; the row shows "Routed over Tor: yes, websites see
  ..." or "No". Needs `sudo apt install tor` by the user to test for real.

### Steps (about 10 minutes each), tests first

Wording rules above apply. Everything the report prints is built by one pure function,
`buildReport(state, tab)` returning plain data, and one pure `renderReport(report)` returning HTML; tests are on
both, with the exact sentences.

1. **Feature rows with sentences and counts.** `registry.js` gains one plain sentence per group (Kitesurf's wording
   as the model: "Pages are stopped from calling the companies that follow you from site to site."). `buildReport`
   gives each row its state word and count for this tab's site: blocked (matched rules of the two blocking
   rulesets), stripped (matches of the link rule), deleted today (history), waiting (queue). Tests: each count
   from a scripted state; a row with nothing shows "0 blocked", not an empty cell; state words are "on",
   "asks first", "off", "paused", "held while you sign in".
2. **Cookie rows.** For the tab's site, live from `chrome.cookies.getAll`: site, name, value cut to 24 characters,
   expiry as a date, and a class with its reason from `core.reason` and the keep list: "login, kept (name is on
   the keep list)", "tracker, deleted automatically", "Google identity, asks first", "other, kept". Tests: every
   class; a cookie both kept and on a tracker host says kept and why; hostile names and values are escaped; after
   building and rendering a report, no value string is anywhere in `storage.local`.
3. **Cookie buttons.** Delete (goes through the existing drop path, so pause, log and undo apply), Keep (allow
   list), Always delete (the new local list), Show full, Copy, and "Delete all on this site" with the number on the
   button. Tests end to end through `load-background.js`: each button's effect; Always delete beats Keep's
   absence but a later Keep removes it from the always list; Delete all leaves kept sign-ins alone unless the
   user ticks "also the ones that keep me signed in".
4. **Kinds of stored data on this page.** Local storage, session storage, IndexedDB, cache storage, service
   workers: counted in the tab on demand with `chrome.scripting.executeScript` (keys only until "Show"), with "what
   it is", "where it lives" and the inspector command for each. Tests with the fake: counts and sentences; a page
   that refuses scripts (chrome://, the web store) gives "Chrome does not let extensions look at this page"; Show
   lists keys with values cut to 24 characters; nothing read is stored.
5. **The side panel.** `report.html`, `report-view.js`, thin `report-page.js`; top line (switch, Pause, state word,
   "Undo (N)", "Clear saved copies"), the waiting lines with "Remove N", Postpone, Show; Refresh with "read at
   HH:MM:SS"; redraws when the active tab or its address changes. Tests on `renderReport`; pack test covers the
   new files.
6. **Inspector parity.** `tools/inspect.js cookies --site <site>` and `storage --site <site>` print the same rows
   in the same words as the panel, values left out unless `--values` (then cut the same way; note that values on
   disk are encrypted, so say "not readable from the file" where that is so). The panel's Copy buttons carry
   exactly these commands. Tests on the fixture profile.
7. **Tor row.** As decided above. Tests with a fake port check: not running, running, switched off again; the 8088
   server absent in all three.
8. **Real-Chrome checks** added to `test/browser/run.js`: the panel opens and follows the tab; counts move when a
   tracker is blocked; a cookie's value shows cut and in full; the five buttons work on a real cookie; storage
   kinds are counted on a page that sets some; the Tor row says "not running" here. Then TESTING.md and the
   journal page get a short 1.23 section.

### Progress for 1.23

- **Step 1, feature rows** (8 tests, 290 in all). `registry.js`: one sentence per group (`says`), carried by `state()`.
  New `extension/report-view.js` with the pure `buildReport(state, tab)` and `renderReport(report)`; `tab` is
  `{ id, host, matched }`, `matched` = the ruleset id of each matched rule (the page gets it from
  `declarativeNetRequest.getMatchedRules`). Open: "deleted today" and "waiting" are for the whole group, not this
  site (the history keeps one number per group and day; the queue view holds only the newest 20 items). The link
  count reads "N links cleaned on this page", not "stripped". Rows with nothing to count (sign-in, Tor, reports)
  show the state word only.
- **Step 2, cookie rows** (10 tests, 300 in all). Message `cookies { host }`: the cookies of the site, the sites above
  and below it, each value cut to 24 characters in the background script. Each row says what the cookie is and what
  happens to it, following the switches ("has a tracker's name, deleted only after you say so"), not the fixed
  strings of the step text, which would be untrue when a group asks first, is off or is paused. The Copy button
  carries `node tools/inspect.js cookies --site <host>`, which step 6 has to build.
- **Step 3, cookie buttons** (17 tests, 317 in all). Messages `always { site, name, on }`, `cookieValue { site, name }`,
  `dropSite { host, signins }`; Delete is the existing `drop`. `storage.local.always` is the local always-delete
  list, merged with 8088's in `refreshBlacklist`. Open, for the owner: the list is still governed by C07, which asks
  first by default, so "Always delete" deletes at once but the cookie waits in the queue when it comes back, until
  that group is set to automatic. "Delete all" also deletes cookies the user chose Keep (they stay on the list).
  Left to the page (step 5): `data-act="full"` / `"copy"` show or copy the reply's `value`; the box
  `data-also="signins"` adds `signins: true`. Manual deletes are logged under C10, so no feature row counts them.
- **Step 4, kinds of stored data** (12 tests, 329 in all). Message `stored { tabId, show }` runs `lookInPage` in the tab
  (`chrome.scripting.executeScript`, main frame only): counts by name; values only for the kind shown, cut to 24
  characters inside the page. `test/chrome-fake.js` gains `scripting.executeScript` and `pages`. No totals across
  sites ("in total" in Kitesurf's bar): an extension cannot count those. Every kind's Copy button carries the same
  `node tools/inspect.js storage --site <host>`, for step 6. Not run in a real Chrome yet (step 8).
- **Review follow-ups on steps 1 to 4** (6 tests more, 335 in all). A cookie on the user's own always-delete list no
  longer waits: it goes when it comes back whatever mode its group (C07) is in; only that group set to Off, the main
  switch, a pause or a sign-in keeps it (`mine`, `mineVerdict` in background.js). The 8088 list still follows C07.
  "Delete all" leaves sign-in cookies and the ones the user pressed Keep on, says "3 stay: 2 keep you signed in, 1 you
  chose to keep", and the box (`data-also="kept"`, message field `kept: true`) takes those too. The history's
  per-cookie counters gained `d` (times removed on the day of `last`) and `g` (group), so the three cookie rows say
  "N deleted on this site today, N deleted today on all sites, N waiting". Entries from before have no `d`: not counted.
- **Step 5, the side panel** (19 tests, 354 in all). `report.html` and the thin `report-page.js`; manifest: `sidePanel`
  and `side_panel.default_path`; the popup's button "Open the report beside the page" (`chrome.sidePanel.open`, and
  `report.html?tab=<id>` in a tab when Chrome refuses). `renderReport` gained the top line, "Waiting for your answer"
  and "This page: ... · Read at HH:MM:SS" with "Read again". `test/load-page.js` runs the page script against the real
  background and the fake. Decided: "Undo (N)" reads "Put back N deleted cookies"; the report is not redrawn when
  storage changes, only on a press, a tab change or "Read again". Not run in a real Chrome yet (step 8).
- **Step 6, inspector parity** (11 tests, 365 in all). `tools/inspect.js cookies --site <site> [--values]` and
  `storage --site <site>`: the rows are built by the report's own `buildReport`, so the words cannot drift. What
  happens to a cookie is said for the switches of a new Tracker Cleaner with cleaning on, and a line says that the
  user's own switches, Keep and Always delete are not seen from outside Chrome. `--values`: the locked (encrypted)
  column is never read, the row says "not readable from the file"; a readable value is cut to 24 characters.
  Storage: the files tell only whether the site is on Chrome's list and has a database folder; the other four kinds
  say "cannot be counted from the files" instead of guessing. The fixture's Cookies file gained expiry columns.
- **Step 7, Tor row** (10 tests, 375 in all). The extension's own switch decides; `torChrome` of the 8088 server is
  no longer read. `applyProxy` first asks `http://127.0.0.1:9050/`: an answer that names Tor counts as running (Tor
  answers a web request on that port with a short refusal page); no answer, or another program's answer, and Chrome
  is left as it is. `state()` carries `tor: { wanted, running, routed }`, and the row in the report and in the popup
  says "Routed over Tor: yes, websites see an address of the Tor network, not yours", "Routed over Tor: no" or "Tor is
  not running on this computer; nothing is routed". Decided: if Tor stops while Chrome is routed it stays routed (pages
  fail) rather than fall back and show the real address, and the row says so. The website's view of the address is
  not fetched here (the history page's button does that). "Running" is covered by the stand-in only: no Tor here.
- **Step 8, real-Chrome checks** (1 Node test more, 376 in all; `npm run test:browser`: all 33 checks pass, R1 to R9
  new, Chrome 157 headless). Found: `chrome.sidePanel.open` is refused without a user gesture and works from a real
  mouse click on the popup's button; the panel is an ordinary page target, so the checks drove the panel itself, not
  a tab. It is told about tab changes (`tabs.onActivated`, `tabs.onUpdated`). Copying needs a real click too.
  `getMatchedRules` answers 20 times in 10 minutes and then refuses, except after a real click: the row now says
  'Chrome did not say how many it blocked; press "Read again" to ask it'. A request to 127.0.0.1:9050 with nothing
  listening failed after 1 ms and the proxy setting stayed "system". Manifest 1.23; TESTING.md steps 21 to 28.
  Open: Tor "running" is covered by the stand-in only; nobody has looked at the panel in a window yet.

## Todo: the tracking lab (Phase A built 2026-11-16; review by hand open)

Design, the 20 techniques, the table of traces, the trip and the steps with ETAs: journal page
`/mnt/d/journal/server/tracking-lab.html` (http://localhost:8080/tracking-lab.html). Step list revised 2026-11-15
after the source sweep on `tracking-ways.html` (data: `server/data/tracking-sources.json`, `tracking-ways.json`).
Phase A is built in `lab/` from scratch, nothing downloaded: `node lab/server.js`, tests `test/lab.test.js` (in the
suite) and the real-Chrome trip `TC_BROWSER_TMP=/mnt/d/tmp node test/lab/trip.js`. Result: 35 of 36 rows tracked;
T34 push subscription "designed, not built" (would leave the machine, needs a package). T20 remembered servers and
T21 forced-HTTPS work only over https: the trip makes a self-signed certificate with `openssl` for one run, serves
`friendface.test` on port 8203, and the throwaway Chrome alone accepts it (by key hash) and resolves `*.test` to
127.0.0.1; by hand they stay open. Simulated, and said so in the rows: the second address (forwarded-for header)
and the press on "Allow" (control-channel grant). No chunk was used. Step 18 reads Chrome's files
with its own `lab/outside.js`, not `tools/inspect.js`.

**What it is.** Pretend sites on 127.0.0.1 and a pretend network, Friendface, that follows a made-up signed-in
person; "What I know about you" is a checklist, one row per kind of trace with the captured identifier. Never
deployed. Proposed home: `lab/`, tests in `test/lab*.test.js` and `test/browser/`.

**The rule.** Phase A (extension OFF) is complete only when every row is created, read back, stored and shown, by
hand and in the coded real-Chrome trip, or accepted by the user as "cannot be created here". Phase B (ON) waits.

**What changed.** Steps 7-12 build the orthogonal set, one way per class c1-c11 (different class = a defence
that stops one leaves the other working); 13-15 the rest of the 20 techniques. New ways: simulated addresses
(c6), typing and mouse rhythm (c9), loopback probing (c10), push subscription (c8); traces 33 -> 36 (T34-T36).
A named chunk is a starting point only if its licence and contents check out; ETAs assume they do.

**Phase A steps (about 163 min + 15 min review; was 150; 177 without chunks), tests first.**

[x] 1. Ground rules: `*.localhost` names and cookies (12).  [x] 2. Ground rules: the hard kinds, plus 127.0.0.x, push
   subscription, loopback request (14).  [x] 3. Server skeleton (8).  [x] 4. Sign-in, profile, feed (8).
[x] 5. "What I know about you" and the 36 rows as one data file (6).  [x] 6. The canary (5).
[x] 7. c1 + c6: third-party cookie on an image, request details, simulated addresses (8). Chunk: HTTPLeaks `leak.html`.
[x] 8. c2 + c3: frame storage ID, cache tag (6, was 9). Chunks: privacytests `static/supercookies*`, `live/caching.js`.
[x] 9. c4 + c5: click ID on links, canvas/graphics/audio fingerprint (6, was 8). Chunks: brave/adblock-lists
   `clean-urls.json`; fingerprintjs `src/sources/canvas.ts, audio.ts`.
[x] 10. c7 + c9: typed e-mail capture, typing and mouse rhythm (8). No chunk.
[x] 11. c8 + c10: push subscription endpoint with the permission, loopback probing (9, was 12). Chunk:
    duckduckgo/privacy-test-pages `local-port-scan/`.
[x] 12. c11: server-to-server report, joining to the account (5, was 6). Chunk: matomo-nodejs-tracker `index.js`.
[x] 13. Rest: kit, site cookie, events, beacons, redirector, share links (10, was 12). Chunks: privacy-test-pages
    `bounce-tracking/`, brave `debounce.json`.
[x] 14. Rest, frames and names: like frame, "Sign in with", cookie syncing, disguised subdomain (14). No chunk.
[x] 15. Rest, stores and caches: respawning, storage totals, icon, forced-HTTPS, compiled copy, font traits (9, was
    12). Chunks: privacytests `static/hsts.js`, jonasstrehle/supercookie `server/main.js`, fingerprintjs `fonts.ts`.
[x] 16. Lab helpers (5).  [x] 17. The coded trip with a restart of Chrome (12).  [x] 18. Checks from outside with
    `tools/inspect.js` (8).  [x] 19. Completeness check (5).  [x] 20. Hand-trip sheet, journal page (5).  [ ] 21. Review.

**Phase B steps (about 36 min + 10 min review), only after step 21.** 22. The extension recognises the lab
(test-only entries `pack.sh` leaves out).  23. Switch on, rerun the trip.  24. Scoreboard, 36 rows by off / on.
25. The same by hand.  26. Gaps become extension todos here.
Expectation, to be tested: redirector, cache tag and disguised subdomain are gaps; the server report is unstoppable.

## Repairs (after the lab's Phase B measurement, `lab/misses.json`)

Counts are kinds of trace out of 35, tracked / stopped, per setting of `test/lab/trip-cleaner.js`: A fresh install,
B0 everything automatic and no lab names, B with the lab's names entered by hand, C as B plus every manual action.
A row counts as tracked when it arrived once during the trip, also when it was stopped later in the trip.

- Step 0, measured before any repair: A 35/0, B0 35/0, B 10/25, C 8/27.
- R1 unknown trackers (C25, `learn.js`, asks first; needs the `webRequest` permission, which adds no install warning
  beside "all sites"): A 35/0, B0 35/0, B 10/25, C 8/27. Friendface was learned without any lab name in every
  setting (seen on 3 sites, one question waiting). In A it waits for the answer; in B0 it is held by the sign-in
  guard to the end of the 70-second trip (see R3); in C "approve all" stopped it. Not learned: Parcel & Pine's
  disguised subdomain (same site as the shop) and Hop (never asked for by a page, only passed through, see R5).
- R2 cache (C11): setting the row to Automatic or "Ask first" clears or offers at once instead of a day after install,
  and the popup row has "Clean now". A 35/0, B0 35/0, B 10/25, C 8/27. Seen in B0: cleared once when switched on,
  before the trip; the copies saved during the trip then live until the next daily clearing, so the five cache rows
  stay tracked unless "Clean now" is pressed (C does that).
- R3 sign-in guard. Found: the guard itself was right. It is armed in step 4 ("Sign in with Friendface") and ends
  five minutes later, but the trip is over after 70 seconds, so it "still held at the end". The bug was after it:
  what the guard had held was only done at the next quarter-hour sweep (seen in a real Chrome: the R1 question still
  waited 78 s after the guard ended). Fixed with a wake-up at the guard's end; with the real five minutes the held
  stop was carried out 3 s after. Ending the guard when the sign-in tab closes was not built: the five minutes after
  are what protects a pop-up sign-in. The measurement now cuts the five minutes to two seconds (declared in
  `misses.json`): A 35/0, B0 31/3 (1 more arrived but was not tied to her), B 10/25, C 8/27. In B0 Friendface is
  stopped during step 5; after the restart of Chrome nothing arrives any more (before: 18 kinds still arriving).
- R4 pings (C26, part of blocking, automatic): requests of the kind "ping" to another company are blocked (one
  dynamic rule, never on sign-in hosts), and `no-ping.js` takes a link's own ping address off as the link is pressed,
  which is what stops the lab's ping (it goes to Friendface from Friendface's own page). A 33/2, B0 29/5, B 9/26,
  C 7/28: the click ping and the page-close beacon are stopped in every setting, also on a fresh install.
- R5 redirect bounces (C27, asks first): a page address that answers "go to another site" is noted; two questions,
  "delete what it saved" and "cut off the ID it added" (only what was not in the address it was asked to open, so
  a short link's own parts are never cut). Nothing on the way of a sign-in is touched. A 33/2 (two questions wait),
  B0 28/6, B 9/26, C 7/28. In B0 Hop's cookie never comes back (stopped) and `ffclid` is cut off from the second
  pass on; the first pass and Hop's own log of the click cannot be stopped (only a redirect by HTTP is seen at all).
- R6 a tracker's own storage (C28, asks first): for each company the user stopped, its service worker and storage
  are emptied and its notifications blocked, after one question and then daily; the built-in list as a whole only
  on Automatic (a standing question about 65 hardly visited sites would be noise). Never while its site is open in
  a tab. A 33/2, B0 28/6, B 9/26, C 7/28: no change, because the trip keeps Friendface open in a tab from start to
  end, and its "Allow" is a grant over the control channel that no extension setting overrides. Checked apart in
  a real Chrome: worker 1 -> 0 after Approve, and a notification right stored as a user's own goes granted -> denied.
- R7 history and saved icons: not built, on purpose. Single sites can be taken out of the history only with the
  `history` permission ("read and change your browsing history"), and nothing deletes icons; without it an
  extension can only delete all history of a period. The report now says so under "What Tracker Cleaner cannot do".
  A 33/2, B0 28/6, B 9/26, C 7/28: no change.
- R8 what no browser tool can stop: no fake fix. The report's "What Tracker Cleaner cannot do" names four things
  with "Tracker Cleaner cannot stop this" and one plain reason each: an e-mail address you send, a shop telling a
  tracker what you bought, "Sign in with", like and share on the tracker's own page. A 33/2, B0 28/6, B 9/26,
  C 7/28: no change. Of C's 7 left, 6 are named in the report; the seventh is Hop's own log of the click (R5).
- After R8, for R1, R5 and R6 (same counts): companies that pages need to check you are human or to take a payment
  (`learn.js` NEEDED) are never learned or cleaned, and "Let it through again" also gives the notifications back.
- Not verified anywhere: a real Google sign-in and real sites with 1.24 loaded (TESTING.md, "1.24, the repairs").

### Steps S1 to S13: clean, show, undo, lock (replaces ask-first)

Two counts from here on, B0 (everything automatic, no lab names), of 36 kinds: "at the end" / "ever". At the end = it
still arrived, tied to her, after Chrome was started again; or, for a kind the trip only makes before that, the last
time the trip made it (learned from one more run with the main switch off); or, for a kind kept in Chrome's own
files, it is still in the files when the trip is over (`test/lab/count.js`). The headline is B0 at the end.

- S1 fair count (`test/lab/count.js`, `trip-cleaner.js`, `misses.json` `atEnd` per row): A 33 / 33, B0 10 / 28,
  B 8 / 9, C 7 / 7. Still tracked at the end in B0, with the cause:
  T17 compiled copy of the kit and T20 remembered servers (saved after the one clearing of saved copies, still in
  Chrome's files); T18 site icons and T19 history (no history permission); T22 notification right (the tracker's own
  site is open in a tab all trip, and the "Allow" is a grant over the control channel); T27 typed e-mail and T33
  purchase (sent on by the shop's own server); T30 redirect log (the first pass through the redirector is not seen
  coming); T31 share on the tracker's own page; T32 "Sign in with" (chosen by the user).

- S2 automatic by default (1.25; `registry.js` C11, C25, C27, C28 now `auto`; a new install stores `master: true` and
  the popup says once what now happens by itself). On every stop the saved copies are cleared and, in the same sweep,
  what the tracker saved on its own site; when a tracker's cookie is deleted the saved copies of that site go, at most
  once an hour. A site the user opens as a page (`mine`, a hash per site) is only blocked elsewhere: nothing automatic
  deletes its cookies or storage, because the user may be signed in there. C04 still asks. A 10 / 28, B0 10 / 28,
  B 8 / 9, C 7 / 7: the fresh install now equals B0; B0 itself did not move, its ten are saved after the stop (T17,
  T20), need the history permission (T18, T19), sit on the tracker's own open page (T22, T31) or never pass a point
  an extension sees (T27, T30, T32, T33). Not updated yet: TESTING.md steps 2 and 3 still describe "Turn on".
- S2a saved copies made after a stop (T17, T20): cleared once more a minute after the stop (alarm `copies`) and when
  Chrome starts while a tracker is stopped. Tried in a real Chrome: clearing for the tracker's addresses alone
  (`browsingData.remove` with `origins`) removes its saved file but leaves the compiled copy of its script and the
  remembered server, so these clearings are of all saved copies.
- S2b notification right of a stopped tracker (T22): blocked at once and once (`own[site].mute`), also while its own
  page is open or the user uses its site; nothing there is deleted by this. "Let it through again" gives it back.
- S2c known passing sites are skipped (T30; `skip.js`, a page script registered while C27 runs): a pressed link to a
  site already seen passing the browser along is changed to the one address on another site that it names. Never a
  sign-in address, as link or as destination. The list (`skip`: the sites, none while paused, off or during a sign-in)
  is written by the worker; "Let it through again" in the report takes a site off it. The lab's redirector passes the
  browser along with an HTTP redirect (302); the first pass is seen only as it happens (`onBeforeRedirect`), when the
  redirector has already been asked, so it cannot be stopped with the permissions there are.
- S2a, second part: also when the extension is loaded again (an update, or the lab's restart, where Chrome drops the
  wake-up and never sends "Chrome started" to an extension loaded from outside). After S2a to S2c: A 7 / 28,
  B0 7 / 28, B 7 / 9, C 6 / 7. Gone at the end: T17, T20 (S2a), T30 (S2c: the second pass is skipped). T22 stays in
  the lab only: the block is set (logged), but the lab's "Allow" is a grant over the control channel that no
  extension setting overrides; in a real Chrome a user's own grant went granted -> denied (R6).

### Fixes after the audit of 20f53e5 (F1 to F9)

- F1 a hostile page could get any domain stopped. Now: a sighting is counted for the site in the tab's address bar,
  never for a frame, and not at all without a tab; an ID in an address is no evidence, only a cookie of that company
  that other sites can use (read from Chrome's cookie list, by flag and shape; no request header is read); `siteOf`
  knows two-part country endings and treats every host under a shared name (`SHARED` in `learn.js`) as its own site;
  Google's own sites in any country are never learned; at most 10 stops without a question in an hour, then
  questions; never more than 300 stopped, and `own` is pruned with that list. Not the full public suffix list.
- F2 one redirect could add a name of its choosing to the rule that cuts tags off every address. Now a tag is never
  cut by itself: it is always one question (site and name), and names pages need (`NEVER_PARAM` in `learn.js`: v, id,
  q, list, page, client_id, ...) or values that do not look like an ID are never offered. The automatic defence is
  S2c. Cleaning what the passing site saved stays automatic.
- F3 the "opened as a page" protection lasted only until the next sweep. Now the one judge of every cookie
  (`spared`, used by the sweep, the cookie event and Approve) keeps the cookies of a stopped company whose site the
  user opens as a page; built-in list entries are judged as before. Not updated: the report still words such a
  cookie as "comes from a tracker's site".
- F4 an update from before 1.25 made an install with cleaning on automatic without a word. It still does (the owner's
  decision), and the popup now says so once: "New in 1.25: ...", with where to set it back; stored modes are kept.
- F5 `mine` (sites opened as pages): the 2000 opened last, refreshed on a revisit, hashed with a random value of this
  install (`salt`), emptied by "Clear history"; a page counts only when its tab is still on that site 3 seconds later.
  For sign-ins older than the list: a stop, the sweeps after it and the cleaning of a passing site never delete a
  cookie that looks like a sign-in (HttpOnly and Secure, or a `KEEP_RE` name) of a company on no built-in list.
- F6 the settings program on 127.0.0.1:8088 was asked for its limits file with its row (C15) off, and could switch
  cleaning off without a word. Now it is asked only while that row is on (default off); switching the row off takes
  its switches and lists away at once; while it has something switched off the popup says which, in one line. The
  cookie blacklist, tab limit and permanent drops it supplies therefore need that row on.
- F7 the per-site clearing of saved copies also hit the visited site that merely carried a cookie with a tracker's
  name (`_ga` on the site itself), hourly. Now only when the deleted cookie sits on a tracker's own address.
- F8 wording that was stale or untrue: the manifest description (no "can put it back": only a deleted cookie, for 10
  minutes), the headers of `background.js` and `registry.js` (no "nothing is deleted before the user has turned
  cleaning on"), README's first paragraph.
- F9 the headline in `misses.json`, on the screen and on the page is setting A, the fresh install; B0 is named as what
  it is (also the groups that ask by default forced to Automatic); both counts are always written. After F1 to F9:
  A 7 at the end, 28 ever; B0 7 / 28; B 7 / 9; C 6 / 7. At the end in A: T18, T19 (history permission), T22 (the lab's
  grant over the control channel), T27, T33 (the shop's own server), T31 (the tracker's own page), T32 (a sign-in the
  user chose).

### Batch 2: S11, S15, S4, S5, S8

- S11 history (T19; icons T18 go with it only as Chrome decides): `optional_permissions: ["history"]`, asked by the
  popup's button "Also remove trackers' pages from my history" at a press; while that switch (`histOn`) is on, once
  a day the pages on the own addresses of stopped and listed trackers are deleted (`history.search` by site name,
  each address compared and deleted or left, kept nowhere); never a site the user opens as a page. In the trip it
  is "by hand only": in headless Chrome a real press on the button leaves Chrome's own question unanswered (tried:
  the right stays not granted). And it cannot empty T19 in the lab anyway: that row is every lab address in the
  History file, most of them pages of the sites she visited, which this must not touch. Carried over into this
  commit: at 300 stopped companies the popup says new ones are not stopped; the report words a kept cookie of a
  stopped company as kept.
- S15 T22 told as it is (measuring side only): at the end `trip-cleaner.js` asks Chrome, from the extension's side,
  for the real notification setting of the network's site. If it is "block", T22 is not counted at the end, gets the
  status "stopped (real setting blocked; the lab's simulated Allow overrides it)", and is named in
  `counts.simulated` and in the headline. `walk.js` and the lab are untouched.
- S4 no cookies for other companies (C29, own row, automatic, deletes nothing): rules built by `net-rules.js` (the
  shared builder; it already holds the rule shapes of S5 and S8, wired in their own commits) remove `Cookie` from
  every request to another registrable site but the page itself, and `Set-Cookie` from its answer. Left alone as
  asker and as asked: the sign-in hosts, github.com, the captcha and payment companies (`NEEDED`), the sites cleaning
  is off for; and requests inside Google's, Microsoft's and Apple's own families of sites. A tab in which a sign-in
  page was seen, and the tab that opened it, are let through entirely while the guard holds (one session rule with
  the tab numbers, kept in `storage.session`). Needs no new permission (declarativeNetRequest and the host access
  are there). Checked in a real Chrome (run.js 10b): from example.com the cookie for example.org is not sent, the
  one for accounts.google.com is, and with the row off it is sent again. Not reached: what a frame of another
  company asks of its own company (to Chrome that is the same site asking itself).
- S5 no cache tags and no referring page for other companies (C30, own row, automatic): the same rules as S4 also
  remove `If-None-Match`, `If-Modified-Since` and `Referer` from the request and `ETag` from the answer; same
  exceptions. On the referring page: Chrome by default already sends other sites only the site name
  (strict-origin-when-cross-origin); removing the header also covers pages that ask for the full address to be sent,
  and takes the site name away too. Setting a `Referrer-Policy` on every page instead would be gentler but would
  rewrite each page's own headers, so it was not chosen.
- S8 a page may not ask this computer or the home network (C31, own row, automatic): six block rules, one short
  pattern per address range (`LOCAL_RES` in `net-rules.js`: localhost, 0.0.0.0, 127.x, 10.x, 172.16 to 172.31,
  192.168.x, 169.254.x, the IPv6 loopback, mapped, private and link-local ranges), the whole host anchored, for a
  request from another site (`thirdParty`), never the page itself and never what the extension asks. Names such as
  `x.localhost` are not matched, so the lab's sites work; the lab exercises the rule because its sites are
  `*.localhost` names asking `127.0.0.1` by number. Found in a real Chrome and fixed here: one pattern for all ranges
  was refused ("exceeded the 2KB memory limit"), and that refusal took every other dynamic rule down with it,
  because Chrome refuses the whole change; `learnedRules` now tries each rule alone when the change is refused.
  Not covered: a public name that resolves to a private address. A page on one private address asking another is
  blocked too ("Don't clean on this site" lets it through).
- S4, reworked in the S8 commit after the first measurement: letting a whole sign-in tab through with an `allow`
  rule for five minutes also switched blocking off there (A went to 10 at the end, 32 ever). Now the header rules
  are session rules with `excludedTabIds`, only while the guard holds; blocking in that tab stays as it was.
- S2b, completed in the S8 commit: a notification block set by the extension was gone after the lab's restart (the
  extension is loaded again there); the note that it was set is now dropped when Chrome starts or the extension is
  loaded again, so the next sweep sets it again.
- After batch 2 (S11, S15, S4, S5, S8): A 6 at the end, 27 ever; B0 6 / 27; B 6 / 9; C 6 / 7; T22 apart (Chrome's real
  setting is "block"). At the end: T18, T19 (history: by hand only, and the row is all of her history), T27, T33
  (the shop's server), T31, T32 (her own press). "Ever" moved by one kind only (T6, the matched pair, no longer tied
  to her): until the tracker is learned, its script runs inside each visited site and sends everything itself, in a
  request these rules leave its address on; cookies, cache tags and the probe answer reach it that way. That is S6.

### Batch 3: S16, S6, S7

- Left alone by the S4 and S5 rules, exactly (`net-rules.js` and `background.js` `applyFeatures`): as asker and as
  asked, `SIGNIN_HOSTS` (accounts.google.com, accounts.youtube.com, login.microsoftonline.com, login.live.com,
  appleid.apple.com), github.com, `NEEDED` (hcaptcha.com, recaptcha.net, gstatic.com, googleapis.com,
  cloudflare.com, stripe.com, stripe.network, paypal.com, paypalobjects.com, klarna.com, adyen.com,
  braintreegateway.com, auth0.com, okta.com, duosecurity.com) and the user's `sitesOff`. Inside a family only (a
  family page asking a family host; `FAMILIES`): Google: google.com, youtube.com, youtube-nocookie.com,
  gstatic.com, googleapis.com, googleusercontent.com, ggpht.com, googlevideo.com, ytimg.com; Microsoft:
  microsoft.com, live.com, microsoftonline.com, office.com, office365.com, msauth.net, msftauth.net,
  sharepoint.com; Apple: apple.com, icloud.com, cdn-apple.com. Each name stands for itself and its subdomains.
- S16 history and icons told as they are (T18, T19): the user's own record, readable by no website. Measuring side:
  while still in Chrome's files at the end they are not counted and are named in `counts.own` and in the headline
  ("kept on purpose: your own history, readable by no website"). Extension: one button in the popup, "Clear my
  browsing history", pressed twice, clears all of it (`browsingData.remove` with `history`, no new permission);
  nothing calls it by itself. Setting C presses it with its other manual actions. S11 is unchanged.
- S6 faster learning (`learn.js`, `background.js`): (a) two visited sites instead of three; (b) at once, on one site,
  when the ID a visited site keeps for the user (a part of one of its script-readable cookies: 8 or more letters and
  digits mixed, or 16 or more digits) is seen in the address or body of a request to another company
  (`onBeforeRequest` with `requestBody`; compared as hashes made with a random value of that run of the worker,
  in memory, never stored, logged or sent) AND that company's own answer tries to set an ID cookie other sites can
  use (`onHeadersReceived`, kept as a yes or no). The second condition is there because with S4 such a cookie is no
  longer saved, and because a page must not get a company stopped that never asked for anything: for one site a
  cookie in Chrome's list is not enough. All F1 limits stay (tab site, shared hosts, never-learn lists, 10 an hour,
  300). No new permission.
- S7 page shield (C32, own row "Blur what makes this browser recognisable", automatic, deletes nothing):
  `shield.js` (45 lines, the page's own world, at the start of every page and frame, also about:blank ones) changes
  what a page reads back: a picture (toDataURL, toBlob, getImageData: at most 32 colour values by one step, on a
  copy for the first two), sound (getChannelData once per buffer, copyFromChannel, getFloatFrequencyData: 16 values
  by at most a hundred-thousandth), the graphics chip's unmasked names (general ones), and the saved amount
  (estimate: room to 10 GB, used down to whole GB). `shield-seed.js` (the extension's world) gives it the deciding
  value: hash of a random value of this run of Chrome (`storage.session`, copied to `shield` in `storage.local`)
  and the site in the address bar; sealed with a token handed over before page code runs; sealed 0 = leave alone
  (sitesOff, a pause, a sign-in going on anywhere). Not on the sign-in hosts. Checked in a real Chrome (run.js 10c).
- After batch 3 (S16, S6, S7): A 4 at the end, 13 ever (was 6 / 27); B0 4 / 13; B 4 / 9; C 4 / 7; apart: T22 (the lab's
  simulated press), T18 and T19 (her own history; in C too, because the second look opens pages again after the
  press). At the end: T27, T33 (the shop's server), T31, T32 (her own press). Friendface is stopped during step 1 on
  a fresh install. Of the 13 ever, tied to her across two different sites: T31 (like in a frame on the blog, share
  from the news site: her own presses), T27 and T33 (the shop to her account, by e-mail from the shop's server), T32
  (the blog to her account: "Sign in with"), T30 (her feed to the blog through Hop, once: the tag in the address),
  T9 and T24 (Friendface's like frame inside the blog: the frame's own storage and its request). On Friendface's own
  site only: T13, T22. In Chrome's files only, handed in from outside: T17, T18, T19, T20. Arrived but tied to
  nobody: T3, T6, T10, T11, T12, T14, T15, T16, T23, T25 (the fingerprint), T36. `misses.json` now has `sites` and
  `via` per row (measuring side).

### Fixes after the second audit (be668ec): H1 to H11

- H1 a stop on thin evidence was a weapon (a page hands its own ID to a bank, the bank answers with a cookie, the bank
  is cleaned out). A stop now has two halves. Soft, by itself (`stopped`): the company is blocked when another site
  asks for it, nothing else. Hard (`hard`: cookies but those that look like a sign-in, its own storage and worker,
  notifications, all saved copies once): by itself only for a company seen on two visited sites whose own site the
  user does not open as a page; for one the user also uses, one question once ("You use X, and it follows you on
  other sites. Remove what it keeps to do that?" Remove / Keep), which the group button never answers. A company
  learned at one sighting is only ever blocked. Only `hard` companies are judged like listed trackers
  (`core.js` EXTRA). The hourly limit is written after every stop inside the loop; tenants of one shared host count
  as one visited site.
- H2 a page could arm the sign-in guard by its own address. Now only a sign-in on a shipped host holds everything
  (`GUARD_HOSTS` in `guard.js`: accounts.google.com, accounts.youtube.com, login.microsoftonline.com, login.live.com,
  appleid.apple.com, github.com, google.com, youtube.com, microsoft.com, live.com, microsoftonline.com, office.com,
  apple.com, icloud.com; a name and its subdomains). A sign-in-looking page of any other site holds deleting for
  that site alone (`sguard`), five minutes, at most once an hour per site; it never exempts a tab from the header
  rules and never switches the shield off. The tab that opened a sign-in is skipped by the header rules only when
  it is the same site.
- H3 page shield: one empty-picture read gave the seed, the 32-bit state was the same on all sites, three sizes
  restored the dots. Now: per site and run of Chrome a key of 128 random bits (`crypto.getRandomValues`), made and
  kept by the worker in memory storage (`skeys`, at most 300 sites) and given to `shield-seed.js` at its asking (the
  one message taken from a page script; the site is the tab's address as Chrome reports it); sealed with a 128-bit
  token on the way to the page's world, all zero = leave alone. Which values change comes from a mix of the key,
  the index and a digest of what was drawn. Also covered now: OffscreenCanvas.convertToBlob, WebGL readPixels;
  replaced functions say "native code". `shield` and its shared salt in `storage.local` are gone. Stays uncovered:
  pages' background workers (they have their own OffscreenCanvas and no page script reaches them), fonts, the
  screen's size and colour depth, and a page that reads the same drawing several times, each shifted a little,
  and takes the most frequent value per dot (the mix is not a cipher; it stops reading the key off one picture).
- H4 one redirect (a mail service's safe links) made a site "passing", and links such as /logout?returnTo= were then
  skipped. Now a site is passing only after it sent the browser on to two different sites (`bounce[site].to`, salted
  hashes) AND added an ID to the address (`id`) AND is not a site the user opens as a page. At the press `skip.js`
  never changes a link whose address parameter is a way back by its name (return, returnTo, return_url,
  redirect_uri, continue, next, callback, back, success_url, cancel_url, ...) or whose path has a part that does
  something (logout, signout, pay, payment, checkout, auth, verify, confirm, unsubscribe, ...).
- H5 local-network rule, added: `[::]`, 100.64.0.0/10, names ending in .local, .lan, .internal or .home.arpa and
  fritz.box (`LOCAL_NAMES`), and a name under localhost when the asking page is not itself under localhost
  (`LOCAL_SUB`, so the lab's own sites are untouched; how the lab's probe of 127.0.0.1 is handled is unchanged). All
  nine patterns were accepted by a real Chrome. A name that resolves to a private address stays uncovered, and the
  report now says so ("A website name that leads to a device in your home").
- H6 header rules. Every rule (session and dynamic) is installed on its own; one Chrome refuses is named in the popup
  ("Not working right now, because Chrome refused a rule: ..."), the others stay. The referring page is kept for
  embedded frames (its own rules, without `sub_frame`). Left alone by the header rules, exactly: as asker and as
  asked: accounts.google.com, accounts.youtube.com, login.microsoftonline.com, login.live.com, appleid.apple.com,
  github.com, hcaptcha.com, recaptcha.net, gstatic.com, cloudflare.com, stripe.com, stripe.network, paypal.com,
  paypalobjects.com, klarna.com, adyen.com, braintreegateway.com, auth0.com, okta.com, duosecurity.com, the user's
  `sitesOff`, and of googleapis.com only (`GOOGLE_APIS`) www, accounts, oauth2, securetoken, identitytoolkit,
  content, maps, places, youtube, fonts, ajax, translate, firestore, firebaseinstallations (not
  storage.googleapis.com, which serves anyone's files). Inside a family only: Google: google.com and Google's
  country sites (`GOOGLE_CC` in `net-rules.js`, 190 names such as google.de, google.co.uk, google.com.au),
  youtube.com, youtube-nocookie.com, gstatic.com, `GOOGLE_APIS`, googleusercontent.com, ggpht.com, googlevideo.com,
  ytimg.com; Microsoft: microsoft.com, live.com, microsoftonline.com, office.com, office365.com, msauth.net,
  msftauth.net, sharepoint.com; Apple: apple.com, icloud.com, cdn-apple.com; Wikimedia: wikipedia.org,
  wikimedia.org, wiktionary.org, wikidata.org, mediawiki.org, wikibooks.org, wikiquote.org, wikisource.org,
  wikinews.org, wikiversity.org, wikivoyage.org. This replaces the list written under batch 3.
- H7 saved copies: all of them are cleared at most once a day (C11) and once when a tracker is cleaned out (H1's
  hard half); not a minute later, not when Chrome starts, not when the extension is loaded again (this takes back
  S2a's wake-up and start clearing). The row's sentence says so.
- H8 update: an install updated from before 1.25 with cleaning on gets the four groups that are new to "by itself"
  (C11, C25, C27, C28) stored as "Ask first" unless the user had chosen a mode (`held125`); blocking and the rules
  that delete nothing start at once. The popup's one-time line "New: Tracker Cleaner now cleans by itself." has two
  answers: OK takes those stored modes away again (by itself from then on), Keep asking leaves them.
- H9 questions and limits: the group button never answers "cut this off addresses" (nor the question of H1); a name
  with token, reset, code, key, auth, session or sig anywhere in it is never offered; the marks in `follow.on` are
  made with the install's `salt`; over 300 candidates the least evidence goes first, and at most 20 new companies
  are noted per visited site in an hour; "Clear my browsing history" shows a second, separate button that can be
  pressed only a second later; neither history clearing empties `mine` any more (takes back that part of F5), and
  the popup says so; a cleaned-out tracker's background program is removed even while its site is open (H1).
- H10 words: the manifest description (132 characters at most, so it names what touches every page: blocking,
  cookies and the referring page for other companies, the script in every page, rewritten links), the first-run
  line and README's first paragraph (both name everything, including that request addresses and contents are read
  in memory to spot trackers). README no longer says "1.21 has not been run"; the report no longer says the history
  cannot be cleaned.
- H11 score: `misses.json`, the screen and the page cells give three numbers of the 35 kinds built: still arriving
  at the end and tied to her; arrived and tied to her; arrived at all (also tied to nobody); with `caveats` beside
  them (the guard cut, the fingerprint not being a join key in this lab so the shield is unmeasured, T18/T19 as her
  own history, T22 apart when only simulated, T34 not built). Why `.localhost` hosts lost the visited-site
  protection: `core.js` `realHost` strips `.localhost` (for the Fit-browser's proxied copies), and `usedSite`
  compared only that shortened name with the stopped list, which holds the name as Chrome has it. Not a suffix-table
  bug, and it hits only names ending in `.localhost`; `usedSite` now compares both names (in H1's commit). Whether
  it changed the count: not measured.
- After H1 to H11: A, of 35: 9 at the end; 14 arrived and tied to her; 25 arrived at all (before: 4; 13; arrived at all:
  not measured). B0 the same; B 6; 9; 9. C 5; 7; 9. At the end in A beyond the four that no browser tool stops (T27,
  T33, T31, T32): T17, T20, T21 (saved copies are no longer cleared at a stop that only blocks, nor at start: H1,
  H7), T22 (its notifications are blocked only at a clean-out, and Friendface is a site she uses: H1), T30 (Hop is
  passing only after its second destination, which is the trip's last pass: H4). The question "You use Friendface
  ... Remove what it keeps?" would clean T17, T20, T21, T22 out on Remove; it does not come up within the trip
  because the five-minute hold after her sign-in on Friendface's own page is still running.

### Batch I

- I1 saved copies after a stop that only blocks (T17, T20, T21): all saved copies are cleared once then, at most once
  an hour in total (`softClearAt`), because that costs the user only speed; besides the daily clearing and the one
  at a clean-out; never at a start of Chrome. The row's sentence says exactly that.
- I2 the question about a company the user also uses ("You use X ... Remove what it keeps to do that?") is asked as
  soon as that company is blocked: also at one sighting, and also while its own sign-in page holds its site.
  Remove is the user's own press and acts at once; it still never deletes a cookie that looks like a sign-in.
  A company she does not use is cleaned out by itself only after two visited sites and not while its site is held,
  as before. Setting C presses Remove with its other manual actions; A does not.
- I3 `caveats` in `misses.json` is written by the run again (the hand edit of H11 is gone); the two inferences under
  H11 now read "not measured".
- After batch I: A, of 35: 9 at the end; 17 arrived and tied to her; 28 arrived at all. B0: 9; 14; 25. B: 6; 9; 9.
  C: 5; 7; 9 (C presses Remove: T17, T20, T21, T22 go; left are T27, T30, T31, T32, T33). At the end in A: the four no
  browser tool stops, T22 and T30 as expected, and still T17, T20, T21: the one clearing at the block (I1) comes in
  step 1 or 3, and the copies found at the end are made afterwards on Friendface's own pages, which she keeps
  using; they go with Remove (the question waits in A). A and B0 differ in "arrived and tied" in this run (T1, T2,
  T8 in A only): Friendface was blocked in step 3 in A and in step 1 in B0. Why the block came later in A this
  time: not found; in the run before both were blocked in step 1.
