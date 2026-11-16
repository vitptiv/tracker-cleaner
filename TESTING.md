# Tracker Cleaner 1.22: real-browser checklist

About 20 minutes, in Google Chrome. Tick each step. The 281 Node tests run against a stand-in for Chrome;
`npm run test:browser` (`test/browser/run.js`, 2026-11-12, Chrome 157 headless, fresh profile) ran the real thing:
24 checks, all passed.

## Covered by `npm run test:browser`

All of these passed in a real Chrome, so the matching steps below are a second look, not a first:

- The extension loads, the service worker starts with no errors, Chrome takes all 17 rules of the three files. Steps 1, 14.
- Fresh state, "Turn on", Pause / Resume with the `II` badge and the rulesets off. Steps 2, 3, 7.
- Tab addresses are readable without the `tabs` permission: "This site", and the sign-in guard holding while
  `accounts.google.com` is in front (the page was only opened, nobody signed in). Steps 4, 8.
- A `_ga` cookie is removed and logged, an ordinary one is kept; Undo puts it back from `storage.session` unchanged. Steps 8, 9.
- `NID` on google.com waits, the badge counts it, Approve removes it, Postpone 1 h keeps it. Step 6 (with a made-up cookie).
- A tracker request is blocked, `getMatchedRules` gives the "N requests blocked on this tab" count, and
  "Don't clean on this site" lets the request through, also in the page already open. Step 10.
- Tracking parameters are stripped on example.com and left alone on accounts.google.com. Step 11.
- youtube.com loads with the ad-stripping script running and no page errors. Step 12 (loading only).
- The Wi-Fi row says "Helper not installed" when it is not. Step 13.
- 1.22: the popup's link opens the page; it shows the removals of the run under today's date, sends nothing on
  opening, and "Clear history" empties it. A web page can neither fetch, frame nor message it. Steps 15, 19.
- 1.22: "Check how websites see me" sends one request, to check.torproject.org, and the answer was "not Tor". Step 17.

## Still needs your eyes

- **Step 4**: a real Google sign-in, start to finish.
- **Step 5**: "Sign in with Google" on another site.
- **Step 12**: a YouTube video actually plays, with sound, and no ad-blocker message.
- Step 6 with Google's real cookies, and that you are still signed in after Approve.
- The popup as a popup (it was tested as a tab), and Allow (step 9, second half).
- Native messaging with the helper installed (step 13 only saw it missing).
- **Step 16**: the wording. Whether every line of the page reads as plain English to you.
- **Step 18**: the "Copy command" buttons (not pressed in the automatic run), and that the command agrees with the page.
- **Step 20**: the "keeps putting it back" notice with Google's real cookie.

If a step fails, note its number and what you saw, and copy any red line from the service worker
console (step 14).

## Steps

- [ ] **1. Load it.** Open `chrome://extensions`, switch on "Developer mode" (top right). Remove or
  switch off any other Tracker Cleaner already listed: two copies would fight over the same cookies.
  Press "Load unpacked" and choose the `extension/` folder. Pin the icon to the toolbar.
  Look at: a card "Tracker Cleaner (local) 1.22" with no "Errors" button.
  Failure: Chrome refuses the folder, or shows "Errors" (press it and copy the text; a rule file is the likely cause).

- [ ] **2. Fresh state.** Click the icon.
  Look at: "Cleaning is off until you turn it on." with a "Turn on" button, and under
  "What gets cleaned" one row per group (13 rows).
  Failure: an empty popup, "Loading…" that stays, or "Tracker Cleaner did not answer".

- [ ] **3. Turn on.** Press "Turn on".
  Look at: a ticked "On" box and a "Pause 10 min" button. The icon may get a number: things waiting for your approval.
  Failure: the popup still says cleaning is off after reopening it.

