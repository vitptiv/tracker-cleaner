# Scorecard

Measured with version 1.32 in a real Chrome against the test lab in `lab/` (a pretend social network that follows a visitor in 36 ways, plus a second tracker hidden behind each site's own address). "No press" means a fresh install left alone.

| # | Way of following you | Strongest, no press | Balanced, no press | Every question answered yes |
|---|---|---|---|---|
| T1 | Browser cookie | stopped | stopped | stopped |
| T2 | Sign-in cookie seen on other sites | stopped | stopped | stopped |
| T3 | Tracking-kit cookie per site | arrives, not tied to you | **still follows you** | stopped |
| T4 | Click-ID cookie | stopped | **still follows you** | stopped |
| T5 | Redirector cookie | stopped | **still follows you** | stopped |
| T6 | Matched pair of IDs between two companies | arrives, not tied to you | **still follows you** | stopped |
| T7 | Disguised subdomain | stopped | **still follows you** | stopped |
| T8 | Like-button frame cookie | stopped | stopped | stopped |
| T9 | ID in local storage | stopped by the end | **still follows you** | stopped |
| T10 | Tab journey in session storage | arrives, not tied to you | **still follows you** | stopped |
| T11 | ID in IndexedDB | arrives, not tied to you | **still follows you** | stopped |
| T12 | ID in cache storage | arrives, not tied to you | **still follows you** | stopped |
| T13 | Service worker holding the ID | **still follows you** | **still follows you** | stopped |
| T14 | Storage totals | arrives, not tied to you | **still follows you** | stopped |
| T15 | Saved script with an ID | arrives, not tied to you | **still follows you** | stopped |
| T16 | Cache tag on an image | arrives, not tied to you | arrives, not tied to you | stopped |
| T17 | Compiled copy of the kit | stopped by the end | **still follows you** | stopped |
| T18 | Saved site icons | your own record, kept | your own record, kept | your own record, kept |
| T19 | History and visited links | your own record, kept | your own record, kept | your own record, kept |
| T20 | Remembered servers | stopped by the end | stopped by the end | stopped |
| T21 | Forced-HTTPS list | stopped | stopped | stopped |
| T22 | Notification permission | **still follows you** | **still follows you** | stopped |
| T23 | Page address and referrer | arrives, not tied to you | **still follows you** | stopped |
| T24 | IP address, browser, language | stopped by the end | **still follows you** | stopped |
| T25 | Computed fingerprint | arrives, not tied to you | **still follows you** | stopped |
| T26 | Events with values | stopped | **still follows you** | stopped |
| T27 | Hashed e-mail | **still follows you** | **still follows you** | **still follows you** |
| T28 | Page-close beacon | stopped | stopped | stopped |
| T29 | Outgoing-click ping | stopped | stopped | stopped |
| T30 | Redirect log | **still follows you** | **still follows you** | **still follows you** |
| T31 | Like and share on the test network's own page | **still follows you** | **still follows you** | **still follows you** |
| T32 | "Sign in with Testbook" | **still follows you** | **still follows you** | **still follows you** |
| T33 | Purchase reported by the shop's server | **still follows you** | **still follows you** | **still follows you** |
| T34 | Push subscription | not built | not built | not built |
| T35 | Typing and mouse rhythm | stopped | **still follows you** | stopped |
| T36 | Probe of programs on your computer | arrives, not tied to you | **still follows you** | stopped |

## The hidden collector

All ten work on first contact. "Stopped" means from the moment the cleaner has seen the same code on two sites, at Balanced and Strongest alike.

| # | Way | After first contact |
|---|---|---|
| F1 | Site's own ID cookie | stopped |
| F2 | ID kept without a cookie, sent to the collector | stopped |
| F3 | ID carried in the link between sites | **still follows you** |
| F4 | Scripted hand-off between sites | **still follows you** |
| F5 | Click record on the site's own server | **still follows you** |
| F6 | Fingerprint used to join sites | stopped |
| F7 | Cookie set during a sign-in | **still follows you** |
| F8 | Page address and referrer | stopped |
| F9 | Probe of programs on your computer | stopped |
| F10 | Cache tag on an image | stopped |
