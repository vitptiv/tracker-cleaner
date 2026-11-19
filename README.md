# Tracker Cleaner 1.32

A Chrome extension (Manifest V3) for this machine. Everything it does, since 1.25 without asking on a new
install (the popup says so once; each row can be set to off, ask first or automatic). Since 1.30 a dial at the
top of the popup sets every row at once: Ask first, Balanced (the 1.29 defaults) or Strongest, where a new
install starts; an update keeps what it had. Each row with something to clean has "Clean now", and the top
has "Clean everything now":

- it blocks requests to listed trackers. At Ask first and Balanced, a host on no list that it sees following
  you (on two sites you visit, or handed a site's own ID) is only ever asked about: blocking it, removing what
  it saved (once), cleaning a site that only passes you along, and sending its links straight on each need
  your press on one question. At Strongest the cleaner answers those questions yes itself, at most 10 an hour.
  That can hit a site you use, not only a tracker: when other sites ask it for things and it answers with a
  cookie other sites can use, it is blocked on other sites and its cookies (but those that look like a sign-in)
  and what it saved in the browser are emptied. That can sign you out of it, and emptied site data cannot be put
  back. Never a sign-in company or a site you turned off; each such answer is in the log, and "Let it through"
  stops it for that whole site;
- it deletes tracking cookies, clears the saved copies of pages once a day and each time Chrome starts (and at
  most once an hour besides, when you block a host), and strips the listed tracking parameters from links;
- from every request a page makes to another company it removes cookies, cache tags and the referring
  page, and it stops pages from calling this computer and the home network;
- it runs a small script in every page that takes the notify-address off links you press, and sends a
  link straight to its destination for a pass-through host you chose to skip;
- off unless you switch it on, and experimental: a second script in every page that blurs what makes the
  browser recognisable (pictures and sound read back, the graphics chip's name); a
  determined site can undo it;
- to spot trackers it reads the addresses and contents of what pages send, and whether an answer sets an
  ID cookie, in memory on this computer only: nothing of it is stored or sent anywhere.

After three seconds on a sign-in page of Google, Microsoft or Apple, that company's own cookies and those
of the site you came from are left alone for five minutes (another site's sign-in page holds that site
only); cookies that keep you signed in are never deleted. For 10 minutes a removed cookie can be put back with Undo; emptied storage and
cleared saved copies cannot be put back.

## What each row does

The popup keeps one short line per row (1.32); the full explanation is here.

- **The dial.** Ask first: nothing is deleted, and nothing learned is blocked, until you press; still on are the
  blocking of listed trackers, the rules that give other companies less, and what you chose yourself (blocks you
  pressed, your always-delete list, the history switch). Balanced: listed trackers and what they saved are cleaned
  by themselves; Google's own cookies, companies on no list and sites that only pass you along wait for your answer.
  Strongest: every cleaning row works by itself, every 10 minutes, and the two question rows below answer yes by
  themselves, at most 10 an hour, also for a site you use (see below). The sign-in pause, Tor, the tab limit,
  keeping only listed cookies, Wi-Fi networks and the reports keep their own switch.
- **Pause while you sign in.** While you sign in somewhere, and for five minutes after, nothing of that sign-in's
  site (and of the site you came from) is deleted, so the sign-in cannot break.
- **Block ads and trackers.** Pages are stopped from calling the companies that follow you from site to site, and
  YouTube plays without its ads.
- **Trackers' cookies.** Small files that trackers save to recognise you are deleted; the ones that keep you signed
  in stay.
- **Google's tracking cookies.** What Google and YouTube save to recognise you when you are not signed in is
  deleted; the ones that keep you signed in stay.
- **No cookies for others.** When a page asks another company for something, your cookies for that company are not
  sent along and it cannot save new ones.
- **No page address for others.** That company is not told which page you are on, and a hidden label it left in a
  saved copy (a cache tag) is not sent back to it.
- **Protect this computer.** A page on the internet cannot call programs on this computer or devices on your home
  network, which some pages do to recognise you.
- **Experimental fingerprint blur.** Best effort: makes this browser harder to recognise by its drawing, sound,
  fonts and screen size; a determined site can still undo it.
- **Codes shared across sites.** When the same hidden code is sent by two sites you visit, each to its own address,
  it is stripped from links and requests and the exact address that collects it is blocked, never the whole site.
  Cookies that carry the code, and cookies that address set, are deleted, never one that keeps you signed in; a
  deleted cookie can be put back for 10 minutes. A code a site only got handed in its address (a search box that
  echoes it) does not get that site's address blocked unless the site hands the code on to another site itself.
- **Clean tags from links.** The extra letters advertisers add to a link to see where you came from are cut off
  before the page opens.
- **Trackers on no list.** A company on no list seen on two sites you visit, each time able to recognise you, or
  handed the number a site keeps for you, is asked about: block it on other sites, then remove what it saved. At
  Strongest both are answered yes by themselves, at most 10 an hour. That can hit a site you use, not only a tracker:
  when other sites ask it for things and it answers with a cookie other sites can use, it is blocked on other sites
  and its cookies (but those that look like a sign-in or that you allowed) and what it saved in the browser are
  emptied. That can sign you out, and emptied site data cannot be put back. Load-balancer and bot-check cookies do
  not count as such a cookie. Never a sign-in company or a site you turned off. Each such answer is in the log, the
  popup shows it with "Let it through", and that press stops it for every host of that site.
- **Sites that pass you on.** A site that sends you straight on without showing anything is asked about: remove
  what it saved, and skip it next time. At Strongest both are answered yes by themselves, but the clean-out at most
  once a day per site and never while that site is open in a tab; it can also hit a site you use and sign you out.
- **Trackers' own sites.** What the trackers on the built-in list left on their own sites (a background program,
  saved data, the right to send notifications) is taken away once a day; for a host you blocked yourself only if you
  ticked "Keep removing what it saves". Never a site you turned off.
- **Site data you chose / Site rights you chose.** Only for the sites you chose yourself: what they saved is emptied,
  or they are stopped from things such as notifications or the camera.
- **Old Wi-Fi networks.** Networks this computer has not used for 30 days are forgotten, after your press; this
  cannot be undone.
- **Saved copies of pages.** All copies of pages Chrome saved to load them faster are thrown away once a day and each
  time Chrome starts, at Strongest every 10 minutes, and besides that at most once an hour when a host is blocked
  (never within 10 minutes of another clearing). At Strongest that means the whole cache is gone every 10 minutes:
  pages, pictures and scripts are fetched again each time, which is slower and uses more data. Remembered servers and
  forced-secure entries go with it.
- **Keep only listed cookies.** Every cookie is deleted except the ones on your own list.
- **Limit open tabs.** With more tabs open than the number you set, the ones you used least are closed.
- **Hide your address with Tor.** Chrome reaches websites through Tor on this computer.
- **Reports to this computer.** A summary of what was cleaned goes to a settings program on this computer, and its
  lists and switches are read from it; nothing goes anywhere else.
- **"Clean everything now".** Every row once, now. If questions wait, it first names the sites it would block or
  empty, with "Clean the rest only" as the other choice.
- **"Clear my browsing history".** Clears every page Chrome remembers you visited; it cannot be put back. The list
  of sites you use, which keeps their cookies from being cleaned, is not cleared.

## Layout

- `extension/` the extension. `background.js` is the service worker; `registry.js` (capabilities and
  the gate), `guard.js` (sign-in guard, pause), `queue.js` (approval queue, action log), `undo.js` and
  `core.js` (cookie decisions) are small pure modules; `popup-view.js` renders the popup. `history.js` (what was
  removed, as numbers), `loop.js` (a cookie its site keeps putting back is left alone) and the page `history.html`
  with `history-view.js` and `history-page.js` came with 1.22; the report beside the page (`report.html`,
  `report-view.js`, `report-page.js`) with 1.23.
- `tools/inspect.js` the command that reads Chrome's own files (below).
- `security/trackers.js` the lists, edited by hand.
- `test/` Node tests, with a stand-in for the `chrome` API (`chrome-fake.js`, `load-background.js`).
- `wifi-helper/` a local program for saved Wi-Fi networks (below).
- `extension-1.20/` the untouched old version, kept as the baseline.
- `PLAN.md` the plan, the capability table (C01-C24) and the build log. `TESTING.md` the manual checklist.

## Test

    npm test

Needs Node 22, no packages. The tests never touch a browser or the system. `npm run test:browser` runs the real
thing in a throwaway Chrome (its own empty profile; set `TC_BROWSER_TMP` to a folder with room for it).

## Rebuild the lists

After editing `security/trackers.js`:

    node extension/build.js

This writes `rules.json`, `rules-google.json`, `rules-params.json` and `lists.js` in `extension/`.

## Load it

Open `chrome://extensions`, switch on "Developer mode", remove or switch off any other copy of Tracker
Cleaner, press "Load unpacked" and choose `extension/`. Then follow `TESTING.md` (its by-hand steps were written for 1.24 and are not yet brought up to 1.25; `test/browser/run.js` drives 1.25 in a real Chrome). `extension/pack.sh` makes a signed `.crx` when the key
`~/.config/tracker-cleaner/key.pem` exists, and prints these steps when it does not.

## See what Chrome has stored

    node tools/inspect.js cookies

It reads Chrome's own files and changes nothing; Chrome can stay open. In place of `cookies`: `cache`, `code-cache`,
`storage`, `servers`, `permissions`, `tor`, `wifi`. Each answers what is there now, what is kept and why, what would be
removed, and what cleaning costs you. `--list` names each item, `--raw` prints the plain command underneath so you can
run it yourself, `--json` gives the same as data. It judges by the built-in lists only: your own exceptions and
switches live inside Chrome. Needs `python3` and `jq`. `tor` also says what your internet provider can see; it
checks the Tor service only, not whether Chrome uses it.

## The report beside the page

The popup's button "Open the report beside the page" opens Chrome's side panel. It is about the page in front and
follows you from tab to tab: the switch and Pause, what waits for your answer, one row per thing the extension does
with a sentence and its numbers, this site's cookies (each with the first 24 characters of what it holds, and Delete,
Keep, Always delete, Show all of it, Copy), and, when you ask, what else the page has saved. What a cookie holds is
shown on the screen only and saved nowhere. The same rows from a terminal, read from Chrome's own files:

    node tools/inspect.js cookies --site www.example.com
    node tools/inspect.js storage --site www.example.com

The row "Hiding your address from websites (Tor)" works by itself: switched on, it first checks that Tor answers on
this computer, and otherwise changes nothing and says "Tor is not running on this computer; nothing is routed".

## The page inside Chrome

The popup's link "See everything and its history" opens a page with one block per kind of thing: what is there now,
what is kept and why, what was removed and when, and what cleaning costs you, in the same words as the command, with
a "Copy command" button to check each block from a terminal. The history is numbers and cookie names for 30 days,
kept inside the extension on this computer and nowhere else; "Clear history" empties it. The button "Check how
websites see me" asks check.torproject.org once, from inside Chrome, and only when pressed.

## Wi-Fi helper

Chrome cannot see saved Wi-Fi networks, so `wifi-helper/` does that part: it lists the networks not
used for 30 days and removes only those you approve, from a terminal (`node wifi-helper/cli.js list`)
or from the popup row "Unused Wi-Fi networks" once `wifi-helper/install.sh <extension id>` has
registered it with Chrome. It is optional and never automatic. See `wifi-helper/README.md`.