- [ ] **4. Sign in to Google.** If you are signed in, sign out first. Open a new tab, go to
  `https://accounts.google.com` and, while the sign-in page is in front, click the icon.
  Look at: the line "Sign-in in progress: cleaning is held." Then finish signing in.
  Failure: no such line while on the sign-in page (tab addresses are not readable); or the sign-in
  loops, shows "Something went wrong", or asks for the password again and again.

- [ ] **5. "Sign in with Google" on another site.** On a site where you use it (for example
  `stackoverflow.com`), sign out and press its "Sign in with Google" / "Log in with Google" button.
  Look at: you end up signed in on that site. The popup shows the "Sign-in in progress" line during it and for 5 minutes after.
  Failure: the Google window closes and the site still shows you signed out, or an error page about a missing or invalid "state".

- [ ] **6. Badge, Postpone, Approve.** Open `https://www.google.com`, then click the icon.
  Look at: a number on the icon, and in the row "Google / YouTube cookies" a line "N pending" with
  "Remove N cookies", "Postpone 1 h" and "Until restart". "What is waiting" lists names such as `NID`.
  Press "Postpone 1 h": the row says "Postponed until HH:MM" and the badge number drops by N.
  Then press "Remove N cookies": the note at the top says "Cleaned N of N." and the row says "Nothing waiting · N removed today".
  Reload google.com: you are still signed in.
  Failure: no pending cookies at all after visiting Google; Approve says "That did not work."; or you are signed out afterwards.

- [ ] **7. Pause.** Press "Pause 10 min".
  Look at: the badge shows "II", the popup says "Paused until HH:MM" with a "Resume" button, and any Approve button is greyed out.
  Press "Resume": the badge goes back to a number or to nothing.
  Failure: no "II", or the pause is gone when you reopen the popup.

- [ ] **8. A cookie is removed and shown.** Open `https://example.com`. Press F12, choose "Console", type
  `document.cookie = "_ga=test; max-age=3600"; document.cookie` and press Enter, then run `document.cookie` once more.
  Look at: the second answer does not contain `_ga`. Click the icon: under "This site: example.com"
  there is a line "HH:MM removed example.com · _ga" with "Undo" and "Allow", and above it
  "Removed in the last 10 minutes: N" (the cookies approved in step 6 count too).
  Failure: `_ga` is still there; or there is no "This site" section (tab address not readable).
  A missing "N requests blocked on this tab" line here is normal: example.com loads no trackers.

- [ ] **9. Undo and Allow.** Press "Undo" on that line.
  Look at: the note says "Restored 1."; `document.cookie` in the console shows `_ga=test` again and it
  stays; the popup lists it under "Your exceptions" with "Revert".
  Then in the console run `document.cookie = "_gid=test; max-age=3600"`, open the popup, press "Allow"
  on the `_gid` line, and run the same console line again: `_gid` now stays.
  Press "Revert" on both exceptions to clean up.
  Failure: "Restored 0.", or the restored cookie disappears again within a few seconds.

- [ ] **10. Don't clean on this site.** Still on example.com, tick "Don't clean on this site", then run
  `document.cookie = "_ga=test; max-age=3600"; document.cookie` again.
  Look at: `_ga` stays. Untick the box afterwards.
  Failure: the box will not stay ticked, or "That did not work."

- [ ] **11. Tracking parameters.** Paste `https://example.com/?utm_source=x&gclid=y&keep=1` into the address bar.
  Look at: the address bar ends up as `https://example.com/?keep=1`.
  Failure: `utm_source` or `gclid` is still in the address; or the page does not load at all.

- [ ] **12. YouTube.** Open any YouTube video.
  Look at: it plays, with sound, and the page looks normal. Open a news site too; it should load normally.
  The popup there shows "N requests blocked on this tab".
  Failure: a black or endlessly spinning player, a message about ad blockers, or a page with no styling.

