#!/bin/bash
# Builds «LEVEL7 CAD MTM Admin» for Windows (the admin's own program): the admin-app files with the program's
# license.cjs (from the latest release), the stock Electron 44.9.0 runtime, the LEVEL7 icon, all sealed in app.asar
# with its fingerprint in the exe and Electron's fuses set. Usage: build-admin-windows.sh <out-dir>
set -euo pipefail
OUT=${1:-dist}; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$OUT"; OUT=$(cd "$OUT" && pwd)
V=$(node -p "require(require('path').resolve(process.argv[1])).version" "$HERE/admin-app/package.json") # the path as an argument (Windows bash turns it into a Windows path)
Z="$OUT/electron-v44.9.0-win32-x64.zip"
[ -f "$Z" ] || curl -fsSL -o "$Z" https://github.com/electron/electron/releases/download/v44.9.0/electron-v44.9.0-win32-x64.zip
D="$OUT/LEVEL7-CAD-MTM-Admin-$V-win32-x64"
rm -rf "$D"; mkdir -p "$D"; unzip -q "$Z" -d "$D"
rm -f "$D/resources/default_app.asar"
node "$HERE/tools/build-admin.mjs" "$HERE/releases/app/desktop/license.cjs" "$D/resources/app" "$D/resources/app-ui" # the core sealed below; the screen beside it (updated from inside the program)
mv "$D/electron.exe" "$D/LEVEL7 CAD MTM Admin.exe"
T="$OUT/.icon-tools"; [ -d "$T/node_modules/@electron/fuses" ] || npm install --silent --no-save --prefix "$T" resedit@3.1.0 @electron/asar@3.2.17 @electron/fuses@1.8.0 >/dev/null
NODE_PATH="$T/node_modules" node "$HERE/tools/set-exe-icon.mjs" "$D/LEVEL7 CAD MTM Admin.exe" "$D/resources/app/icon.ico" "$V"
NODE_PATH="$T/node_modules" node "$HERE/tools/seal-windows.mjs" "$D" "LEVEL7 CAD MTM Admin.exe" whole
# a first run: Windows' sandbox must be allowed to read the folder (some folders, e.g. on another drive, do not allow
# it and the program would not start) — the same read permission Program Files has; then the program starts
printf '@echo off\r\ncd /d "%%~dp0"\r\nicacls . /grant "*S-1-15-2-1:(OI)(CI)(RX)" /T /Q >nul\r\nstart "" "LEVEL7 CAD MTM Admin.exe"\r\n' > "$D/LEVEL7 Admin - first run.cmd"
# NOZIP=1: leave the folder only (the check on a Windows machine runs it there)
if [ "${NOZIP:-}" = 1 ]; then echo "$D"; exit 0; fi
(cd "$OUT" && rm -f "LEVEL7-CAD-MTM-Admin-$V-win32-x64.zip" && zip -qr "LEVEL7-CAD-MTM-Admin-$V-win32-x64.zip" "LEVEL7-CAD-MTM-Admin-$V-win32-x64")
echo "$OUT/LEVEL7-CAD-MTM-Admin-$V-win32-x64.zip"
