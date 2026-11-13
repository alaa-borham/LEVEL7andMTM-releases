'use strict';
// LEVEL7 CAD MTM Admin 1.5.1 — the program updates ITSELF in full (the owner: «أفضل عند تحديث المدير أوتوماتيك مثل
// الباقية»). Until now a release that changed the sealed core had to be downloaded by hand from the Releases page,
// unpacked, and started with «first run». Now: «تحديث الآن» downloads the program's package (its size and fingerprint as
// the build wrote them), unpacks it, starts the new program once to see that it works, and then — when this one has
// closed — a small script puts the new files in the place of the old ones (the old ones kept, and put back if the copy
// fails) and opens the program again.
// No Electron in this file: the build checks it on a real Windows machine with plain Node (see selfTest below).
// (inside the program: Electron's own «fs» looks INTO every file named *.asar — the new program's app.asar is a plain
// file here, to be written, found and removed as it is: the unchanged fs is used. With plain Node it is fs itself.)
const fs = (() => { try { return require('original-fs'); } catch { return require('node:fs'); } })();
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const EXE = 'LEVEL7 CAD MTM Admin.exe';

// ---- a zip unpacked without any other program (as «zip -r» writes it: stored or deflated entries, no zip64)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** The entries of a zip: [{ name, dir, method, crc, size, csize, offset }] */
function zipEntries(buf) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw Error('ليس ملف zip صالحاً.');
  const count = buf.readUInt16LE(e + 10), cdSize = buf.readUInt32LE(e + 12), cdAt = buf.readUInt32LE(e + 16);
  if (count === 0xffff || cdAt === 0xffffffff || cdSize === 0xffffffff) throw Error('ملف zip من نوع zip64 غير مدعوم.');
  const out = [];
  let p = cdAt;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw Error('فهرس ملف zip تالف.');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24), n = buf.readUInt16LE(p + 28), x = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    if (flags & 1) throw Error('ملف zip مشفَّر.');
    if (csize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw Error('ملف zip من نوع zip64 غير مدعوم.');
    const name = buf.subarray(p + 46, p + 46 + n).toString('utf8').replace(/\\/g, '/');
    out.push({ name, dir: name.endsWith('/'), method, crc, size, csize, offset });
    p += 46 + n + x + c;
  }
  return out;
}
/** Unpacks a zip into a folder (every file checked against the zip's own CRC). Returns the number of files written. */
function extractZip(zipFile, dest) {
  const buf = fs.readFileSync(zipFile);
  const root = path.resolve(dest);
  let files = 0;
  for (const en of zipEntries(buf)) {
    const parts = en.name.split('/').filter(Boolean);
    // (never outside the folder: no «..», no drive, no absolute path, no name Windows reads otherwise)
    if (!parts.length || parts.some(s => s === '..' || s === '.' || /[:*?"<>|\x00-\x1f]/.test(s)) || en.name.startsWith('/')) throw Error('ملف zip يحتوي مساراً غير مسموح: ' + en.name);
    const target = path.join(root, ...parts);
    if (target !== root && !target.startsWith(root + path.sep)) throw Error('ملف zip يحتوي مساراً غير مسموح: ' + en.name);
    if (en.dir) { fs.mkdirSync(target, { recursive: true }); continue; }
    if (buf.readUInt32LE(en.offset) !== 0x04034b50) throw Error('ملف zip تالف عند ' + en.name);
    const at = en.offset + 30 + buf.readUInt16LE(en.offset + 26) + buf.readUInt16LE(en.offset + 28);
    const raw = buf.subarray(at, at + en.csize);
    let data;
    if (en.method === 0) data = raw;
    else if (en.method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(en.size, 1) });
    else throw Error('طريقة ضغط غير مدعومة في ملف zip: ' + en.name);
    if (data.length !== en.size || crc32(data) !== en.crc) throw Error('ملف تالف داخل zip: ' + en.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    files++;
  }
  return files;
}

/** The folder that holds the program inside an unpacked package (the package has one folder around it). */
function findProgram(dir, exe = EXE) {
  const has = d => fs.existsSync(path.join(d, exe)) && fs.existsSync(path.join(d, 'resources'));
  if (has(dir)) return dir;
  for (const n of fs.readdirSync(dir)) { const d = path.join(dir, n); try { if (fs.statSync(d).isDirectory() && has(d)) return d; } catch {} }
  return null;
}

// ---- the script that puts the new program in place, once this one has closed
// Everything it needs comes as arguments (never written into the script: a folder with Arabic letters or spaces in its
// name is then passed as it is). %1 the process to wait for · %2 the new program · %3 the program's folder · %4 its exe ·
// %5 where the old program is kept · %6 where the result is written («ok» / «failed» / «nobackup»).
const APPLY_CMD = [
  '@echo off',
  'setlocal',
  'set n=0',
  ':wait',
  'tasklist /FI "PID eq %~1" /NH 2>nul | find "%~1" >nul',
  'if errorlevel 1 goto gone',
  'set /a n+=1',
  'if %n% geq 90 goto gone',
  'ping -n 2 127.0.0.1 >nul',
  'goto wait',
  ':gone',
  'robocopy "%~3" "%~5" /MIR /R:3 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
  'if errorlevel 8 goto nobackup',
  'robocopy "%~2" "%~3" /E /R:10 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
  'if errorlevel 8 goto failed',
  'echo ok>"%~6"',
  'goto start',
  ':failed',
  'robocopy "%~5" "%~3" /E /R:10 /W:1 /NFL /NDL /NJH /NJS /NP >nul',
  'echo failed>"%~6"',
  'goto start',
  ':nobackup',
  'echo nobackup>"%~6"',
  ':start',
  'if not defined L7A_NO_START start "" /d "%~3" "%~3\\%~4"',
  'endlocal',
  'exit /b 0',
  ''
].join('\r\n');
// (other systems — the program is for Windows; this is what the tests here run)
const APPLY_SH = [
  '#!/bin/sh',
  'n=0',
  'while kill -0 "$1" 2>/dev/null && [ $n -lt 90 ]; do n=$((n+1)); sleep 1; done',
  'rm -rf "$5"; mkdir -p "$5" && cp -a "$3/." "$5/" || { echo nobackup > "$6"; exit 0; }',
  'if cp -a "$2/." "$3/"; then echo ok > "$6"; else cp -a "$5/." "$3/"; echo failed > "$6"; fi',
  '[ -n "$L7A_NO_START" ] || ("$3/$4" >/dev/null 2>&1 &)',
  ''
].join('\n');
/** Writes the script into `dir` and returns how to start it: { command, args, options }. */
function applyScript(dir, { pid, from, to, exe = EXE, backup, result }, platform = process.platform) {
  fs.mkdirSync(dir, { recursive: true });
  const a = [String(pid), from, to, exe, backup, result];
  if (platform === 'win32') {
    const file = path.join(dir, 'apply-admin-update.cmd');
    fs.writeFileSync(file, APPLY_CMD, 'latin1');
    for (const s of [file, ...a]) if (/["%]/.test(s)) throw Error('اسم المجلد يحتوي علامة لا يمكن تمريرها: ' + s);
    // cmd.exe: the whole command inside one more pair of quotes (/s), the arguments exactly as written here
    const line = [file, ...a].map(s => `"${s}"`).join(' ');
    return { file, command: path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'cmd.exe'), args: ['/d', '/s', '/c', `"${line}"`],
      // (a hidden console of its own, which the commands it runs share — started «detached» it has none, and each of
      // them would open a window of its own; on Windows it goes on after the program has closed either way)
      options: { windowsVerbatimArguments: true, windowsHide: true, detached: false } };
  }
  const file = path.join(dir, 'apply-admin-update.sh');
  fs.writeFileSync(file, APPLY_SH, { mode: 0o755 });
  return { file, command: '/bin/sh', args: [file, ...a], options: { detached: true } };
}

/** Downloads `url` into `file` (through `fetch`), checking size and SHA-256; onProgress(0…1). */
async function downloadTo(fetch, url, file, { size, sha256, onProgress = () => {} }) {
  const r = await fetch(url);
  if (!r.ok) throw Error('تعذر تنزيل البرنامج: HTTP ' + r.status);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const part = file + '.part', h = crypto.createHash('sha256');
  const fd = fs.openSync(part, 'w');
  let got = 0, last = -1;
  try {
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const b = Buffer.from(value);
      got += b.length;
      if (got > size) throw Error('حجم الملف المنزَّل أكبر من المنتظر؛ لم يُثبَّت شيء.');
      h.update(b); fs.writeSync(fd, b);
      const pct = Math.floor(got / size * 100);
      if (pct !== last) { last = pct; onProgress(got / size); }
    }
  } finally { fs.closeSync(fd); }
  if (got !== size || h.digest('hex') !== sha256) { fs.rmSync(part, { force: true }); throw Error('فشل التحقق من الملف المنزَّل؛ لم يُثبَّت شيء.'); }
  fs.rmSync(file, { force: true }); fs.renameSync(part, file);
  return file;
}

/** What the build wrote about a program package: { version, url, sha256, size } or null. */
function programInfo(text, version, repo) {
  try {
    const j = JSON.parse(text);
    if (j?.version !== version || !/^[a-f0-9]{64}$/.test(j.sha256 || '') || !Number.isInteger(j.size) || j.size <= 0 || j.size > 600 * 1024 * 1024) return null;
    if (!String(j.url || '').startsWith(`https://github.com/${repo}/releases/download/admin-v${version}/`)) return null;
    return { version: j.version, url: j.url, sha256: j.sha256, size: j.size };
  } catch { return null; }
}

// ---- the check the build runs on a real Windows machine (and the tests here): node self-update.cjs --self-test [zip]
function selfTest(zip) {
  const os = require('node:os');
  const assert = require('node:assert/strict');
  // (a folder with a space and Arabic letters in its name: as a user's own folder may be)
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'l7a مجلد تجربة '));
  const say = t => console.log('PASS ' + t);
  const tree = (d, base = d) => fs.readdirSync(d).flatMap(n => { const f = path.join(d, n); return fs.statSync(f).isDirectory() ? tree(f, base) : [path.relative(base, f).replace(/\\/g, '/') + '=' + crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 12)]; }).sort();
  const make = (d, files) => { for (const [n, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, n)), { recursive: true }); fs.writeFileSync(path.join(d, n), t); } return d; };
  const dead = () => spawnSync(process.execPath, ['-e', '0']).pid;                          // a process that has ended
  const run = (o, env = {}) => { const s = applyScript(path.join(T, 'script'), o); const r = spawnSync(s.command, s.args, { ...s.options, env: { ...process.env, L7A_NO_START: '1', ...env }, timeout: 240000 }); assert.equal(r.status, 0, 'the script ended (' + r.status + ') ' + (r.stderr || '')); };
  const old = { [EXE]: 'old program', 'resources/app.asar': 'old core', 'resources/app-ui/admin.js': 'old screen', 'locales/ar.pak': 'same' };
  const next = { [EXE]: 'new program', 'resources/app.asar': 'new core', 'resources/app-ui/admin.js': 'new screen', 'locales/ar.pak': 'same', 'resources/new-file.bin': 'added' };

  // 1. the new program takes the place of the old one; the old one is kept
  {
    const to = make(path.join(T, 'program folder'), old), from = make(path.join(T, 'new'), next), backup = path.join(T, 'kept'), result = path.join(T, 'result 1.txt');
    run({ pid: dead(), from, to, backup, result });
    assert.equal(fs.readFileSync(result, 'utf8').trim(), 'ok');
    assert.deepEqual(tree(to), tree(from));
    assert.deepEqual(tree(backup), tree(make(path.join(T, 'old-again'), old)));
    say('the new program takes the place of the old one (the old one kept beside)');
  }
  // 2. the copy cannot be made (the new program is not there): the old program is put back, and it is said
  {
    const to = make(path.join(T, 'program 2'), old), backup = path.join(T, 'kept 2'), result = path.join(T, 'result 2.txt');
    fs.writeFileSync(path.join(to, 'resources', 'app.asar'), 'old core');
    run({ pid: dead(), from: path.join(T, 'nothing here'), to, backup, result });
    assert.equal(fs.readFileSync(result, 'utf8').trim(), 'failed');
    assert.deepEqual(tree(to), tree(make(path.join(T, 'old-again-2'), old)));
    say('a copy that cannot be made: the old program is put back and the result says so');
  }
  // 3. it waits for the program to close
  {
    const to = make(path.join(T, 'program 3'), old), from = make(path.join(T, 'new 3'), next), backup = path.join(T, 'kept 3'), result = path.join(T, 'result 3.txt');
    const alive = spawn(process.execPath, ['-e', 'setTimeout(()=>{},4000)'], { stdio: 'ignore' });
    const t0 = Date.now();
    run({ pid: alive.pid, from, to, backup, result });
    assert.ok(Date.now() - t0 >= 2500, 'waited for the program (' + (Date.now() - t0) + ' ms)');
    assert.equal(fs.readFileSync(result, 'utf8').trim(), 'ok');
    say('the script waits until the program has closed');
  }
  // 4. unpacking: a package made by «zip -r»; nothing is written outside the folder
  if (zip) {
    const d = path.join(T, 'unpacked');
    const n = extractZip(zip, d);
    const prog = findProgram(d);
    assert.ok(prog && n > 50, 'the program is in the package (' + n + ' files)');
    assert.ok(fs.statSync(path.join(prog, EXE)).size > 50e6 && fs.existsSync(path.join(prog, 'resources', 'app.asar')));
    say(`the program's package is unpacked without any other program (${n} files, each checked)`);
  }
  {
    const le = (v, n) => { const b = Buffer.alloc(n); n === 2 ? b.writeUInt16LE(v) : b.writeUInt32LE(v); return b; };
    const one = (name, data) => {
      const nm = Buffer.from(name), crc = crc32(data);
      const local = Buffer.concat([le(0x04034b50, 4), le(20, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(nm.length, 2), le(0, 2), nm, data]);
      const cd = Buffer.concat([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(crc, 4), le(data.length, 4), le(data.length, 4), le(nm.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(0, 4), nm]);
      return Buffer.concat([local, cd, le(0x06054b50, 4), le(0, 2), le(0, 2), le(1, 2), le(1, 2), le(cd.length, 4), le(local.length, 4), le(0, 2)]);
    };
    const z = path.join(T, 'z.zip');
    fs.writeFileSync(z, one('dir/a.txt', Buffer.from('inside')));
    assert.equal(extractZip(z, path.join(T, 'z1')), 1); assert.equal(fs.readFileSync(path.join(T, 'z1', 'dir', 'a.txt'), 'utf8'), 'inside');
    for (const bad of ['../outside.txt', 'a/../../outside.txt', '/abs.txt', 'C:/x.txt', 'dir\\..\\..\\outside.txt']) {
      fs.writeFileSync(z, one(bad, Buffer.from('x')));
      assert.throws(() => extractZip(z, path.join(T, 'z2')), /مساراً غير مسموح/, bad);
    }
    assert.ok(!fs.existsSync(path.join(T, 'outside.txt')));
    const broken = one('a.txt', Buffer.from('inside')); broken[30 + 5 + 2] ^= 1; fs.writeFileSync(z, broken);
    assert.throws(() => extractZip(z, path.join(T, 'z3')), /ملف تالف داخل zip/);
    say('a package is never unpacked outside its folder, and a damaged file in it is refused');
  }
  fs.rmSync(T, { recursive: true, force: true });
}

module.exports = { fs, EXE, extractZip, zipEntries, findProgram, applyScript, downloadTo, programInfo, crc32, selfTest };
if (require.main === module && process.argv[2] === '--self-test') { try { selfTest(process.argv[3]); } catch (e) { console.error(e); process.exit(1); } }
