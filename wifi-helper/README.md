# Wi-Fi helper (C24)

A Chrome extension cannot see saved Wi-Fi networks. This small local program can: it lists the
networks NetworkManager has saved, proposes the stale ones, and removes only those you approve.

A network is proposed when it is not in use now and was either never used or not used for more
than 30 days.

## Two ways to use it

From a terminal:

    node cli.js list                  # what could be removed, and whether deletion is permitted
    node cli.js remove <uuid>...      # shows the networks, removes them only after you type "yes"

From the extension (native messaging): the extension asks for the list, shows an
Approve / Postpone row, and sends back only the UUIDs you approved.

## Install for the extension

    sh install.sh <extension id>

The id is the 32-letter string on chrome://extensions. The script writes
`com.tracker_cleaner.wifi.json` into the Google Chrome and Chromium folders of your own user
and a `host-launcher.sh` next to it here. No sudo. To uninstall, delete those files.
Run it again if you move this folder or the extension id changes.

## What it never does

- Never removes a network without an approval (typed "yes", or Approve in the extension).
- Never removes the network in use, or one used in the last 30 days, even if asked to.
  The list is read again just before deleting.
- Never removes a network whose last-use time it cannot read. Such a network is still listed.
- Removes nothing at all unless NetworkManager lets this user delete saved networks outright
  (`nmcli general permissions`: `settings.modify.system` is `yes`). If that would need a
  password prompt, every request is refused with that reason.
- Never touches ethernet, VPN or any other non-Wi-Fi connection.
- Never reads, prints or sends a Wi-Fi password. Removing a network does forget its password.
- Never goes through a shell, never uses sudo, never connects to the internet.
- Runs no command other than `nmcli general permissions`, `nmcli connection show` and
  `nmcli connection delete uuid <uuid>`.
