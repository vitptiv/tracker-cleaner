# Tools around the extension

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
registered it with Chrome. It is optional and never automatic. See `../wifi-helper/README.md`.
