#!/usr/bin/env bash
# Pack Tracker Cleaner as a signed .crx + update.xml for Chrome's policy force-install.
# Served at http://127.0.0.1:8088/cleaner/update.xml (Chrome policy ExtensionInstallForcelist).
# Bump "version" in manifest.json before packing, or Chrome won't pick up the change.
# Without the signing key nothing is packed: the lists are rebuilt and the steps to load the folder unpacked are printed.
# A file added to the extension must be added to the cp line below (test/pack.test.js checks it).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; KEY="$HOME/.config/tracker-cleaner/key.pem"; DIST="$HERE/dist"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
node "$HERE/build.js" >/dev/null
if ! [ -f "$KEY" ]; then
  cat <<TXT
No signing key at $KEY, so no .crx was packed. The lists were rebuilt.
To use the extension, load the folder unpacked:
  1. Open chrome://extensions and switch on "Developer mode" (top right).
  2. Remove or switch off any other copy of Tracker Cleaner: two copies would fight.
  3. Press "Load unpacked" and choose $HERE
After a change to the files, press the reload arrow on its card.
What to try next: $(dirname "$HERE")/TESTING.md
TXT
  exit 0
fi
command -v google-chrome >/dev/null || { echo "google-chrome not found: it is needed to pack the .crx" >&2; exit 1; }
mkdir -p "$TMP/tracker-cleaner" "$DIST"
cp "$HERE"/{manifest.json,background.js,core.js,registry.js,guard.js,queue.js,undo.js,loop.js,history.js,lists.js,rules.json,rules-google.json,rules-params.json,yt-adfree.js,yt-adfree.css,popup.html,popup.js,popup-view.js,popup-audit.js,history.html,history-view.js,history-page.js} "$TMP/tracker-cleaner/"
timeout 120 google-chrome --headless=new --user-data-dir="$TMP/prof" --no-first-run \
  --pack-extension="$TMP/tracker-cleaner" --pack-extension-key="$KEY" >/dev/null 2>&1 || true
[ -s "$TMP/tracker-cleaner.crx" ] || { echo "pack failed: google-chrome wrote no .crx (is $KEY a valid RSA key?)" >&2; exit 1; }
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
