'use strict';
// LEVEL7 CAD MTM Admin — the super admin's own program (on the admin's computer only). It keeps the users (names stay here; the
// published policy holds only their hashes), signs the policy with the admin's key and publishes it where every copy of
// LEVEL7 and MTM reads it; it approves new releases of the program (which makes them available to the computers).
// The key file stays where the admin keeps it (opened with its pass phrase each time); the GitHub token is kept
// encrypted by Windows (safeStorage) on this computer.
const { app, BrowserWindow, ipcMain, dialog, safeStorage, session, Menu, net: electronNet } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./license.cjs');
const SU = require('./self-update.cjs');

const DEV = !app.isPackaged;
const LOCAL = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local');
// development / tests: own data folder, a folder instead of GitHub, dialogs answered from a folder, a test key
const DATA = DEV && process.env.L7A_DATA ? process.env.L7A_DATA : path.join(LOCAL, 'LEVEL7 CAD MTM Admin');
const TARGET_DIR = DEV ? process.env.L7A_TARGET_DIR || '' : '';
const TEST_DIR = DEV ? process.env.L7_TEST_DIALOG_DIR || '' : '';
const PUBKEY = DEV && process.env.L7_LICENSE_PUBKEY ? process.env.L7_LICENSE_PUBKEY : L.BUILT_IN_PUBLIC_KEY;
const CAD_DRAFT = DEV && process.env.L7A_CAD_DRAFT ? process.env.L7A_CAD_DRAFT : path.join(LOCAL, 'LEVEL7 CAD', 'License', 'admin-draft.json');
const REPO = L.RELEASES_REPO;
// tests: GitHub itself replaced by a local server (its API and its upload address)
const GH_API = DEV && process.env.L7A_GH_API ? process.env.L7A_GH_API : 'https://api.github.com';
const GH_UPLOADS = DEV && process.env.L7A_GH_UPLOADS ? process.env.L7A_GH_UPLOADS : 'https://uploads.github.com';
const crypto = require('node:crypto');

