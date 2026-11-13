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
const POLICY = L.POLICY_PATH, APPROVALS = L.APPROVALS_DIR, MANIFESTS = L.MANIFESTS_DIR, LATEST = 'level7-cad/releases/latest.json';
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
const writeJson = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 1));
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
/** the policy published now (its version), verified with the program's key */
async function publishedPolicy() {
  const t = await readRepo(POLICY).catch(() => null);
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
function users() {
  const u = readJson('users.json', null);
  if (u) return u;
  const cad = (() => { try { return JSON.parse(fs.readFileSync(CAD_DRAFT, 'utf8')); } catch { return null; } })();
  const list = (cad?.users || []).filter(x => x && x.name).map(x => ({ name: x.name, id: x.id, ...secret(x), expires: x.expires || null, xz: x.xz !== false, admin: !!x.admin, disabled: !!x.disabled, devices: x.devices || [], blocked: x.blocked || [] }));
  const v = { users: list, lastVersion: cad?.lastVersion || 0, imported: !!list.length };
  writeJson('users.json', v);
  return v;
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
    return { keyPath: s.keyPath || '', keyOpen: !!key, hasToken: !!getToken() || !!TARGET_DIR, data: (d => ({ ...d, requireDevice: requireDevice(d) }))(users()), device: thisDevice(), catalogue: JSON.parse(fs.readFileSync(path.join(UI_ROOT, 'catalogue.json'), 'utf8')), version: uiVersion(), core: app.getVersion() };
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
    const p = await publishedPolicy();
    return { version: p?.version || 0, users: p?.users.length || 0, issued: p?.issued || '' };
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
    const pub = await publishedPolicy();
    const version = Math.max(pub?.version || 0, d.lastVersion || 0) + 1;
    const env = L.signPolicy({ version, issued: new Date().toISOString(), requireDevice: must, users: list.map(u => ({ id: u.id, ...secret(u), expires: u.expires || null, disabled: !!u.disabled, xz: u.xz !== false, admin: !!u.admin, devices: u.devices || [], blocked: u.blocked || [] })) }, key.privateKey);
    await writeRepo(POLICY, JSON.stringify(env, null, 1), `LEVEL7 policy ${version}`);
    d.lastVersion = version; d.dirty = false; d.users = list;
    writeJson('users.json', d);
    return { version, noDevice };
  });
  // ---- the program's own update (its screen): the newest version published in the releases repository
  handle('selfUpdate', async () => {
    const t = await readRepo(`${ADMIN_DIR}/latest.json`).catch(() => null);
    if (!t) return null;
    const m = JSON.parse(t);
    if (m.product !== 'LEVEL7 CAD MTM Admin' || !newer(m.version, uiVersion())) return null;
    return { version: m.version, needsFull: newer(m.core, app.getVersion()), notes: m.notes || '' };
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
    const done = [];
    try {
      for (const [p] of got) { const t2 = path.join(UI_ROOT, p); if (fs.existsSync(t2)) fs.copyFileSync(t2, path.join(backup, p)); }
      for (const [p, b] of got) { fs.writeFileSync(path.join(UI_ROOT, p), b); done.push(p); }
      writeJson('admin-ui-approved.json', { manifest: text, approval });
    } catch (e) {
      for (const p of done) { try { fs.copyFileSync(path.join(backup, p), path.join(UI_ROOT, p)); } catch {} }
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
    return { latest, versions: vs.map(v => ({ version: v, approved: ap.has(v) })) };
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
    const env = L.signApproval(text, key.privateKey);
    if (!L.approvedManifest(text, JSON.stringify(env), PUBKEY)) throw Error('تعذر التحقق من الاعتماد.');
    await writeRepo(`${APPROVALS}/${v}.json`, JSON.stringify(env, null, 1), `LEVEL7 release ${v} approved`);
    // a prepared release (its files in its own folder): approving it makes it available to the computers
    const m = JSON.parse(text);
    let offered = false;
    if (m.baseUrl) {
      let cur = '';
      try { cur = JSON.parse(await readRepo(LATEST)).version; } catch {}
      const newer = (a, b) => { const x = a.split('.').map(Number), y = (b || '0.0.0').split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
      if (newer(v, cur)) { await writeRepo(LATEST, text, `LEVEL7 and MTM ${v} offered to the computers`); offered = true; }
    }
    return { version: v, offered };
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (CHECK_UI && !uiIntact()) {
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
