// The build of the full program starts only from a release the admin approved: the approval signed with the admin's key
// (checked by the program's own licence code) for exactly this list of files, and every file of the release matching it.
// Usage: node tools/verify-release.mjs <version>
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { createRequire } from 'node:module';
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.error('usage: verify-release.mjs <version>'); process.exit(2); }
const R = 'level7-cad/releases', app = path.resolve(R, 'v', v, 'app');
const L = createRequire(import.meta.url)(path.join(app, 'desktop', 'license.cjs'));
const text = fs.readFileSync(path.join(R, 'manifests', v + '.json'), 'utf8');
const m = L.approvedManifest(text, fs.readFileSync(path.join(R, 'approvals', v + '.json'), 'utf8'), L.BUILT_IN_PUBLIC_KEY);
if (!m || m.version !== v) { console.error(`${v}: not approved by the admin's key`); process.exit(1); }
const listed = new Set();
for (const f of m.files) {
  const b = fs.readFileSync(path.join(app, ...f.path.split('/')));
  if (b.length !== f.size || crypto.createHash('sha256').update(b).digest('hex') !== f.sha256) { console.error(`${v}: ${f.path} differs from the approved list`); process.exit(1); }
  listed.add(f.path);
}
const walk = d => fs.readdirSync(path.join(app, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d ? d + '/' + e.name : e.name) : [d ? d + '/' + e.name : e.name]);
const extra = walk('').filter(f => !listed.has(f));
if (extra.length) { console.error(`${v}: files not in the approved list: ${extra.join(', ')}`); process.exit(1); }
console.log(`${v}: approved by the admin's key; ${m.files.length} files match`);
