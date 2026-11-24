#!/usr/bin/env bash
# Build dell'estensione MindFlow Companion:
#   1. copia i file del pannello/adattatori in public/ per la demo web e il selftest;
#   2. crea lo ZIP installabile in download/ e in public/ (scaricabile dall'anteprima).
set -euo pipefail

ROOT="/home/z/my-project"
SRC="$ROOT/mindflow-extension"
PUB="$ROOT/public/extension"
DOWNLOAD="$ROOT/download"

mkdir -p "$PUB" "$DOWNLOAD"

# 1. Copia per demo web (tutti i file, serviti come asset statici).
cp "$SRC"/*.js "$SRC"/*.css "$SRC"/*.html "$SRC"/manifest.json "$PUB/" 2>/dev/null || true

# Versione letta dal manifest (il nome dello ZIP la segue automaticamente).
VERSION=$(python3 -c "import json;print(json.load(open('$SRC/manifest.json'))['version'])")
ZIP_NAME="mindflow-extension-v$VERSION.zip"

# 2. ZIP installabile (file dell'estensione + icone + README + guida installazione).
rm -f "$DOWNLOAD"/mindflow-extension-v*.zip "$ROOT/public/mindflow-extension.zip"
(cd "$SRC" && zip -q -r "/tmp/$ZIP_NAME" \
  manifest.json background.js engine-client.js adapters.js content.js content.css net-capture.js \
  panel.html panel.css panel.js popup.html popup.css popup.js \
  options.html options.css options.js \
  icons README.md INSTALLAZIONE.md)
cp "/tmp/$ZIP_NAME" "$DOWNLOAD/$ZIP_NAME"
cp "/tmp/$ZIP_NAME" "$ROOT/public/mindflow-extension.zip"

# 3. Variante Firefox: stesso codice, manifest adattato (event page invece
#    del service worker + id gecko). Lo ZIP separato si carica con
#    about:debugging -> "Carica componente aggiuntivo temporaneo".
FFDIR=$(mktemp -d)
cp -r "$SRC"/. "$FFDIR"/
python3 - "$FFDIR/manifest.json" <<'PY'
import json, sys

path = sys.argv[1]
with open(path) as f:
    m = json.load(f)

m["background"] = {"scripts": ["background.js"]}
m["browser_specific_settings"] = {
    "gecko": {"id": "mindflow@companion.extension", "strict_min_version": "115.0"}
}

with open(path, "w") as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
PY
FF_ZIP="mindflow-extension-firefox-v$VERSION.zip"
rm -f "$DOWNLOAD"/mindflow-extension-firefox-v*.zip "$ROOT/public/mindflow-extension-firefox.zip"
(cd "$FFDIR" && zip -q -r "/tmp/$FF_ZIP" .)
cp "/tmp/$FF_ZIP" "$DOWNLOAD/$FF_ZIP"
cp "/tmp/$FF_ZIP" "$ROOT/public/mindflow-extension-firefox.zip"
rm -rf "$FFDIR"

echo "OK: $DOWNLOAD/$ZIP_NAME"
echo "OK: $ROOT/public/mindflow-extension.zip"
echo "OK: $DOWNLOAD/$FF_ZIP"
echo "OK: $ROOT/public/mindflow-extension-firefox.zip"
echo "OK: demo in $PUB (panel.html, adapters.js…)"
