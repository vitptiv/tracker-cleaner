# Tracker Cleaner 1.24: real-browser checklist

About 30 minutes, in Google Chrome. Tick each step. The 444 Node tests run against a stand-in for Chrome;
`npm run test:browser` (`test/browser/run.js`, 2026-11-15, Chrome 157 headless, fresh profile) ran the real thing:
33 checks, all passed (24 from 1.22, and R1 to R9 for the report of 1.23).

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
- 1.23: a real mouse click on the popup's button "Open the report beside the page" opens the report in Chrome's side
  panel (asked without a click, Chrome refuses). The report follows the tab in front and a tab that goes to another
  address. Steps 21, 22.
- 1.23: "Turn on" in the report; "0 blocked on this page" becomes "1 blocked on this page" after a tracker request. Step 23.
- 1.23: a cookie's value shows cut to 24 characters and whole after "Show all of it"; Copy, Delete, Keep, Always
  delete (the cookie is deleted again when the page sets it anew, with nothing waiting) and "Delete N cookies on this
  site" with "1 stays: 1 you chose to keep" work on real cookies. Steps 24, 25.
- 1.23: local storage, session storage, a database and a cache set by a page are counted only after the press. Step 26.
- 1.23: with Tor switched on and nothing listening on port 9050 the check fails within a few milliseconds, Chrome's
  proxy setting is untouched, pages still load, and the row says "Tor is not running on this computer; nothing is
  routed". Step 28.
- 1.23: Chrome answers "what did you block" 20 times in 10 minutes and then refuses, except after a real click:
  the row then says 'Chrome did not say how many it blocked; press "Read again" to ask it', and the press gets the number.

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
- **Steps 21 to 27**: the report as you see it, in a window with a real side panel: its width, its wording, and that
  it keeps up while you browse. The automatic run drove it without looking at it.
- **Step 27**: the terminal command against your real profile (the automatic tests use a made-up one).
- **Step 28** with Tor running: needs `sudo apt install tor`. Only "not running" was seen in a real Chrome; "routed"
  is covered by the stand-in alone.
- **1.24, the repairs** (`PLAN.md`, "Repairs"; measured against the lab with `node test/lab/trip-cleaner.js`, never on
  real sites): after a day of ordinary browsing, read the questions under "Waiting for your answer" in the report:
  "X followed you on 3 sites. Stop it?", "X passed you on to another site without showing you a page. Delete what it
  saved in your browser?". Is every X a company you would call a tracker? Press "Not now" on any that is not, and
  note it. After an Approve: do the sites you use still work, and are you still signed in to Google (steps 4 and 5
  again)? "Let it through again" under "Trackers you stopped" is the way back.

If a step fails, note its number and what you saw, and copy any red line from the service worker
console (step 14).

## Steps

- [ ] **1. Load it.** Open `chrome://extensions`, switch on "Developer mode" (top right). Remove or
  switch off any other Tracker Cleaner already listed: two copies would fight over the same cookies.
  Press "Load unpacked" and choose the `extension/` folder. Pin the icon to the toolbar.
  Look at: a card "Tracker Cleaner (local) 1.24" with no "Errors" button.
  Failure: Chrome refuses the folder, or shows "Errors" (press it and copy the text; a rule file is the likely cause).

- [ ] **2. Fresh state.** Click the icon.
  Look at: "Cleaning is off until you turn it on." with a "Turn on" button, and under
  "What gets cleaned" one row per group (16 rows).
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

- [ ] **21. Open the report.** On any web page click the icon and press "Open the report beside the page".
  Look at: the popup closes and a panel opens at the side of the window, titled "Tracker Cleaner". Its first lines:
  the "On" box with "Cleaning is on", then "This page: (the site) · Read at (the time)" with a "Read again" button.
  Failure: nothing opens; or the report opens in a tab of its own (it does that only when Chrome refuses the panel:
  note it); or "Tracker Cleaner did not answer".

