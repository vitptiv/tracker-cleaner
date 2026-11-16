#!/bin/sh
# Registers the Wi-Fi helper as a native messaging host for one extension id.
# Per-user only: writes into your own browser profile folders, never needs sudo.
set -eu

ID="${1:-}"
# An extension id is exactly 32 letters a-p. Checked because it is written into a JSON file.
if ! printf '%s' "$ID" | grep -Eqx '[a-p]{32}'; then
  echo "Usage: sh install.sh <extension id>   (32 letters, shown on chrome://extensions)" >&2
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)" || { echo "node not found" >&2; exit 1; }
NAME=com.tracker_cleaner.wifi
LAUNCHER="$HERE/host-launcher.sh"

# Paths end up inside a shell script and a JSON string; refuse the characters that would break either.
case "$HERE$NODE" in *[\"\'\\]*) echo "Path contains a quote or backslash, move the folder." >&2; exit 1;; esac

# Chrome starts the host with a minimal PATH, so the launcher names node by its absolute path.
printf '#!/bin/sh\nexec "%s" "%s/host.js"\n' "$NODE" "$HERE" > "$LAUNCHER"
chmod +x "$LAUNCHER"

DONE=0
for BROWSER in "$HOME/.config/google-chrome" "$HOME/.config/chromium"; do
  [ -d "$BROWSER" ] || continue   # only browsers that are installed for this user
  mkdir -p "$BROWSER/NativeMessagingHosts"
  cat > "$BROWSER/NativeMessagingHosts/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "Tracker Cleaner: lists and removes saved Wi-Fi networks",
  "path": "$LAUNCHER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
EOF
  echo "Wrote $BROWSER/NativeMessagingHosts/$NAME.json"
  DONE=1
done
[ "$DONE" = 1 ] || { echo "No Google Chrome or Chromium profile folder found." >&2; exit 1; }