// ---- the screen's files (updated from inside the program). In the built program the core (this file, the key, signing,
// publishing, the updater) is sealed in resources/app.asar; the screen is beside it in resources/app-ui and is checked at
// every start: its files must be those of the sealed list (the version installed) or of a list the admin signed with
// his key when he updated. Anything else: the program does not start.
const SEALED = /[\\/]app\.asar([\\/]|$)/.test(__dirname);
const UI_ROOT = DEV && process.env.L7A_UI_DIR ? process.env.L7A_UI_DIR : SEALED ? path.join(process.resourcesPath, 'app-ui') : __dirname;
const CHECK_UI = SEALED || (DEV && !!process.env.L7A_UI_DIR);
const ADMIN_DIR = 'level7-cad/admin';
// 1.5.1: the program updates itself in full (see self-update.cjs). The folder it runs from; tests give one.
const INSTALL_DIR = DEV ? process.env.L7A_INSTALL_DIR || '' : path.dirname(process.execPath);
const UPDATES = () => path.join(DATA, 'Updates');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const uiVersion = () => { try { return JSON.parse(fs.readFileSync(path.join(UI_ROOT, 'ui-version.json'), 'utf8')).version; } catch { return '0.0.0'; } };
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b || '0.0.0').split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const uiMatches = m => Array.isArray(m?.files) && m.files.every(f => { try { return sha(fs.readFileSync(path.join(UI_ROOT, ...String(f.path).split('/')))) === f.sha256; } catch { return false; } });
function signedByAdmin(manifestText, approvalText) {
  try {
    const env = JSON.parse(approvalText);
    if (!crypto.verify(null, Buffer.from(env.payload, 'utf8'), crypto.createPublicKey({ key: Buffer.from(PUBKEY, 'base64'), format: 'der', type: 'spki' }), Buffer.from(env.sig, 'base64'))) return false;
    const a = JSON.parse(env.payload);
    return a.product === 'LEVEL7 CAD MTM Admin' && a.kind === 'admin-ui' && a.manifestSha256 === sha(Buffer.from(manifestText, 'utf8'));
  } catch { return false; }
}
/** the screen as it was before an update of it that did not finish (also one cut by a stop of the computer) */
function restoreUi(backup) {
  let j = null;
  try { j = JSON.parse(fs.readFileSync(path.join(backup, '.files'), 'utf8')); } catch { return false; }
  for (const p of j.files || []) {
    try { fs.rmSync(path.join(UI_ROOT, p + '.new'), { force: true }); } catch {}
    try {
      if ((j.added || []).includes(p)) fs.rmSync(path.join(UI_ROOT, p), { force: true });
      else if (fs.existsSync(path.join(backup, p))) fs.copyFileSync(path.join(backup, p), path.join(UI_ROOT, p));
    } catch {}
  }
  try { if (j.approved === null) fs.rmSync(file('admin-ui-approved.json'), { force: true }); else if (typeof j.approved === 'string') fs.writeFileSync(file('admin-ui-approved.json'), j.approved); } catch {}
  try { fs.rmSync(path.join(backup, '.files'), { force: true }); } catch {}
  return true;
}
function uiIntact() {
  let built = null;
  try { built = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui-manifest.json'), 'utf8')); } catch {}
  if (built && uiMatches(built)) return true;
  const saved = readJson('admin-ui-approved.json', null);
  return !!saved && signedByAdmin(saved.manifest, saved.approval) && uiMatches(JSON.parse(saved.manifest));
}
async function readRepoBytes(p) {
  if (TARGET_DIR) return fs.readFileSync(path.join(TARGET_DIR, p));
  const r = await net().fetch(`https://raw.githubusercontent.com/${REPO}/main/${p.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw Error('تعذر تنزيل ' + p + ': HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
const EXE_NAME = DEV && process.env.L7A_EXE_NAME ? process.env.L7A_EXE_NAME : SU.EXE;
/** the program's package: from the Releases page (tests: from a folder) */
async function programFetch(url) {
  if (TARGET_DIR) { const f = path.join(TARGET_DIR, 'downloads', decodeURIComponent(url.split('/').pop())); return new Response(fs.existsSync(f) ? fs.readFileSync(f) : 'nf', { status: fs.existsSync(f) ? 200 : 404 }); }
  return net().fetch(url, { cache: 'no-store' });
}
/** Does the unpacked new program start? (its own start check: «--l7-smoke», as the build runs it) */
function newProgramStarts(prog) {
  if (DEV && process.env.L7A_TEST_NO_SMOKE) return Promise.resolve(process.env.L7A_TEST_NO_SMOKE === 'ok');
  return new Promise(resolve => {
    const out = path.join(UPDATES(), 'smoke.json');
    try { fs.rmSync(out, { force: true }); } catch {}
    // (the same read permission the «first run» gives the program's folder: Windows' sandbox must be able to read it)
    try { require('node:child_process').spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe'), [prog, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)', '/T', '/Q'], { windowsHide: true, timeout: 60000 }); } catch {}
    let done = false;
    const end = ok => { if (!done) { done = true; resolve(ok); } };
    let c;
    // (with a data folder of its own for this one start: two programs on the same folder get in each other's way)
    const own = path.join(UPDATES(), 'smoke-data');
    try { fs.rmSync(own, { recursive: true, force: true }); fs.mkdirSync(own, { recursive: true }); } catch {}
    try { c = require('node:child_process').spawn(path.join(prog, EXE_NAME), ['--l7-smoke=' + out], { stdio: 'ignore', windowsHide: true, env: { ...process.env, LOCALAPPDATA: own } }); } catch { return end(false); }
    const t = setTimeout(() => { try { c.kill(); } catch {} end(false); }, 120000);
    c.on('error', () => { clearTimeout(t); end(false); });
    c.on('exit', code => { clearTimeout(t); let j = null; try { j = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {} try { fs.rmSync(own, { recursive: true, force: true }); } catch {} end(code === 0 && !!j?.ok); });
  });
}
const POLICY = L.POLICY_PATH, APPROVALS = L.APPROVALS_DIR, MANIFESTS = L.MANIFESTS_DIR, LATEST = 'level7-cad/releases/latest.json';
const SETUPS = 'level7-cad/releases/setups';
/** the version offered to the computers now ('' = none yet); a read that fails is an error, never «none» */
async function offeredVersion() {
  let t;
  try { t = await readRepo(LATEST); } catch (e) { throw Error('تعذرت قراءة الإصدار المعروض للأجهزة الآن (' + String(e?.message || e) + '). لم يُغيَّر شيء — حاول بعد قليل.'); }
  if (!t) return '';
  try { return String(JSON.parse(t).version || ''); } catch { throw Error('ملف الإصدار المعروض للأجهزة غير مقروء. لم يُغيَّر شيء.'); }
}
// 1.3.0: LEVEL7 MTM and LEVEL7 Nesting — built in their own (private) repositories; a version the admin approves here is
// copied to the public releases repository (a release «<tag><version>» with its installer) and offered with his signature
// in <dir>/latest.json: the programs install only an installer whose fingerprint the admin signed.
const APPS = {
  mtm: { name: 'LEVEL7 MTM', repo: 'alaa-borham/LEVEL7-MTM-2', dir: 'level7-mtm', tag: 'mtm-v' },
  nesting: { name: 'LEVEL7 Nesting', repo: 'alaa-borham/LEVEL7-Nesting-2', dir: 'level7-nesting', tag: 'nesting-v' }
};
// tests: the programs' builds from a folder (<dir>/<app>/<version>/<name>-Setup.exe + notes.txt) instead of GitHub
const PRODUCTS_DIR = DEV ? process.env.L7A_PRODUCTS_DIR || '' : '';

fs.mkdirSync(DATA, { recursive: true });
app.setPath('userData', DATA);
app.setPath('sessionData', path.join(DATA, 'Session'));
app.setName('LEVEL7 CAD MTM Admin');
app.enableSandbox();

const file = n => path.join(DATA, n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
// 1.5.0 (review): a file is written beside its place and then put there in one step (a stop in the middle of a write left
// half a file — for users.json: every user gone). users.json also keeps a copy of what it held before each change.
const writeJson = (n, v) => {
  const f = file(n), t = f + '.tmp';
  fs.writeFileSync(t, JSON.stringify(v, null, 1));
  if (n === 'users.json') { try { const old = JSON.parse(fs.readFileSync(f, 'utf8')); if (old && Array.isArray(old.users)) fs.copyFileSync(f, f + '.bak'); } catch {} }
  fs.renameSync(t, f);
};
let key = null; // { privateKey, publicKey } while the program is open
let win = null;

// ---- the GitHub token (encrypted on this computer)
const tokenFile = file('github-token.bin');
const getToken = () => { try { const b = fs.readFileSync(tokenFile); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString(); } catch { return ''; } };
const setToken = t => fs.writeFileSync(tokenFile, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t));

// ---- the releases repository: read and write files (a folder in tests)
const net = () => session.fromPartition('level7-admin', { cache: false });
const api = p => `${GH_API}/repos/${REPO}/contents/${p}`;
const head = () => ({ Authorization: 'Bearer ' + getToken(), Accept: 'application/vnd.github+json', 'User-Agent': 'LEVEL7-CAD-MTM-Admin', 'Content-Type': 'application/json' });
async function readRepo(p) {
  if (TARGET_DIR) { try { return fs.readFileSync(path.join(TARGET_DIR, p), 'utf8'); } catch { return null; } }
  const r = await net().fetch(api(p) + '?ref=main&t=' + Date.now(), { headers: head() });
  if (r.status === 404) return null;
  if (!r.ok) throw Error('GitHub: HTTP ' + r.status);
  const j = await r.json();
  return Buffer.from(j.content, 'base64').toString('utf8');
}
async function listRepo(p) {
  if (TARGET_DIR) { try { return fs.readdirSync(path.join(TARGET_DIR, p)); } catch { return []; } }
  const r = await net().fetch(api(p) + '?ref=main&t=' + Date.now(), { headers: head() });
  if (r.status === 404) return [];
  if (!r.ok) throw Error('GitHub: HTTP ' + r.status);
  return (await r.json()).map(e => e.name);
}
async function writeRepo(p, text, message) {
  if (TARGET_DIR) { fs.mkdirSync(path.dirname(path.join(TARGET_DIR, p)), { recursive: true }); fs.writeFileSync(path.join(TARGET_DIR, p), text); return; }
  if (!getToken()) throw Error('رمز GitHub غير محفوظ.');
  const g = await net().fetch(api(p) + '?ref=main', { headers: head() });
  const sha = g.ok ? (await g.json()).sha : undefined;
  const r = await net().fetch(api(p), { method: 'PUT', headers: head(), body: JSON.stringify({ message, content: Buffer.from(text).toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }) });
  if (!r.ok) throw Error(r.status === 401 || r.status === 403 ? 'رمز GitHub لا يملك صلاحية الكتابة (أو انتهت مدته).' : 'تعذر النشر على GitHub: HTTP ' + r.status);
}
/** the policy published now (its version), verified with the program's key. 1.5.0 (review): a read that FAILED (GitHub not
 *  reachable for a moment, the token expired) is an error — it was taken as «nothing published yet»: the header said so,
 *  and a publish at that moment could go out with a version LOWER than the one the computers hold (they ignore it). */
async function publishedPolicy() {
  const t = await readRepo(POLICY);
  return t ? L.verifyEnvelope(t, PUBKEY) : null;
}

// 1.4.0: a password's record. New ones («vh», «n»): the published file holds only the SHA-256 of the password's key, so
// nothing in it signs anyone in. A record made before («hash») is kept as it is until the admin changes that password.
const secret = u => (u.vh ? { salt: u.salt, vh: u.vh, n: u.n } : { salt: u.salt, hash: u.hash });
const hasSecret = u => !!(u.salt && (u.vh || u.hash));
// this computer's code (the one the three programs show on their sign-in screen here)
const thisDevice = () => L.deviceCode(DEV && process.env.L7A_MACHINE ? process.env.L7A_MACHINE : L.machineGuid());
/** every user works only on computers approved for him — unless the admin switched it off */
const requireDevice = d => d.requireDevice !== false;
// ---- the users kept on this computer (names here only); the first time: taken from the design program's screen
// 1.5.0 (review): a users.json that could not be READ (cut short by a stop while it was written, held by another program for
// a moment) counted as «no users yet»: the list was replaced at once by an empty one — or by the design program's draft of
// months ago — without a word; the names exist nowhere else. Now: not there = the first time (as before); there but not
// readable = the copy of the last change is put back and the admin is told; no copy either = nothing is touched and the
// program says so.
let usersNote = '';
function users() {
  const f = file('users.json');
  let text = null, bad = null;
  try { text = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') bad = e; }
  if (text !== null) { try { const u = JSON.parse(text); if (u && Array.isArray(u.users)) return u; bad = Error('ليس قائمة مستخدمين'); } catch (e) { bad = e; } }
  if (bad) {
    let kept = null;
    try { const b = JSON.parse(fs.readFileSync(f + '.bak', 'utf8')); if (b && Array.isArray(b.users)) kept = b; } catch {}
    if (kept && text !== null) {
      try { fs.copyFileSync(f, file('users.damaged-' + Date.now() + '.json')); } catch {}
      const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(kept, null, 1)); fs.renameSync(t, f);
      usersNote = `ملف المستخدمين كان تالفاً: استُعيدت النسخة المحفوظة قبل آخر تغيير (${kept.users.length} مستخدم). راجع القائمة قبل النشر.`;
      return kept;
    }
    throw Error(`ملف المستخدمين (users.json) لا يمكن قراءته الآن (${bad.code || bad.message}). لم يُغيَّر شيء. أغلق البرنامج وافتحه من جديد؛ إن تكرر ذلك فلا تنشر، وأرسل مجلد البرنامج للدعم: ${DATA}`);
  }
  const cad = (() => { try { return JSON.parse(fs.readFileSync(CAD_DRAFT, 'utf8')); } catch { return null; } })();
  const list = (cad?.users || []).filter(x => x && x.name).map(x => ({ name: x.name, id: x.id, ...secret(x), expires: x.expires || null, xz: x.xz !== false, admin: !!x.admin, disabled: !!x.disabled, devices: x.devices || [], blocked: x.blocked || [] }));
  const v = { users: list, lastVersion: cad?.lastVersion || 0, imported: !!list.length };
  writeJson('users.json', v);
  return v;
}

/** 1.5.1: what the program's own update came to (said once); what it left behind is removed */
function lastUpdateNote() {
  const up = UPDATES(), pf = path.join(up, 'update-pending.json'), rf = path.join(up, 'update-result.txt');
  let p = null, r = '';
  try { p = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch { return ''; }
  try { r = fs.readFileSync(rf, 'utf8').trim(); } catch {}
  if (!r && Date.now() - Date.parse(p.time || 0) < 5 * 60 * 1000) return '';        // (still being installed)
  for (const n of ['update-pending.json', 'update-result.txt', 'smoke.json']) { try { fs.rmSync(path.join(up, n), { force: true }); } catch {} }
  try { for (const n of fs.readdirSync(up)) if (/^(new-|admin-.*\.zip)/.test(n) || (r === 'ok' && n === 'kept')) SU.fs.rmSync(path.join(up, n), { recursive: true, force: true }); } catch {}
  if (r === 'ok' && !newer(p.to, app.getVersion())) return `تم تحديث برنامج المدير إلى ${app.getVersion()} ✓`;
  if (r === 'ok') return `نُسخت ملفات الإصدار ${p.to} لكن البرنامج المفتوح ما زال ${app.getVersion()} — افتحه من مجلده الأصلي، أو حدّثه يدوياً من صفحة الإصدارات.`;
  return `تعذر تحديث برنامج المدير إلى ${p.to}${r === 'failed' ? ' (أُعيد البرنامج السابق كما كان)' : ''}. حدّثه يدوياً من صفحة الإصدارات: github.com/${REPO}/releases (admin-v${p.to}).`;
}
const clean = e => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function handle(name, fn) {
  ipcMain.handle(name, async (event, arg) => {
    if (!win || event.sender !== win.webContents) throw Error('restricted');
    try { return { ok: true, value: await fn(arg || {}) }; } catch (e) { return { ok: false, error: clean(e) }; }
  });
}
const pick = async (save, title, name, ext) => {
  if (TEST_DIR) return path.join(TEST_DIR, name);
  const r = save ? await dialog.showSaveDialog(win, { title, defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    : await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  return r.canceled ? null : save ? r.filePath : r.filePaths[0];
};

function register() {
  handle('state', async () => {
    const s = readJson('settings.json', {});
    const data = (d => ({ ...d, requireDevice: requireDevice(d) }))(users());
    let note = key ? usersNote : ''; if (key) usersNote = '';      // (said on the main screen, once the key is open)
    if (key && !note) note = lastUpdateNote();
    return { keyPath: s.keyPath || '', keyOpen: !!key, hasToken: !!getToken() || !!TARGET_DIR, note, data, device: thisDevice(), catalogue: JSON.parse(fs.readFileSync(path.join(UI_ROOT, 'catalogue.json'), 'utf8')), version: uiVersion(), core: app.getVersion() };
  });
  handle('pickKey', async () => {
    const f = await pick(false, 'ملف مفتاح الأدمن', 'level7-admin-key.pem', 'pem');
    if (!f) return null;
    const s = readJson('settings.json', {}); s.keyPath = f; writeJson('settings.json', s);
    return f;
  });
  handle('openKey', async ({ passphrase }) => {
    const s = readJson('settings.json', {});
    if (!s.keyPath) throw Error('اختر ملف المفتاح أولاً.');
    let k;
    try { k = L.openAdminKey(fs.readFileSync(s.keyPath, 'utf8'), String(passphrase || '')); }
    catch { throw Error('كلمة سر المفتاح غير صحيحة، أو الملف ليس مفتاح الأدمن.'); }
    if (k.publicKey !== PUBKEY) throw Error('هذا المفتاح ليس مفتاح البرنامج المثبت في الأجهزة.');
    key = k;
    return true;
  });
  handle('setToken', async ({ token }) => {
    const t = String(token || '').trim();
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t)) throw Error('هذا لا يشبه رمز GitHub (يبدأ بـ github_pat_).');
    if (!TARGET_DIR) {
      const r = await net().fetch(`${GH_API}/repos/${REPO}`, { headers: { Authorization: 'Bearer ' + t, Accept: 'application/vnd.github+json', 'User-Agent': 'LEVEL7-CAD-MTM-Admin' } });
      if (!r.ok) throw Error('الرمز غير صالح، أو لا يصل إلى المستودع ' + REPO + '.');
      const j = await r.json();
      if (j.permissions && j.permissions.push === false) throw Error('الرمز يقرأ فقط: أعطه صلاحية Contents: Read and write.');
    }
    setToken(t);
    return true;
  });
  handle('saveUsers', async ({ list }) => {
    const d = users();
    d.users = (Array.isArray(list) ? list : []).map(u => ({ name: String(u.name || '').trim(), id: u.id, ...secret(u), expires: u.expires || null, xz: u.xz !== false, admin: !!u.admin, disabled: !!u.disabled, devices: (u.devices || []).filter(c => /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)), blocked: (u.blocked || []).filter(k => typeof k === 'string') }));
    d.dirty = true;
    writeJson('users.json', d);
    return true;
  });
  handle('setRequireDevice', async ({ on }) => {
    const d = users();
    d.requireDevice = !!on; d.dirty = true;
    writeJson('users.json', d);
    return true;
  });
  handle('hash', async ({ name, password }) => {
    const n = String(name || '').trim();
    if (!n) throw Error('اكتب اسم المستخدم.');
    const out = { id: L.userId(n) };
    if (password !== undefined) {
      if (String(password).length < 6) throw Error('كلمة السر 6 أحرف على الأقل.');
      Object.assign(out, L.hashPassword(String(password)));
    }
    return out;
  });
  handle('published', async () => {
    let p = null;
    try { p = await publishedPolicy(); } catch (e) { return { version: 0, users: 0, issued: '', error: clean(e) }; }
    return { version: p?.version || 0, users: p?.users.length || 0, issued: p?.issued || '' };
  });
  // 1.5.0 (review): does the saved GitHub token still work? (an expired one left the header saying «متصل» and no place to
  // enter a new one)
  handle('tokenState', async () => {
    if (TARGET_DIR) return { ok: true };
    if (!getToken()) return { ok: false, why: 'لا يوجد رمز محفوظ.' };
    try {
      const r = await net().fetch(`${GH_API}/repos/${REPO}`, { headers: head() });
      if (r.status === 401 || r.status === 403) return { ok: false, why: 'رمز GitHub لا يعمل (انتهت مدته أو أُلغي).' };
      return r.ok ? { ok: true } : { ok: false, soft: true, why: 'GitHub: HTTP ' + r.status };
    } catch (e) { return { ok: false, soft: true, why: 'لا اتصال بـ GitHub الآن.' }; }
  });
  handle('publish', async ({ anyway }) => {
    if (!key) throw Error('افتح المفتاح أولاً.');
    const d = users();
    const list = d.users.filter(u => u.name);
    if (!list.length) throw Error('لا يوجد مستخدمون.');
    const no = list.filter(u => !hasSecret(u)).map(u => u.name);
    if (no.length) throw Error('بلا كلمة سر: ' + no.join('، '));
    if (!list.some(u => u.admin && !u.disabled)) throw Error('اجعل مستخدماً واحداً على الأقل «مديراً» يعمل (أنت)، حتى لا يُغلق البرنامج عليك.');
    const ids = new Set();
    for (const u of list) { const id = L.userId(u.name); if (ids.has(id)) throw Error('اسم مكرر: ' + u.name); ids.add(id); u.id = id; }
    // 1.4.0: with «every user on his own computers», a user with no computer approved works on none: the admin is told who
    // before it is published, and says so himself
    const must = requireDevice(d);
    const noDevice = must ? list.filter(u => !u.disabled && !(u.devices || []).length).map(u => u.name) : [];
    if (noDevice.length && !anyway) return { ask: true, noDevice };
    let pub;
    try { pub = await publishedPolicy(); } catch (e) { throw Error('تعذرت قراءة الصلاحيات المنشورة الآن (' + clean(e) + '). لم يُنشر شيء — حاول بعد قليل.'); }
    const before = JSON.stringify([d.users, d.requireDevice]);
    const version = Math.max(pub?.version || 0, d.lastVersion || 0) + 1;
    const env = L.signPolicy({ version, issued: new Date().toISOString(), requireDevice: must, users: list.map(u => ({ id: u.id, ...secret(u), expires: u.expires || null, disabled: !!u.disabled, xz: u.xz !== false, admin: !!u.admin, devices: u.devices || [], blocked: u.blocked || [] })) }, key.privateKey);
    await writeRepo(POLICY, JSON.stringify(env, null, 1), `LEVEL7 policy ${version}`);
    // 1.5.0 (review): what was saved WHILE this was being published (a user added during «ينشر…») was written over by the
    // list of before — the user gone from the file and the screen, no «unpublished changes». The file as it is now counts.
    const now = users();
    const changed = JSON.stringify([now.users, now.requireDevice]) !== before;
    now.lastVersion = Math.max(version, now.lastVersion || 0);
    if (!changed) { now.dirty = false; now.users = list; }
    writeJson('users.json', now);
    return { version, noDevice, changed };
  });
  // ---- the program's own update (its screen): the newest version published in the releases repository
  handle('selfUpdate', async () => {
    const t = await readRepo(`${ADMIN_DIR}/latest.json`).catch(() => null);
    if (!t) return null;
    const m = JSON.parse(t);
    if (m.product !== 'LEVEL7 CAD MTM Admin' || !newer(m.version, uiVersion())) return null;
    const needsFull = newer(m.core, app.getVersion());
    // 1.5.1: a release that needs the whole program — its package as the build wrote it down (when it is ready)
    let full = null;
    if (needsFull && INSTALL_DIR) { try { const i = SU.programInfo(await readRepo(`${ADMIN_DIR}/program/${m.core}.json`), String(m.core), REPO); if (i) full = { version: i.version, size: i.size }; } catch {} }
    return { version: m.version, needsFull, full, notes: m.notes || '' };
  });
  // 1.5.1 (the owner: «أفضل عند تحديث المدير أوتوماتيك مثل الباقية»): the whole program, from inside the program
  handle('fullUpdateInstall', async () => {
    if (!INSTALL_DIR) throw Error('التحديث الكامل يعمل في البرنامج المثبَّت فقط.');
    const m = JSON.parse(await readRepo(`${ADMIN_DIR}/latest.json`));
    const v = String(m.core || '');
    if (m.product !== 'LEVEL7 CAD MTM Admin' || !vOk(v) || !newer(v, app.getVersion())) throw Error('لا يوجد إصدار أحدث من البرنامج.');
    const info = SU.programInfo(await readRepo(`${ADMIN_DIR}/program/${v}.json`), v, REPO);
    if (!info) throw Error('ملف الإصدار الجديد لم يجهز بعد على GitHub. حاول بعد دقائق.');
    const say = (phase, pct) => { try { win?.webContents.send('selfupdate:progress', { phase, pct }); } catch {} };
    // the program's folder must be one this user can write to (it is, wherever the package was unpacked by hand)
    try { const t = path.join(INSTALL_DIR, '.l7a-write-test'); fs.writeFileSync(t, 'x'); fs.rmSync(t); } catch { throw Error('لا يمكن الكتابة في مجلد البرنامج (' + INSTALL_DIR + '). انقل البرنامج إلى مجلد آخر، أو حدّثه يدوياً من صفحة الإصدارات.'); }
    const up = UPDATES();
    for (const n of (() => { try { return fs.readdirSync(up); } catch { return []; } })()) if (/^(new-|kept|admin-.*\.zip)/.test(n)) SU.fs.rmSync(path.join(up, n), { recursive: true, force: true });
    const zip = path.join(up, `admin-${v}.zip`);
    say('download', 0);
    await SU.downloadTo(programFetch, info.url, zip, { size: info.size, sha256: info.sha256, onProgress: f => say('download', Math.round(f * 100)) });
    say('unpack');
    const fresh = path.join(up, 'new-' + v);
    SU.extractZip(zip, fresh);
    const prog = SU.findProgram(fresh, EXE_NAME);
    if (!prog) throw Error('الملف المنزَّل ليس برنامج المدير؛ لم يُثبَّت شيء.');
    SU.fs.rmSync(zip, { force: true });
    // the new program is started once, to see that it works, before anything of this one is replaced
    say('check');
    if (!(await newProgramStarts(prog))) throw Error('الإصدار الجديد لم يبدأ في الفحص؛ البرنامج الحالي لم يتغير. حدّثه يدوياً من صفحة الإصدارات.');
    const result = path.join(up, 'update-result.txt');
    fs.rmSync(result, { force: true });
    fs.writeFileSync(path.join(up, 'update-pending.json'), JSON.stringify({ from: app.getVersion(), to: v, time: new Date().toISOString() }));
    const sc = SU.applyScript(up, { pid: process.pid, from: prog, to: INSTALL_DIR, exe: EXE_NAME, backup: path.join(up, 'kept'), result });
    const child = require('node:child_process').spawn(sc.command, sc.args, { stdio: 'ignore', ...sc.options, env: { ...process.env, ...(DEV && process.env.L7A_NO_START ? { L7A_NO_START: '1' } : {}) } });
    child.on('error', () => {});
    if (!child.pid) { fs.rmSync(path.join(up, 'update-pending.json'), { force: true }); throw Error('تعذر بدء التثبيت؛ البرنامج الحالي لم يتغير.'); }
    child.unref();
    say('install');
    setTimeout(() => app.quit(), 1500);
    return { version: v };
  });
  handle('selfUpdateInstall', async () => {
    if (!key) throw Error('افتح المفتاح أولاً.');
    const text = await readRepo(`${ADMIN_DIR}/latest.json`);
    const m = JSON.parse(text);
    if (m.product !== 'LEVEL7 CAD MTM Admin' || m.kind !== 'admin-ui' || !Array.isArray(m.files) || !/^level7-cad\/admin\/v\/[0-9.]+\/ui$/.test(m.dir || '')) throw Error('ملف التحديث غير صالح.');
    if (newer(m.core, app.getVersion())) throw Error('هذا الإصدار يحتاج تحميل البرنامج كاملاً.');
    // every file downloaded and checked before anything is replaced
    const got = [];
    for (const f of m.files) {
      if (!/^[A-Za-z0-9._-]+$/.test(f.path)) throw Error('ملف التحديث يحتوي مساراً غير مسموح.');
      const b = await readRepoBytes(`${m.dir}/${f.path}`);
      if (b.length !== f.size || sha(b) !== f.sha256) throw Error('فشل التحقق من الملف ' + f.path + '؛ لم يُثبَّت شيء.');
      got.push([f.path, b]);
    }
    // the admin's approval of exactly this list (the program then accepts these files at every start)
    const payload = JSON.stringify({ product: 'LEVEL7 CAD MTM Admin', kind: 'admin-ui', version: m.version, manifestSha256: sha(Buffer.from(text, 'utf8')), approved: new Date().toISOString() });
    const approval = JSON.stringify({ payload, sig: crypto.sign(null, Buffer.from(payload, 'utf8'), key.privateKey).toString('base64') });
    const backup = path.join(DATA, 'ui-backup');
    fs.rmSync(backup, { recursive: true, force: true }); fs.mkdirSync(backup, { recursive: true });
    // 1.5.0 (review): a stop while a screen file was being written left that file half written, said «البرنامج الحالي لم
    // يتغير» — and the program did not start any more. Every new file is written beside its place first; only when all are
    // there are they put in place (one step each); whatever goes wrong, every file goes back, and one that was added goes.
    const done = [], added = [];
    const prevApproved = (() => { try { return fs.readFileSync(file('admin-ui-approved.json'), 'utf8'); } catch { return null; } })();
    try {
      for (const [p] of got) { const t2 = path.join(UI_ROOT, p); if (fs.existsSync(t2)) fs.copyFileSync(t2, path.join(backup, p)); else added.push(p); }
      fs.writeFileSync(path.join(backup, '.files'), JSON.stringify({ files: got.map(g => g[0]), added, approved: prevApproved }));
      for (const [p, b] of got) fs.writeFileSync(path.join(UI_ROOT, p + '.new'), b);
      for (const [p] of got) { done.push(p); fs.renameSync(path.join(UI_ROOT, p + '.new'), path.join(UI_ROOT, p)); }
      writeJson('admin-ui-approved.json', { manifest: text, approval });
      fs.rmSync(path.join(backup, '.files'), { force: true });
    } catch (e) {
      restoreUi(backup);
      throw Error('تعذر كتابة ملفات البرنامج (' + clean(e) + '). البرنامج الحالي لم يتغير.');
    }
    setTimeout(() => win?.reload(), 300);
    return { version: m.version };
  });
  handle('releases', async () => {
    const vs = (await listRepo(MANIFESTS)).filter(n => /^\d+\.\d+\.\d+\.json$/.test(n)).map(n => n.slice(0, -5));
    const ap = new Set((await listRepo(APPROVALS)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)));
    let latest = '';
    try { latest = JSON.parse(await readRepo(LATEST)).version; } catch {}
    const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
    vs.sort(cmp);
    let setups = []; try { setups = await listRepo(SETUPS); } catch {}
    return { latest, versions: vs.map(v => ({ version: v, approved: ap.has(v), canOffer: ap.has(v) && !!latest && cmp(v, latest) > 0, setup: setups.includes(v + '.signed.json') ? 'signed' : setups.includes(v + '.json') ? 'built' : '' })) };
  });
  handle('appReleases', async ({ app: a }) => {
    const x = appOf(a);
    let latest = null;
    try { const t = await readRepo(`${x.dir}/latest.json`); if (t) { const m = JSON.parse(t); latest = { version: m.version, approved: m.approved || '' }; } } catch {}
    const builds = await appBuilds(x, a);
    return { app: a, name: x.name, latest, versions: builds.map(b => ({ version: b.version, notes: b.notes, published: b.published, size: b.setup.size, name: b.setup.name })) };
  });
  handle('appApprove', async ({ app: a, version }) => {
    if (!key) throw Error('افتح المفتاح أولاً.');
    const x = appOf(a), v = String(version || '');
    if (!vOk(v)) throw Error('رقم إصدار غير صالح.');
    const b = (await appBuilds(x, a)).find(q => q.version === v);
    if (!b) throw Error(`الإصدار ${v} غير موجود في ${x.repo}.`);
    // 1.5.0 (review): only the page hid older builds — from a window opened earlier an older build became «the offered one»
    let offered = '';
    try { const t = await readRepo(`${x.dir}/latest.json`); if (t) offered = String(JSON.parse(t).version || ''); } catch (e) { throw Error('تعذرت قراءة الإصدار المعروض للأجهزة الآن (' + clean(e) + '). لم يُنشر شيء — حاول بعد قليل.'); }
    if (offered && newer(offered, v)) throw Error(`المعروض للأجهزة الآن (${offered}) أحدث من ${v}: لم يُنشر شيء.`);
    const bytes = await appSetupBytes(x, b);
    if (bytes.length !== b.setup.size) throw Error('حجم الملف المنزَّل غير مطابق؛ لم يُنشر شيء.');
    const fingerprint = sha(bytes);
    const url = await publishSetup(x, v, b.setup.name, bytes, b.notes);
    const approved = new Date().toISOString();
    const payload = JSON.stringify({ product: L.PRODUCT, kind: 'setup', app: a, version: v, sha256: fingerprint, size: bytes.length, approved });
    const approval = { payload, sig: crypto.sign(null, Buffer.from(payload, 'utf8'), key.privateKey).toString('base64') };
    const m = { product: x.name, app: a, version: v, notes: b.notes, approved, setup: { name: b.setup.name, url, sha256: fingerprint, size: bytes.length }, approval };
    await writeRepo(`${x.dir}/approvals/${v}.json`, JSON.stringify(m, null, 1), `${x.name} ${v} approved`);
    await writeRepo(`${x.dir}/latest.json`, JSON.stringify(m, null, 1), `${x.name} ${v} offered to the computers`);
    return { version: v, url };
  });
  handle('approve', async ({ version }) => {
    if (!key) throw Error('افتح المفتاح أولاً.');
    const v = String(version || '').replace(/[^0-9.]/g, '');
    const text = await readRepo(`${MANIFESTS}/${v}.json`);
    if (!text) throw Error('لا توجد قائمة ملفات للإصدار ' + v + '.');
    // 1.5.0 (review): what is offered to the computers now is read FIRST, and a read that fails stops everything — it was
    // taken as «nothing offered yet», and approving an older waiting release put it back in place of the newer one.
    const cur = await offeredVersion();
    const env = L.signApproval(text, key.privateKey);
    if (!L.approvedManifest(text, JSON.stringify(env), PUBKEY)) throw Error('تعذر التحقق من الاعتماد.');
    await writeRepo(`${APPROVALS}/${v}.json`, JSON.stringify(env, null, 1), `LEVEL7 release ${v} approved`);
    // a prepared release (its files in its own folder): approving it makes it available to the computers
    const m = JSON.parse(text);
    let offered = false;
    if (m.baseUrl && newer(v, cur)) {
      try { await writeRepo(LATEST, text, `LEVEL7 and MTM ${v} offered to the computers`); offered = true; } catch (e) {
        throw Error(`اعتُمد الإصدار ${v} لكن تعذر عرضه للأجهزة (${clean(e)}). اضغط «انشر للأجهزة» بجانبه بعد قليل.`);
      }
    }
    return { version: v, offered };
  });
  // 1.5.0 (review): an approved release that is not offered (the second write failed that day) had no button any more —
  // no computer got it until the next release. «انشر للأجهزة» offers an approved release that is newer than the offered one.
  handle('offer', async ({ version }) => {
    const v = String(version || '').replace(/[^0-9.]/g, '');
    const text = await readRepo(`${MANIFESTS}/${v}.json`);
    const ap = await readRepo(`${APPROVALS}/${v}.json`);
    if (!text || !ap || !L.approvedManifest(text, ap, PUBKEY)) throw Error('الإصدار ' + v + ' غير معتمد.');
    const cur = await offeredVersion();
    if (!newer(v, cur)) throw Error(`المعروض للأجهزة الآن (${cur}) ليس أقدم من ${v}.`);
    if (!JSON.parse(text).baseUrl) throw Error('هذا الإصدار لا يُعرض للأجهزة بهذه الطريقة.');
    await writeRepo(LATEST, text, `LEVEL7 and MTM ${v} offered to the computers`);
    return { version: v };
  });
  // 1.5.0 (security review): the installer of LEVEL7 and MTM is built on GitHub AFTER the release was approved; the
  // computers took its fingerprint from a file nobody signed — whoever could write to the releases repository could give
  // every computer another installer. Its fingerprint is signed here with the admin's key (when this screen is open and the
  // installer is ready); the program installs an installer only with that signature (0.9.313).
  handle('signSetups', async () => {
    if (!key) return { signed: [], waiting: [] };
    const names = await listRepo(SETUPS);
    const ap = new Set((await listRepo(APPROVALS)).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)));
    const signed = [], waiting = [], have = [];
    for (const n of names) {
      const mm = /^(\d+\.\d+\.\d+)\.json$/.exec(n);
      if (!mm || !ap.has(mm[1])) continue;
      const v = mm[1];
      if (names.includes(v + '.signed.json')) { have.push(v); continue; }
      let j = null; try { j = JSON.parse(await readRepo(`${SETUPS}/${n}`)); } catch {}
      if (!j || j.version !== v || !/^[0-9a-f]{64}$/.test(j.sha256 || '') || !Number.isInteger(j.size) || !String(j.url || '').startsWith(`https://github.com/${REPO}/releases/download/`)) { waiting.push(v); continue; }
      const payload = JSON.stringify({ product: L.PRODUCT, kind: 'cad-setup', version: v, url: j.url, sha256: j.sha256, size: j.size, approved: new Date().toISOString() });
      const env = { payload, sig: crypto.sign(null, Buffer.from(payload, 'utf8'), key.privateKey).toString('base64') };
      await writeRepo(`${SETUPS}/${v}.signed.json`, JSON.stringify(env, null, 1), `LEVEL7 and MTM ${v}: installer signed by the admin`);
      signed.push(v);
    }
    return { signed, waiting, have };
  });
}