- [ ] **22. It follows you.** With the panel open, switch to another tab, then follow a link to another site.
  Look at: "This page:" changes to the site in front each time, and the cookies below are that site's.
  On a page such as `chrome://extensions` it says "This tab is not a web page".
  Failure: the panel still shows the old site after a second or two.

- [ ] **23. The top line and what waits.** Read the top of the panel, then visit a page with ads and press "Read again".
  Look at: "Pause 10 min", "Clear the saved copies of pages" and either "Put back N deleted cookies" or "0 cookies
  deleted in the last 10 minutes, so there is nothing to put back." Under "Waiting for your answer": one line per
  group with a number, a button that says what it does ("Remove 1 cookie"), "Postpone 1 hour" and "Show what is
  waiting"; or "Nothing is waiting for your answer." Under "What Tracker Cleaner does for you": each row has a
  sentence, a state ("on", "asks first", "off") and numbers such as "3 blocked on this page" and "2 deleted on this
  site today, 5 deleted today on all sites, 0 waiting".
  Failure: a row without a number where one belongs, the word "pending", a code such as C03, or a sentence you have
  to read twice. If a row says 'Chrome did not say how many it blocked; press "Read again" to ask it', press it: the
  number must come.

- [ ] **24. A cookie, cut and whole.** Under "Small files this site has saved to recognise you (cookies)" press
  "Show the N cookies". Pick one with a long content and press "Show all of it", then "Copy what it holds".
  Look at: each cookie has its name, its site, "until (a date)" or "until you close Chrome", the first 24 characters
  of what it holds followed by "…", and a line such as "keeps you signed in, kept" or "has a tracker's name, deleted
  automatically". After "Show all of it" the whole content is shown; after Copy the note says "Copied what this
  cookie holds." and pasting gives the whole content.
  Failure: a whole long content is visible before you ask; or "Could not copy" after a real click.

- [ ] **25. The cookie buttons.** On a site you do not mind being signed out of: press "Delete" on one cookie, "Keep"
  on one that says "has a tracker's name", "Always delete" on an unimportant one, then reload the web page and press
  "Read again". Last, read the line beside "Delete N cookies on this site" and press that button.
  Look at: the deleted cookie is gone and the top line offers "Put back 1 deleted cookie". The kept one says "kept
  because you chose Keep". The always-deleted one is gone again after the reload, without waiting for an answer, and
  is listed under "Always deleted on this site (1)" with "Stop always deleting". Beside the big button a line such as
  "3 stay: 2 keep you signed in, 1 you chose to keep"; after the press you are still signed in and the note says
  "Deleted N of N." Ticking the box first changes the number on the button to all of them.
  Failure: you are signed out without having ticked the box; or the always-deleted cookie waits under "Waiting for
  your answer" instead of going.

- [ ] **26. Other things the page has saved.** At the bottom press "Count what this page has saved", then a "Show the N".
  Look at: before the press, "Nothing on the page is looked at until you press this." After it, five kinds, each with
  what it is, where it lives and "N on this page"; "Show the N" lists names with at most 24 characters of content.
  On `chrome://extensions` or the Chrome Web Store: "This tab is not a web page" or "Chrome does not let extensions
  look at this page."
  Failure: numbers appear without the press, or a long content is shown whole.

- [ ] **27. The same in a terminal.** Press "Copy command" beside "See this list in a terminal", paste it into a
  terminal opened in the `tracker-cleaner` folder and press Enter. Run it once more with ` --values` added.
  Look at: the same title as in the panel, "N cookies on (the site), read from Chrome's own cookie file", one row per
  cookie with the same "until ..." and the same words about what it is. With `--values`: "holds: not readable from the
  file" on every row, because Chrome keeps the content locked on disk. Nothing is changed.
  Failure: a cookie's content is printed; or the words differ from the panel's for a cookie whose switch you have not changed.

