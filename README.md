# Tracker Cleaner 1.25

A Chrome extension (Manifest V3) for this machine. It blocks requests to tracker domains, strips
tracking parameters from links, and cleans tracking cookies. Since 1.25 a new install is switched on, and
the groups that only touch what follows you run without asking; the popup says so once, and each group
can be set to off, asked about first (Approve / Postpone in the popup) or automatic. Everything is held
while you sign in somewhere, and for 10 minutes a removed cookie can be put back with Undo; emptied
storage and cleared saved copies cannot be put back.

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
Cleaner, press "Load unpacked" and choose `extension/`. Then follow `TESTING.md`: 1.21 has not been
run in a browser yet. `extension/pack.sh` makes a signed `.crx` when the key
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
