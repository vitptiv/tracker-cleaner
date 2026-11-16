#!/usr/bin/env bash
# Pack Tracker Cleaner as a signed .crx + update.xml for Chrome's policy force-install.
# Served at http://127.0.0.1:8088/cleaner/update.xml (Chrome policy ExtensionInstallForcelist).
# Bump "version" in manifest.json before packing, or Chrome won't pick up the change.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; KEY="$HOME/.config/tracker-cleaner/key.pem"; DIST="$HERE/dist"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
node "$HERE/build.js" >/dev/null
mkdir -p "$TMP/tracker-cleaner" "$DIST"
cp "$HERE"/{manifest.json,background.js,lists.js,rules.json,yt-adfree.js,yt-adfree.css,popup.html,popup.js} "$TMP/tracker-cleaner/"
timeout 120 google-chrome --headless=new --user-data-dir="$TMP/prof" --no-first-run \
  --pack-extension="$TMP/tracker-cleaner" --pack-extension-key="$KEY" >/dev/null 2>&1 || true
[ -s "$TMP/tracker-cleaner.crx" ] || { echo "pack failed" >&2; exit 1; }
ID=$(openssl rsa -in "$KEY" -pubout -outform DER 2>/dev/null | sha256sum | head -c 32 | tr '0-9a-f' 'a-p')
VER=$(node -p "require('$HERE/manifest.json').version")
cp "$TMP/tracker-cleaner.crx" "$DIST/tracker-cleaner.crx"
cat > "$DIST/update.xml" <<XML
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='$ID'><updatecheck codebase='http://127.0.0.1:8088/cleaner/tracker-cleaner.crx' version='$VER' /></app>
</gupdate>
XML
echo "$ID $VER"
