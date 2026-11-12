// 0.9.293: seals the built program. The main process (package.json + desktop/: the licence, the updates, the file
// check) goes into resources/app.asar; its fingerprint (SHA-256 of the archive's header, which holds every file's own
// hashes) is written into the exe; Electron's fuses then make the exe load only that archive and refuse it when one byte
// differs, and close the ways around it (running as plain Node, NODE_OPTIONS, the debugger flags).
// The pages stay in resources/app (updated as before; checked by the sealed part against the admin-approved list).
// Usage: node seal-windows.mjs <program-dir> <exe-name>   (needs @electron/asar, @electron/fuses, resedit in NODE_PATH)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar'), { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const [dir, exeName, mode = 'core'] = process.argv.slice(2);
if (!dir || !exeName) { console.error('usage: node seal-windows.mjs <program-dir> <exe-name> [core|whole]'); process.exit(2); }
// «whole» (the admin's program, no updates of its pages): everything in the sealed archive
const exe = path.join(dir, exeName), res = path.join(dir, 'resources'), ui = path.join(res, 'app'), archive = path.join(res, 'app.asar');
const windows = /\.exe$/i.test(exeName);
// the sealed part
if (mode === 'whole') {
  await asar.createPackageWithOptions(ui, archive, {});
  fs.rmSync(ui, { recursive: true, force: true });
} else {
  const core = fs.mkdtempSync(path.join(os.tmpdir(), 'l7-core-'));
  fs.copyFileSync(path.join(ui, 'package.json'), path.join(core, 'package.json'));
  fs.cpSync(path.join(ui, 'desktop'), path.join(core, 'desktop'), { recursive: true });
  await asar.createPackageWithOptions(core, archive, {});
  fs.rmSync(path.join(ui, 'desktop'), { recursive: true, force: true }); // only the sealed copy is used
  fs.rmSync(core, { recursive: true, force: true });
}
const header = asar.getRawHeader(archive).headerString, hash = crypto.createHash('sha256').update(header).digest('hex');
if (windows) {
  // the fingerprint in the exe, as Electron reads it (resource INTEGRITY / ELECTRONASAR)
  const ResEdit = require('resedit');
  const pe = ResEdit.NtExecutable.from(fs.readFileSync(exe), { ignoreCert: true });
  const r = ResEdit.NtExecutableResource.from(pe);
  r.entries = r.entries.filter(e => !(e.type === 'INTEGRITY' && e.id === 'ELECTRONASAR'));
  r.entries.push({ type: 'INTEGRITY', id: 'ELECTRONASAR', lang: 1033, codepage: 1200, bin: Buffer.from(JSON.stringify([{ file: 'resources\\app.asar', alg: 'SHA256', value: hash }]), 'utf8') });
  r.outputResource(pe);
  fs.writeFileSync(exe, Buffer.from(pe.generate()));
}
await flipFuses(exe, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: windows,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
});
console.log(`sealed: ${archive} (header ${hash.slice(0, 12)}…)${windows ? ' + fingerprint in the exe' : ''}; fuses set on ${exeName}`);