- [ ] **13. Wi-Fi row.** In the popup, find "Unused Wi-Fi networks".
  Look at: it offers only "Off" and "Ask first", and says "Helper not installed (see wifi-helper/README.md)".
  That is correct until you run the helper's `install.sh` with this extension's id (on its card at
  `chrome://extensions`; an unpacked copy has its own id). This machine has no saved Wi-Fi networks, so
  even with the helper installed the row will say "Nothing waiting".
  Failure: any other error text in the row, or an "Automatic" choice.

- [ ] **14. No errors.** Go to `chrome://extensions`, and on the Tracker Cleaner card press "service worker".
  Look at: the Console tab of the window that opens has no red lines. Also: the card has no "Errors" button.
  Failure: any red line. Copy it in full, with the file name and line number at its right.
  Lines that name `127.0.0.1:8088` are the optional audit server not running; they are not failures.

- [ ] **15. The page.** In the popup, press the link "See everything and its history" under the title.
  Look at: a new tab "Tracker Cleaner: see everything and its history" with nine blocks, from "Small files sites
  leave to recognise you (cookies)" to "Remembered Wi-Fi networks". In the cookie block, "Removed:" starts with
  today's number (the cookies of steps 6 and 8), and "Removed, day by day" lists today's date with the same number.
  Failure: "Loading…" that stays, "Tracker Cleaner did not answer", or no number for today after steps 6 and 8.

- [ ] **16. The wording.** Read each block on the page.
  Look at: every block says "There now:", then (where something is stored) "Kept:" and "Removed:", then "What happens
  if you clean this:". Names and dates are inside lists that stay closed until you click them. Where Chrome does not
  tell the extension something (the size of the saved copies, which sites keep data), the block says so.
  Failure: a code such as C03 or B2, the word "pending", "undefined", or a sentence you have to read twice. Note it.

- [ ] **17. How websites see you.** In the block "Hiding your address from websites (Tor)", read the line beside the
  button, then press "Check how websites see me".
  Look at: before the press nothing is asked. After it: "Websites see you as (your address). This is not Tor: it is
  your own address, or that of your VPN." and above it "Chrome is not set to use Tor." Tor is not installed here.
  Failure: an answer appears without pressing; "There was no answer" while other sites load; or it claims Tor.

- [ ] **18. Copy command.** On the cookie block press "Copy command", open a terminal in the `tracker-cleaner`
  folder, paste and press Enter. Do the same once from a popup row, for example "HTTP cache".
  Look at: the note says "Copied. ..."; the terminal prints the same title as the block and "There now:" with about
  the same number of cookies as the page (Chrome writes its file up to half a minute late). Nothing is changed.
  Then run `node tools/inspect.js tor`: the line "Your internet provider can see:" says the name of every site you
  open, and that site-name lookups (DNS) are not encrypted, which is the case on this machine.
  Failure: "Could not copy", or the terminal's numbers are far from the page's.

- [ ] **19. Clear history.** At the top of the page press "Clear history (N days)".
  Look at: the note says "Done.", the button is replaced by "Nothing has been removed yet, so there is no history.",
  and the cookie block says "Removed: none in the last 30 days." The cookies themselves are untouched.
  Failure: the numbers stay, or come back after reloading the page without anything new being removed.

- [ ] **20. Google keeps putting its cookie back.** Set the row "Google / YouTube cookies" to "Automatic" and use
  Google Search or YouTube for ten minutes.
  Look at: after the same cookie (usually `NID`) was removed five times within ten minutes, the row says "1 of these
  is no longer removed automatically: its site keeps putting it back, so it waits for you." and lists it with "keeps
  coming back"; the page's cookie block says the same, and "Removed most often" shows it with its count.
  Set the row back to "Ask first" afterwards.
  Failure: the count of `NID` in "Removed most often" keeps climbing past five within ten minutes.

## Afterwards

To stop: switch the card off at `chrome://extensions`, or untick "On" in the popup. Settings are kept
in the extension's own storage and go away when you remove it.
