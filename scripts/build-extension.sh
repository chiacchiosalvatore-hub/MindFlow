#!/usr/bin/env bash
# Build dell'estensione MindFlow Companion:
#   1. (se esiste una cartella public/ di demo web) copia i file del pannello lì;
#   2. crea lo ZIP installabile in download/.
# Percorsi relativi alla posizione di questo script: funziona in qualsiasi
# clone del repository, senza adattamenti.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/mindflow-extension"
DOWNLOAD="${MF_DOWNLOAD_DIR:-$ROOT/download}"
PUB="$ROOT/public/extension"

mkdir -p "$DOWNLOAD"

# 1. Copia per demo web (solo se il clone contiene la cartella public/, es.
#    nell'ambiente di sviluppo con la web app companion accanto).
if [ -d "$ROOT/public" ]; then
  mkdir -p "$PUB"
  cp "$SRC"/*.js "$SRC"/*.css "$SRC"/*.html "$SRC"/manifest.json "$PUB/" 2>/dev/null || true
fi

# Versione letta dal manifest (il nome dello ZIP la segue automaticamente).
VERSION=$(python3 -c "import json;print(json.load(open('$SRC/manifest.json'))['version'])")
ZIP_NAME="mindflow-extension-v$VERSION.zip"

# 2. ZIP installabile (file dell'estensione + icone + README + guida installazione).
rm -f "$DOWNLOAD"/mindflow-extension-v*.zip
TMP_ZIP="$(mktemp -u).zip"
(cd "$SRC" && zip -q -r "$TMP_ZIP" \
  manifest.json background.js engine-client.js adapters.js content.js content.css net-capture.js \
  panel.html panel.css panel.js popup.html popup.css popup.js \
  options.html options.css options.js \
  icons README.md INSTALLAZIONE.md)
mv "$TMP_ZIP" "$DOWNLOAD/$ZIP_NAME"

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
rm -f "$DOWNLOAD"/mindflow-extension-firefox-v*.zip
TMP_FF="$(mktemp -u).zip"
(cd "$FFDIR" && zip -q -r "$TMP_FF" .)
mv "$TMP_FF" "$DOWNLOAD/$FF_ZIP"
rm -rf "$FFDIR"

echo "OK: $DOWNLOAD/$ZIP_NAME"
echo "OK: $DOWNLOAD/$FF_ZIP"
if [ -d "$ROOT/public" ]; then
  echo "OK: demo in $PUB (panel.html, adapters.js…)"
fi
