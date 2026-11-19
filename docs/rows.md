# What each row does

The popup keeps one short line per row; the full explanation is here.

- **The dial.** Ask first: nothing is deleted, and nothing learned is blocked, until you press; still on are the
  blocking of listed trackers, the rules that give other companies less, and what you chose yourself (blocks you
  pressed, your always-delete list, the history switch). Balanced: listed trackers and what they saved are cleaned
  by themselves; Google's own cookies, companies on no list and sites that only pass you along wait for your answer.
  Strongest: every cleaning row works by itself, every 10 minutes, and the two question rows below answer yes by
  themselves, at most 10 an hour, also for a site you use (see below). The sign-in pause, Tor, the tab limit,
  keeping only listed cookies and the reports keep their own switch.
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