// ---- 1.3.0: LEVEL7 MTM / LEVEL7 Nesting releases
const appOf = a => { const x = APPS[a]; if (!x) throw Error('برنامج غير معروف.'); return x; };
const vOk = v => /^\d+\.\d+\.\d+$/.test(String(v || ''));
async function gh(url, opts = {}) {
  const r = await net().fetch(url, { ...opts, headers: { ...head(), ...(opts.headers || {}) } });
  return r;
}
/** the builds of a program in its own repository, newest first: [{version, notes, published, setup: {name, size, id}}] */
async function appBuilds(x, a) {
  if (PRODUCTS_DIR) {
    const root = path.join(PRODUCTS_DIR, a);
    let vs = []; try { vs = fs.readdirSync(root).filter(vOk); } catch {}
    return vs.sort((p, q) => (newer(p, q) ? -1 : newer(q, p) ? 1 : 0)).map(v => {
      const f = fs.readdirSync(path.join(root, v)).find(n => n.endsWith('-Setup.exe'));
      let notes = ''; try { notes = fs.readFileSync(path.join(root, v, 'notes.txt'), 'utf8'); } catch {}
      return f ? { version: v, notes, published: '', setup: { name: f, size: fs.statSync(path.join(root, v, f)).size, file: path.join(root, v, f) } } : null;
    }).filter(Boolean);
  }
  if (!getToken()) throw Error('رمز GitHub غير محفوظ.');
  const r = await gh(`${GH_API}/repos/${x.repo}/releases?per_page=8`);
  if (r.status === 404 || r.status === 403 || r.status === 401) throw Error(`رمز GitHub لا يصل إلى المستودع ${x.repo}. أضف هذا المستودع إلى الرمز في GitHub (صلاحية Contents: Read)، ثم احفظ الرمز هنا مرة أخرى.`);
  if (!r.ok) throw Error('GitHub: HTTP ' + r.status);
  return (await r.json()).filter(rel => !rel.draft && !rel.prerelease && vOk(String(rel.tag_name || '').replace(/^v/, ''))).map(rel => {
    const s = (rel.assets || []).find(n => /-Setup\.exe$/.test(n.name));
    return s ? { version: rel.tag_name.replace(/^v/, ''), notes: rel.body || '', published: rel.published_at || '', setup: { name: s.name, size: s.size, id: s.id } } : null;
  }).filter(Boolean);
}
async function appSetupBytes(x, b) {
  if (b.setup.file) return fs.readFileSync(b.setup.file);
  // the asset itself: GitHub answers with a redirect to its storage, which must not get the token (1.3.1: read with
  // net.request — fetch with redirect «manual» only fails with «Redirect was cancelled»)
  const url = `${GH_API}/repos/${x.repo}/releases/assets/${b.setup.id}`;
  const where = await new Promise((resolve, reject) => {
    const rq = electronNet.request({ url, session: net(), redirect: 'manual', useSessionCookies: false });
    const h = { ...head(), Accept: 'application/octet-stream' }; delete h['Content-Type'];
    for (const [k, v] of Object.entries(h)) rq.setHeader(k, v);
    rq.on('redirect', (status, method, location) => { resolve({ location }); try { rq.abort(); } catch {} });
    rq.on('response', res => { const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(parts) })); res.on('error', reject); });
    rq.on('error', reject);
    rq.end();
  });
  if (!where.location) {
    if (where.status !== 200) throw Error('تعذر تنزيل ' + b.setup.name + ': HTTP ' + where.status);
    return where.body;                                       // (served directly)
  }
  const r = await net().fetch(where.location, { headers: { 'User-Agent': 'LEVEL7-CAD-MTM-Admin' } });
  if (!r.ok) throw Error('تعذر تنزيل ' + b.setup.name + ': HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}
/** the installer on the public releases repository's release «<tag><version>»; its download address */
async function publishSetup(x, v, name, bytes, notes) {
  const tag = x.tag + v;
  if (TARGET_DIR) {
    const d = path.join(TARGET_DIR, '_releases', tag); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, name), bytes);
  } else {
    let r = await gh(`${GH_API}/repos/${REPO}/releases/tags/${tag}`);
    let rel = r.ok ? await r.json() : null;
    if (!rel) {
      r = await gh(`${GH_API}/repos/${REPO}/releases`, { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: `${x.name} ${v}`, body: String(notes || '').slice(0, 20000), make_latest: 'false' }) });
      if (!r.ok) throw Error(r.status === 403 ? 'رمز GitHub لا يملك صلاحية إنشاء إصدار في ' + REPO + ' (Contents: Read and write).' : 'تعذر إنشاء الإصدار على GitHub: HTTP ' + r.status);
      rel = await r.json();
    }
    const had = (rel.assets || []).find(a => a.name === name);
    if (had && had.size !== bytes.length) await gh(`${GH_API}/repos/${REPO}/releases/assets/${had.id}`, { method: 'DELETE' });
    if (!had || had.size !== bytes.length) {
      r = await gh(`${GH_UPLOADS}/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
      if (!r.ok) throw Error('تعذر رفع ' + name + ': HTTP ' + r.status);
    }
  }
  return `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

// 1.5.0 (review): the program opened twice worked on the same list — the second window saved its older list over the
// first one's changes, and publishing then removed a user. One copy only: a second start shows the first.
const SMOKE = process.argv.some(a => a.startsWith('--l7-smoke='));
if (!SMOKE && !app.requestSingleInstanceLock()) { app.exit(0); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  // (an update of the screen cut by a stop of the computer: the screen of before is put back)
  if (CHECK_UI && !uiIntact() && restoreUi(path.join(DATA, 'ui-backup')) && uiIntact()) { /* as before the update */ }
  else if (CHECK_UI && !uiIntact()) {
    // (the build check «--l7-smoke» has no one to press OK: it only exits)
    if (!process.argv.some(a => a.startsWith('--l7-smoke='))) dialog.showErrorBox('LEVEL7 CAD MTM Admin', 'ملفات البرنامج ليست كما اعتمدها المدير. أعد تحميل البرنامج كاملاً.');
    return app.exit(4);
  }
  register();
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 600, title: 'LEVEL7 CAD MTM Admin', backgroundColor: '#0f1318',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  await win.loadFile(path.join(UI_ROOT, 'index.html'));
  const smoke = process.argv.find(a => a.startsWith('--l7-smoke='));
  if (smoke) {
    const ok = await win.webContents.executeJavaScript('!!document.querySelector("#app")').catch(() => false);
    try { fs.writeFileSync(smoke.slice('--l7-smoke='.length), JSON.stringify({ ok, admin: true, sealed: /[\\/]app\.asar([\\/]|$)/.test(__dirname) })); } catch {}
    app.exit(ok ? 0 : 3);
  }
}).catch(e => { dialog.showErrorBox('LEVEL7 CAD MTM Admin', e.message); app.quit(); });
app.on('window-all-closed', () => app.quit());