- [ ] **28. The Tor row.** In the popup set "Hiding your address from websites (Tor)" to "Automatic", then press
  "Read again" in the panel. Set it back to "Off" afterwards.
  Look at: Tor is not installed here, so the row says "Tor is not running on this computer; nothing is routed" in
  the popup and in the panel, and websites keep loading. Back on "Off": "Routed over Tor: no".
  Failure: pages stop loading while the row is on; or the row claims "Routed over Tor: yes".

## Afterwards

To stop: switch the card off at `chrome://extensions`, or untick "On" in the popup. Settings are kept
in the extension's own storage and go away when you remove it.

## The tracking lab by hand (Phase A, Tracker Cleaner off)

Start the lab with `node lab/server.js` and open a separate lab Chrome profile, never your everyday one, with Tracker Cleaner off.
Open http://friendface.localhost:8200/lab/check first: it must say "cleaner seems off". The same trip in code:
`TC_BROWSER_TMP=/mnt/d/tmp node test/lab/trip.js` (add `--rows` to see every captured value).

- [ ] 1. **Read the news, not signed in.** Open http://gazette.localhost:8200/. Open the article "Harbour bridge closes for repairs". Scroll to the end. Ticks: T1 T3 T6 T9 T10 T11 T12 T14 T15 T16 T23 T24 T25 T28 T36.
- [ ] 2. **Join Friendface.** Open http://friendface.localhost:8200/. Create the account: name Mara Lindqvist, e-mail mara.lindqvist@example.test, password lab-only-1. Press "Allow" when Friendface asks to send notifications. Ticks: T13 T22.
- [ ] 3. **Follow a link from the feed.** In the feed, click the post "Tidewater Notes: mending a kite". It goes through Hop and arrives with ?ffclid= in the address. Ticks: T2 T4 T29 T30.
- [ ] 4. **Like and comment on the blog.** Press "Like". Press "Sign in with Friendface" and continue. Write the comment Nice post and send it. Ticks: T8 T31 T32.
- [ ] 5. **Watch a video and leave.** Open http://loopreel.localhost:8200/ in a new tab. Press play, wait a few seconds, close the tab. (The coded trip makes this tab come from a second, simulated address.)
- [ ] 6. **Search, almost subscribe, share.** On the Gazette search for kite repair. In the newsletter box type mara.lindqvist@example.test and do not press the button. Open the article again, press "Share on Friendface" and close the window that opens. Ticks: T26 T27 T35.
- [ ] 7. **Buy a kite line.** Back in the Friendface feed click "Parcel & Pine: kite line, 25 m". Add to basket, check out with mara.lindqvist@example.test, Mara Lindqvist, Nordhavn, 00100, and press Buy. Ticks: T5 T7 T33.
- [ ] 8. **Close Chrome and start it again.** Close the lab's Chrome completely. Run node lab/outside.js on its profile folder, then start it again on the same profile. Open http://friendface.localhost:8200/what-i-know. (T20 and T21 need the lab certificate, which only the coded trip sets up.) Ticks: T17 T18 T19 T20 T21.
- [ ] 9. **Read the news again.** Open the Gazette article again. The cache tag and the saved file come back, the fingerprint is the same, the tab has a new number.
- [ ] 10. **Delete the Gazette's ID cookie.** Open http://gazette.localhost:8200/lab/delete-id, then the Gazette's front page. The cookie is back with the same ID.
- [ ] 11. **The blog again.** Open the Tidewater post again. The frame's storage ID and per-site cookie are the same as before the restart.
- [ ] 12. **Delete every cookie.** Delete all cookies in Chrome's settings. Open the Gazette, then http://friendface.localhost:8200/what-i-know: Friendface still knows who this is.
- [ ] Last. http://friendface.localhost:8200/what-i-know says 33 of 36 kinds tracked by hand (35 in the coded trip, which has the lab certificate for T20 and T21); T34 says "designed, not built"; "Where you have been" lists the pages of this sheet in order.
