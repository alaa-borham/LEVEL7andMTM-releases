#!/bin/bash
# The full Windows program of one approved release: Electron 44.9.0, the release's files (level7-cad/releases/v/<v>/app),
# the program's icon, its core sealed (resources/app.asar + its fingerprint in the exe + Electron's fuses).
# Usage: tools/build-windows.sh <version> <out-dir>
set -euo pipefail
V=$1; OUT=${2:-dist}
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/.." && pwd)
SRC="$ROOT/level7-cad/releases/v/$V/app"; [ -d "$SRC" ] || { echo "no release $V"; exit 1; }
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
Z="$OUT/electron-v44.9.0-win32-x64.zip"
[ -f "$Z" ] || curl -fsSL -o "$Z" https://github.com/electron/electron/releases/download/v44.9.0/electron-v44.9.0-win32-x64.zip
D="$OUT/LEVEL7-and-MTM-$V-win32-x64"
rm -rf "$D"; mkdir -p "$D"; unzip -q "$Z" -d "$D"
rm -f "$D/resources/default_app.asar"; mkdir -p "$D/resources/app"
(cd "$SRC" && tar -cf - .) | (cd "$D/resources/app" && tar -xf -)
mv "$D/electron.exe" "$D/LEVEL7 and MTM.exe"
T="$OUT/.tools"; [ -d "$T/node_modules/@electron/fuses" ] || npm install --silent --no-save --prefix "$T" resedit@3.1.0 @electron/asar@3.2.17 @electron/fuses@1.8.0 >/dev/null
NODE_PATH="$T/node_modules" node "$HERE/set-exe-icon.mjs" "$D/LEVEL7 and MTM.exe" "$D/resources/app/assets/icon.ico" "$V"
NODE_PATH="$T/node_modules" node "$HERE/seal-windows.mjs" "$D" "LEVEL7 and MTM.exe"
# the first run: Windows' sandbox must be allowed to read the folder (some folders, e.g. on another drive, do not allow it)
printf '@echo off\r\ncd /d "%%~dp0"\r\nicacls . /grant "*S-1-15-2-1:(OI)(CI)(RX)" /T /Q >nul\r\nstart "" "LEVEL7 and MTM.exe"\r\n' > "$D/LEVEL7 - first run.cmd"
(cd "$OUT" && rm -f "LEVEL7-and-MTM-$V-win32-x64.zip" && zip -qr "LEVEL7-and-MTM-$V-win32-x64.zip" "LEVEL7-and-MTM-$V-win32-x64")
echo "$OUT/LEVEL7-and-MTM-$V-win32-x64.zip"
