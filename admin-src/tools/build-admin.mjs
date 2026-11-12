// LEVEL7 CAD MTM Admin: assembles the admin program with license.cjs (the same signing and checking code as the design
// program). Its core (main, preload, license, package.json, icon.ico) and its screen (the page, its script, styles,
// catalogue, icon.png, ui-version.json) — the screen in a folder of its own when <ui-out> is given (the built program:
// the core sealed in app.asar, the screen beside it, updated from inside the program); the core carries the list of the
// screen's files (ui-manifest.json) it checks at every start.
// Usage: node build-admin.mjs <license.cjs> <out-dir> [<ui-out-dir>]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), srcDir = path.join(here, '..', 'admin-app');
export const CORE = ['main.cjs', 'preload.cjs', 'package.json', 'icon.ico'];
export const UI = ['index.html', 'admin.js', 'admin.css', 'catalogue.json', 'icon.png', 'ui-version.json'];
const [lic, out, uiOut] = process.argv.slice(2);
if (!lic || !out) { console.error('usage: node build-admin.mjs <license.cjs> <out-dir> [<ui-out-dir>]'); process.exit(2); }
const ui = uiOut || out;
for (const d of new Set([out, ui])) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
for (const f of CORE) fs.copyFileSync(path.join(srcDir, f), path.join(out, f));
fs.copyFileSync(lic, path.join(out, 'license.cjs'));
const files = UI.map(f => { const b = fs.readFileSync(path.join(srcDir, f)); fs.writeFileSync(path.join(ui, f), b); return { path: f, sha256: crypto.createHash('sha256').update(b).digest('hex'), size: b.length }; });
const version = JSON.parse(fs.readFileSync(path.join(srcDir, 'ui-version.json'), 'utf8')).version;
fs.writeFileSync(path.join(out, 'ui-manifest.json'), JSON.stringify({ product: 'LEVEL7 CAD MTM Admin', kind: 'admin-ui', version, files }, null, 1));
console.log(`admin program: core ${out}${uiOut ? `, screen ${ui}` : ''} (${CORE.length + 2} + ${UI.length} files)`);
