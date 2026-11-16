// LEVEL7 CAD MTM Admin — the page: setup (key + GitHub, once), the users as cards with a simple editor, one button to
// publish, and the releases waiting for approval.
'use strict';
(() => {
  const A = window.admin;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let st = null, pub = { version: 0 }, tab = 'users', editing = null, filter = '', releases = null, upd = null;
  let prod = null;                               // 1.6.0: the daily limit page as it is being typed (not saved yet)
  let updating = '';                             // 1.7.2 (review): the full update running — its last word, kept
  //                                                across the pages (each one drew a fresh, live «تحديث الآن»)
  let tok = { ok: true }, retoken = false;      // 1.5.0: does the saved GitHub token work; its field shown again
  const app = $('#app');

  function toast(m, bad = false) {
    const t = $('#toast');
    t.textContent = m; t.className = bad ? 'bad' : ''; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), bad ? 6000 : 3500);
  }
  const daysLeft = d => { if (!d) return null; const end = new Date(d + 'T23:59:59'); return Math.ceil((end - Date.now()) / 864e5); };
  // 1.4.0: a password's record is «vh» (new: nothing in the published file signs anyone in) or «hash» (made before)
  const hasPw = u => !!(u.vh || u.hash), oldPw = u => !u.vh && !!u.hash;
  const mustDevice = () => st.data.requireDevice !== false;
  const noDevice = u => mustDevice() && !(u.devices || []).length;
  const statusOf = u => {
    if (u.disabled) return ['bad', 'موقوف'];
    if (!hasPw(u)) return ['warn', 'بلا كلمة سر'];
    if (noDevice(u)) return ['warn', 'بلا جهاز مسجل — لا يعمل على أي جهاز'];
    const n = daysLeft(u.expires);
    if (n === null) return ['ok', 'يعمل — بلا نهاية'];
    if (n < 0) return ['bad', `انتهت مدته (${u.expires})`];
    return [n <= 7 ? 'warn' : 'ok', `يعمل حتى ${u.expires} · باقي ${n} يوماً`];
  };
  const toolName = k => { for (const g of st.catalogue.groups) for (const [kk, n] of g.items) if (kk === k) return n; return k; };

  async function load() {
    // 1.5.0: the users' file could not be read — said on the screen, nothing is changed (it was replaced by an empty list)
    try { st = await A.state(); } catch (e) {
      app.innerHTML = `<div class="app"><header><div class="logo">LEVEL7 CAD MTM Admin</div></header><main><div class="setup"><div class="card"><h2>تعذر فتح قائمة المستخدمين</h2><p class="msg bad" id="fatal">${esc(e.message || e)}</p></div></div></main></div>`;
      return;
    }
    if (st.keyOpen && st.hasToken) {
      try { pub = await A.published(); } catch (e) { pub = { version: 0, error: e.message || String(e) }; }
      try { upd = await A.selfUpdate(); } catch { upd = null; }
      try { tok = await A.tokenState(); } catch { tok = { ok: true }; }
    }
    render();
    if (st.note) alert(st.note);
  }

  // ---- first: the key (each time) and the GitHub token (once)
  function renderSetup() {
    app.innerHTML = `<div class="app"><header><div class="logo">LEVEL7 CAD MTM Admin<small>${esc(st.version)}</small></div></header><main><div class="setup"><div class="card">
      <h2>${st.keyPath ? 'افتح المفتاح' : 'البداية'}</h2>
      <p>${st.keyPath ? 'اكتب كلمة سر مفتاح الأدمن للمتابعة.' : 'مرة واحدة: اختر ملف مفتاح الأدمن، ثم ألصق رمز GitHub.'}</p>
      <div class="step"><div class="n ${st.keyPath ? 'done' : ''}">1</div><div><b>ملف المفتاح</b><div class="path">${esc(st.keyPath || 'لم يُختر بعد')}</div></div><button data-a="pick">${st.keyPath ? 'تغيير' : 'اختيار الملف…'}</button></div>
      ${st.keyOpen ? '<p class="msg ok">✓ المفتاح مفتوح — بقي رمز GitHub بالأسفل.</p>' : `<div class="field"><label>كلمة سر المفتاح</label><input type="password" id="pass" ${st.keyPath ? 'autofocus' : 'disabled'}></div>
      <div class="row"><button class="primary big" data-a="open" ${st.keyPath ? '' : 'disabled'}>فتح</button></div>`}
      <div class="msg" id="smsg"></div></div>
      ${!st.hasToken ? `<div class="card"><div class="step"><div class="n">2</div><b>رمز GitHub (مرة واحدة)</b></div>
        <p>الرمز الذي أنشأته (يبدأ بـ github_pat_). يُحفظ مشفراً على هذا الجهاز ولا يظهر مرة أخرى.</p>
        <div class="field"><input type="password" id="tok" placeholder="github_pat_…"></div>
        <button class="primary" data-a="token">حفظ الرمز</button><div class="msg" id="tmsg"></div></div>` : ''}
      </div></main></div>`;
    (st.keyOpen ? $('#tok') : $('#pass'))?.focus();
  }

  // ---- the main screen
  function render() {
    if (!st.keyOpen || !st.hasToken) return renderSetup();
    const d = st.data;
    app.innerHTML = `<div class="app">
      <header><div class="logo">LEVEL7 CAD MTM Admin<small>برنامج المدير</small></div>
        <div class="stats">
          <div class="stat ok"><small>المفتاح</small><b>🔑 مفتوح</b></div>
          <div class="stat ${tok.ok ? 'ok' : tok.soft ? 'warn' : 'bad'}" id="ghstat"><small>GitHub</small><b>${tok.ok ? '✓ متصل' : '⚠ ' + esc(tok.why || 'لا يعمل')}</b> <button class="mini" data-a="retoken" title="إدخال رمز GitHub جديد (عند انتهاء مدة الرمز)">تغيير الرمز</button></div>
          <div class="stat ${pub.version ? 'ok' : 'warn'}"><small>الصلاحيات المنشورة: </small><b>${pub.version ? `الإصدار ${pub.version} · ${pub.users} مستخدم` : pub.error ? 'تعذرت قراءتها الآن' : 'لا شيء بعد'}</b></div>
          <div class="stat" title="إصدار الشاشة · إصدار الجزء المختوم"><small>برنامج المدير </small><b>الإصدار ${esc(st.version)} · ${esc(st.core)}</b></div>
        </div></header>
      ${upd ? `<div class="updbar">${upd.needsFull ? `${upd.full ? `يوجد إصدار جديد لبرنامج المدير <b dir="ltr">${esc(upd.full.version)}</b> (البرنامج كاملاً، ${(upd.full.size / 1048576).toFixed(0)} ميغابايت). ${updating ? '<button class="primary" disabled>يحدّث…</button>' : '<button class="primary" data-a="fullupdate">تحديث الآن</button>'} <span id="fullmsg">${esc(updating)}</span>` : `يوجد إصدار جديد لبرنامج المدير ${esc(upd.version)} — يحتاج تحميل البرنامج كاملاً من صفحة الإصدارات: <b dir="ltr">github.com/alaa-borham/LEVEL7andMTM-releases/releases</b> (admin-v${esc(upd.version)}).`}` : `يوجد إصدار جديد لبرنامج المدير <b dir="ltr">${esc(upd.version)}</b>.`}${upd.needsFull ? '' : '<button class="primary" data-a="selfupdate">تحديث الآن</button>'}</div>` : ''}
      ${retoken ? `<div class="card" id="retok"><b>رمز GitHub جديد</b><p>ألصق الرمز الجديد (يبدأ بـ github_pat_). يُحفظ مشفراً على هذا الجهاز مكان القديم.</p>
        <div class="field"><input type="password" id="tok" placeholder="github_pat_…"></div>
        <button class="primary" data-a="token">حفظ الرمز</button> <button data-a="retoken-close">إلغاء</button><div class="msg" id="tmsg"></div></div>` : ''}
      <nav class="tabs"><button data-tab="users" class="${tab === 'users' ? 'on' : ''}">المستخدمون (${d.users.length})</button><button data-tab="rel" class="${tab === 'rel' ? 'on' : ''}">التحديثات</button><button data-tab="prod" class="${tab === 'prod' ? 'on' : ''}">حد الإنتاج اليومي${prodCount() ? ` (${prodCount()})` : ''}</button></nav>
      <main id="main"></main>
      <div class="pubbar" ${d.dirty ? '' : 'hidden'}><span>لديك تغييرات لم تُنشر بعد — لا تصل للأجهزة حتى تنشرها.</span><button class="primary big" data-a="publish">نشر الآن</button></div>
    </div>`;
    if (tab === 'users') renderUsers(); else if (tab === 'prod') renderProduction(); else renderReleases();
  }

  // ---- 1.6.0: LEVEL7 MTM's daily production limit and work day (the owner: «حد انتاج يومي … لكل عميل … وموعد بدايه
  // ونهايه يوم العمل»). Typed here, saved with «حفظ», sent to the computers with «نشر الآن» like the users.
  const savedProd = () => { const p = st.data.production || {}; return { day: p.day ? { start: p.day.start, end: p.day.end } : null, default: p.default ?? null, customers: (p.customers || []).map(c => ({ name: c.name, limit: c.limit })) }; };
  const prodCount = () => (st.data.production?.customers || []).length;
  const sameProd = () => JSON.stringify(readProd()) === JSON.stringify(savedProd());
  /** the page's fields as they are now: names trimmed, numbers made, rows left empty dropped */
  function readProd() {
    if (!$('#p-rows')) return prod || savedProd();
    const num = v => (String(v ?? '').trim() === '' ? null : Number(v));
    // (only trimmed: the spaces inside are the fingerprint's business — plainName, as LEVEL7 MTM's plain_name)
    const customers = readProdRows().map(r => ({ name: r.name.trim(), limit: num(r.limit) })).filter(r => r.name || r.limit !== null);
    return { day: $('#p-dayon').checked ? { start: $('#p-start').value, end: $('#p-end').value } : null, default: num($('#p-default').value), customers };
  }
  const readProdRows = () => [...document.querySelectorAll('#p-rows .pline')].map(r => ({ name: r.querySelector('.p-name').value, limit: r.querySelector('.p-limit').value }));
  function renderProduction() {
    const p = prod || savedProd();
    const rows = p.customers.length ? p.customers : [{ name: '', limit: '' }];
    const row = r => `<div class="pline"><input type="text" class="p-name" placeholder="اسم العميل كما هو في LEVEL7 MTM" value="${esc(r.name)}"><input type="number" class="p-limit" min="0" step="1" dir="ltr" placeholder="العدد" value="${esc(r.limit ?? '')}"><span class="unit">ملف XML في اليوم</span><button data-a="p-del" title="حذف هذا العميل من القائمة">✕</button></div>`;
    $('#main').innerHTML = `<p class="relnote">يعمل في LEVEL7 MTM: عدد ملفات XML التي تُسحب لكل عميل في يوم العمل. ما زاد عن الحد ينتظر في مجلد process ويُسحب في اليوم التالي، الأقدم أولاً. يحتاج LEVEL7 MTM 2.0.45 أو أحدث. حد كل مستخدم (عميلك على جهازه) يُكتب في صفحة المستخدم ← LEVEL7 MTM.</p>
      <section class="relbox prodbox"><h3>يوم العمل <small>واحد لكل العملاء</small></h3>
        <label class="switch"><input type="checkbox" id="p-dayon" ${p.day ? 'checked' : ''}> سحب ملفات XML في موعد يوم العمل فقط</label>
        <div class="row hours" ${p.day ? '' : 'hidden'}><label>البداية <input type="time" id="p-start" dir="ltr" value="${esc(p.day?.start || '08:00')}"></label><label>النهاية <input type="time" id="p-end" dir="ltr" value="${esc(p.day?.end || '17:00')}"></label></div>
        <p class="hint">${p.day ? 'خارج هذا الموعد لا يُسحب ملف XML جديد. ما سُحب قبل النهاية يكمل الرسم والتعشيق والقص حتى ينتهي. والعدّ يبدأ من صفر عند بداية كل يوم.' : 'بلا موعد: السحب يعمل في أي ساعة، والعدّ يبدأ من صفر عند منتصف الليل.'}</p></section>
      <section class="relbox prodbox"><h3>الحد اليومي لكل عميل</h3>
        <div id="p-rows">${rows.map(row).join('')}</div>
        <div class="row"><button data-a="p-add">+ عميل</button></div>
        <div class="row rest"><label for="p-default">باقي العملاء (غير المكتوبين هنا)</label><input type="number" id="p-default" min="0" step="1" dir="ltr" placeholder="بلا حد" value="${esc(p.default ?? '')}"><span class="unit">ملف XML في اليوم لكل عميل</span></div>
        <p class="hint">اكتب اسم العميل كما يظهر في صفحة «العملاء» في LEVEL7 MTM (مثل: الفاخره). منتجات العميل تُحسب معه. لمنتج واحد وحده اكتب «العميل / المنتج». الرقم 0 يوقف السحب لهذا العميل. الأسماء تبقى على هذا الجهاز: المنشور رمز لا يُقرأ منه الاسم.</p></section>
      <div class="bar"><button class="primary big" data-a="p-save">حفظ</button><span class="msg" id="p-msg"></span></div>`;
    // 1.7.2 (review): compared once the page is in place — from the page before, a row just deleted was still there
    // (no «not saved» after ✕), and from another tab the typed numbers were text against the saved numbers
    $('#p-msg').textContent = sameProd() ? '' : 'تغييرات لم تُحفظ بعد.';
  }
  // 1.2.6: a clearer card — the name, his state, then one row per program (works / closed, and how much of it is closed)
  function card(u, i) {
    const [c, t] = statusOf(u);
    const progs = PROGRAMS.map(([k, name], n) => {
      const off = (u.blocked || []).includes(k), cnt = closedOf(u, ['cad', 'nesting', 'mtm'][n]).length;
      return `<div class="prow ${off ? 'off' : ''}"><span class="pn">${name}</span><span class="ps">${off ? '✕ مغلق' : '✓ يعمل'}</span><span class="pc">${!off && cnt ? `${cnt} مغلق منه` : ''}</span></div>`;
    }).join('');
    return `<div class="card" data-edit="${i}"><div class="top"><span class="av">${esc((u.name || '?').trim().charAt(0).toUpperCase())}</span><div class="who"><div class="name">${esc(u.name)}</div><div class="state ${c}">● ${esc(t)}</div></div>${u.admin ? '<span class="chip ok">مدير</span>' : ''}</div>
      <div class="progrows">${progs}</div>
      <div class="tags"><span class="chip ${noDevice(u) ? 'warn' : ''}">💻 ${u.devices?.length ? `${u.devices.length} جهاز` : mustDevice() ? 'بلا جهاز' : 'أي جهاز'}</span>${oldPw(u) ? '<span class="chip warn" title="صيغة قديمة أضعف: افتح المستخدم واكتب له كلمة سر جديدة">كلمة سر قديمة — غيّرها</span>' : ''}${u.xz === false ? '<span class="chip warn">القياسات للعرض فقط</span>' : ''}${Number.isInteger(u.daily) ? `<span class="chip">📥 ${u.daily} XML في اليوم</span>` : ''}${toolsOf(u).length ? `<span class="chip warn">${toolsOf(u).length} أداة مغلقة</span>` : ''}</div></div>`;
  }
  function summary() {
    const n = { ok: 0, warn: 0, bad: 0 };
    st.data.users.forEach(u => { n[statusOf(u)[0]] = (n[statusOf(u)[0]] || 0) + 1; });
    return `<div class="summary"><span class="ok">● ${n.ok} يعمل</span>${n.warn ? `<span class="warn">● ${n.warn} يحتاج انتباه</span>` : ''}${n.bad ? `<span class="bad">● ${n.bad} موقوف أو انتهت مدته</span>` : ''}<span class="muted">اضغط على أي مستخدم لتعديله</span></div>`;
  }
  function renderUsers() {
    const list = st.data.users.map((u, i) => [u, i]).filter(([u]) => !filter || u.name.toLowerCase().includes(filter.toLowerCase()));
    $('#main').innerHTML = `<div class="bar"><button class="primary big" data-a="add">+ مستخدم جديد</button><input id="find" placeholder="بحث بالاسم…" value="${esc(filter)}"><label class="switch reqdev" title="كل مستخدم يعمل فقط على الأجهزة التي تضيف رموزها له. الرمز يظهر في شاشة الدخول عنده."><input type="checkbox" id="reqdev" ${mustDevice() ? 'checked' : ''}> كل مستخدم على أجهزته المسجلة فقط</label></div>
      ${list.length ? summary() : ''}
      ${list.length ? `<div class="grid">${list.map(([u, i]) => card(u, i)).join('')}</div>`
      : '<div class="empty">لا يوجد مستخدمون. اضغط «+ مستخدم جديد».</div>'}`;
    const f = $('#find');
    $('#reqdev').addEventListener('change', async e => {
      if (!e.target.checked && !confirm('إيقاف إلزام الأجهزة؟ كل مستخدم بلا أجهزة مسجلة سيعمل على أي جهاز.')) { e.target.checked = true; return; }
      await A.setRequireDevice(e.target.checked); st = await A.state(); render();
    });
    f.addEventListener('input', () => { filter = f.value; renderUsers(); const g = $('#find'); g.focus(); g.setSelectionRange(g.value.length, g.value.length); });
  }

  // 1.2.3: the programs a user may use — kept as «app:<program>» in his closed list (every program reads it)
  const PROGRAMS = [['app:cad', 'LEVEL7 and MTM', 'الرسم'], ['app:nesting', 'LEVEL7 Nesting', 'النستنج'], ['app:mtm', 'LEVEL7 MTM', 'MTM']];
  const toolsOf = u => (u.blocked || []).filter(k => !k.startsWith('app:'));
  // 1.2.4: each program's permissions in a tab of its own
  const ETABS = [['general', 'عام'], ['cad', 'LEVEL7 and MTM'], ['nesting', 'LEVEL7 Nesting'], ['mtm', 'LEVEL7 MTM']];
  const groupsOf = p => (p === 'cad' ? st.catalogue.groups : st.catalogue[p]) || [];
  const closedOf = (u, p) => (u.blocked || []).filter(k => p === 'cad' ? !k.includes(':') : k.startsWith(p + ':'));
  // ---- the editor of one user
  function openEditor(i) {
    const u = i === -1 ? { name: '', expires: null, xz: true, admin: false, disabled: false, devices: [], blocked: [] } : JSON.parse(JSON.stringify(st.data.users[i]));
    editing = { i, u, pw: '', toolFilter: '', tab: 'general' };
    drawEditor();
  }
  function drawEditor() {
    const { u, i } = editing;
    let d = document.querySelector('.drawer');
    if (!d) { d = document.createElement('div'); d.className = 'drawer'; document.body.append(d); }
    const n = daysLeft(u.expires);
    const tf = editing.toolFilter.toLowerCase();
    const tab = editing.tab;
    const toolList = p => `<input type="text" class="e-tf" id="e-tf-${p}" placeholder="بحث عن أداة…" value="${esc(editing.toolFilter)}">
        <div class="tools">${groupsOf(p).map((g, gi) => { const items = g.items.filter(([k, nm]) => !tf || nm.toLowerCase().includes(tf)); return items.length ? `<h4>${esc(g.name)} <button data-grp="${p}:${gi}">${g.items.every(([k]) => u.blocked.includes(k)) ? 'فتح الكل' : 'إغلاق الكل'}</button></h4>${items.map(([k, nm]) => `<label><input type="checkbox" data-tool="${esc(k)}" ${u.blocked.includes(k) ? 'checked' : ''}> ${esc(nm)}</label>`).join('')}` : ''; }).join('')}</div>`;
    const allowed = p => { const k = 'app:' + p, on = !u.blocked.includes(k); return `<label class="switch prog-on ${on ? '' : 'off'}"><input type="checkbox" data-app="${k}" ${on ? 'checked' : ''}> ${on ? 'يعمل في هذا البرنامج' : 'مغلق عليه — لا يعمل في هذا البرنامج'}</label>`; };
    const keep = d.querySelector('.body')?.scrollTop || 0;   // 1.2.6: a tick re-draws — stay where the admin was
    d.innerHTML = `<header><b>${i === -1 ? 'مستخدم جديد' : esc(u.name)}</b><button data-e="close">✕</button></header>
      <nav class="etabs">${ETABS.map(([k, t]) => `<button data-etab="${k}" class="${tab === k ? 'on' : ''}">${t}${k !== 'general' && u.blocked.includes('app:' + k) ? ' ✕' : k !== 'general' && closedOf(u, k).length ? ` (${closedOf(u, k).length})` : ''}</button>`).join('')}</nav><div class="body">
      <section class="etab" data-sec="general" ${tab === 'general' ? '' : 'hidden'}>
      <div class="field"><label>الاسم (يكتبه عند الدخول)</label><input type="text" id="e-name" value="${esc(u.name)}" dir="auto"></div>
      <div class="field"><label>كلمة السر ${hasPw(u) ? '(موجودة — اكتب جديدة لتغييرها)' : ''}</label><div class="row"><input type="text" id="e-pw" value="${esc(editing.pw)}" dir="ltr" placeholder="${hasPw(u) ? '••••••' : '6 أحرف أو أكثر'}"><button data-e="gen">توليد كلمة سر</button></div>
        ${editing.pw ? `<p>أعطها للمستخدم: <span class="pw">${esc(editing.pw)}</span></p>` : oldPw(u) ? '<p class="state warn" id="e-oldpw">كلمة السر محفوظة بالصيغة القديمة (أضعف). اكتب كلمة سر جديدة أو اضغط «توليد كلمة سر» لتصير بالصيغة الآمنة.<br>قبل تغييرها: تأكد أن برامج هذا المستخدم محدَّثة (LEVEL7 and MTM 0.9.310، و LEVEL7 MTM و LEVEL7 Nesting 2.0.19 أو أحدث) — الإصدارات الأقدم لا تقبل كلمة السر الجديدة.</p>' : ''}</div>
      <div class="field"><label>البرامج المسموحة له</label><div class="row progs">${PROGRAMS.map(([k, nm]) => `<label class="prog ${u.blocked.includes(k) ? 'off' : ''}"><input type="checkbox" data-app="${k}" ${u.blocked.includes(k) ? '' : 'checked'}> ${nm}</label>`).join('')}</div>
        ${PROGRAMS.every(([k]) => u.blocked.includes(k)) ? '<p class="state bad">لا يعمل في أي برنامج.</p>' : ''}</div>
      <div class="field"><label>مدة التشغيل</label><div class="row seg">
        ${[['none', 'بلا نهاية'], [30, 'شهر'], [90, '3 أشهر'], [365, 'سنة']].map(([k, t]) => `<button data-dur="${k}">${t}</button>`).join('')}
        <input type="date" id="e-date" value="${esc(u.expires || '')}"></div>
        <p class="state ${n === null ? 'ok' : n < 0 ? 'bad' : n <= 7 ? 'warn' : 'ok'}">${n === null ? 'يعمل بلا نهاية' : n < 0 ? 'انتهت مدته' : `يعمل حتى ${u.expires} (باقي ${n} يوماً)`}</p></div>
      <label class="switch"><input type="checkbox" id="e-admin" ${u.admin ? 'checked' : ''}> مدير</label>
      <label class="switch"><input type="checkbox" id="e-dis" ${u.disabled ? 'checked' : ''}> موقوف (لا يعمل في أي برنامج)</label>
      <div class="field"><label>الأجهزة المسموحة ${mustDevice() ? '(بلا جهاز = لا يعمل)' : '(فارغ = أي جهاز)'} — الرمز يظهر في شاشة الدخول عند المستخدم، وهو نفسه في البرامج الثلاثة</label>
        <div class="row devs">${(u.devices || []).map((c, k) => `<span class="chip">${esc(c)}<button data-dev="${k}">✕</button></span>`).join('') || (mustDevice() ? '<span class="chip warn">بلا جهاز — لا يعمل على أي جهاز</span>' : '<span class="chip">أي جهاز</span>')}</div>
        <div class="row" ><input type="text" id="e-dev" dir="ltr" placeholder="ABCDE-FGHJK"><button data-e="adddev">إضافة جهاز</button>${st.device && !(u.devices || []).includes(st.device) ? `<button data-e="thisdev" title="رمز هذا الكمبيوتر: ${esc(st.device)}">+ هذا الجهاز (<span dir="ltr">${esc(st.device)}</span>)</button>` : ''}</div></div>
      </section>
      <section class="etab" data-sec="cad" ${tab === 'cad' ? '' : 'hidden'}>
      ${allowed('cad')}
      <label class="switch"><input type="checkbox" id="e-xz" ${u.xz !== false ? 'checked' : ''}> يعدّل القياسات X / Z</label>
      <div class="field"><label>أدوات LEVEL7 and MTM المغلقة عليه (${closedOf(u, 'cad').length}) — لا تظهر له ولا تعمل</label>${toolList('cad')}</div>
      </section>
      <section class="etab" data-sec="nesting" ${tab === 'nesting' ? '' : 'hidden'}>
      ${allowed('nesting')}
      <div class="field"><label>أوامر LEVEL7 Nesting المغلقة عليه (${closedOf(u, 'nesting').length}) — تختفي من القوائم والشريط ولا تعمل</label>${toolList('nesting')}</div>
      </section>
      <section class="etab" data-sec="mtm" ${tab === 'mtm' ? '' : 'hidden'}>
      ${allowed('mtm')}
      <div class="field"><label for="e-daily">الحد اليومي لسحب ملفات XML على أجهزته (فارغ = بلا حد)</label>
        <div class="row"><input type="number" id="e-daily" min="0" step="1" dir="ltr" placeholder="بلا حد" value="${esc(u.daily ?? '')}"><span class="muted">ملف XML في يوم العمل، لكل جهاز من أجهزته · 0 = لا يُسحب شيء · يوم العمل من صفحة «حد الإنتاج اليومي»</span></div></div>
      <div class="field"><label>أوامر وصفحات LEVEL7 MTM المغلقة عليه (${closedOf(u, 'mtm').length}) — تختفي ولا تفتح</label>${toolList('mtm')}</div>
      </section>
      <div class="msg" id="emsg"></div></div>
      <div class="foot"><button class="primary big" data-e="save">حفظ</button><button data-e="close">إلغاء</button>${i === -1 ? '' : '<button class="danger" data-e="del">حذف المستخدم</button>'}</div>`;
    const nb = d.querySelector('.body'); if (nb) nb.scrollTop = keep;
  }
  const d0Scroll = () => { const b = document.querySelector('.drawer .body'); if (b) b.scrollTop = 0; };
  const emsg = (m, bad = true) => { const e = $('#emsg'); if (e) { e.textContent = m; e.className = 'msg ' + (bad ? 'bad' : 'ok'); } };
  function readEditor() {
    const u = editing.u;
    u.name = $('#e-name').value.trim();
    u.expires = $('#e-date').value || null;
    u.xz = $('#e-xz').checked; u.admin = $('#e-admin').checked; u.disabled = $('#e-dis').checked;
    const dl = String($('#e-daily')?.value ?? '').trim();
    u.daily = dl === '' ? null : Number(dl);      // 1.7.0: his daily limit of XML files pulled in LEVEL7 MTM
    editing.pw = $('#e-pw').value;
  }
  async function saveEditor() {
    readEditor();
    const { u, i } = editing;
    if (!u.name) return emsg('اكتب الاسم.');
    if (u.daily !== null && u.daily !== undefined && !(Number.isInteger(u.daily) && u.daily >= 0 && u.daily <= 100000)) { editing.tab = 'mtm'; drawEditor(); return emsg('الحد اليومي: اكتب عدداً صحيحاً (أو اتركه فارغاً: بلا حد).'); }
    if (st.data.users.some((x, k) => k !== i && x.name.trim().toLowerCase() === u.name.toLowerCase())) return emsg('هذا الاسم موجود.');
    try {
      if (editing.pw) { delete u.hash; delete u.vh; delete u.n; Object.assign(u, await A.hash(u.name, editing.pw)); }
      else if (!hasPw(u)) return emsg('اكتب كلمة سر (أو اضغط «توليد كلمة سر»).');
      else u.id = (await A.hash(u.name)).id;
    } catch (e) { return emsg(e.message); }
    const list = st.data.users.slice();
    if (i === -1) list.push(u); else list[i] = u;
    await A.saveUsers(list);
    st = await A.state();
    closeEditor();
    render();
    toast('حُفظ «' + u.name + '». اضغط «نشر الآن» لتصل للأجهزة.');
  }
  function closeEditor() { editing = null; document.querySelector('.drawer')?.remove(); }

  // ---- releases
  // 1.3.0: the three programs, each its own block: the version the computers have, new ones waiting for approval
  const APP_LIST = [['mtm', 'LEVEL7 MTM'], ['nesting', 'LEVEL7 Nesting']];
  // what a build changed: its Arabic line («ar: …») when it has one, else its first line
  const firstLine = n => { const ls = String(n || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(Co-Authored-By|Claude-Session):/.test(l)); const ar = ls.find(l => /^ar:/i.test(l)); return esc(ar ? ar.replace(/^ar:\s*/i, '') : ls[0] || ''); };
  async function renderReleases() {
    $('#main').innerHTML = '<div class="empty">يقرأ الإصدارات…</div>';
    try { releases = await A.releases(); } catch (e) { $('#main').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const pending = releases.versions.filter(v => !v.approved), done = releases.versions.filter(v => v.approved).reverse().slice(0, 5);
    $('#main').innerHTML = `<p class="relnote">الأجهزة لا تثبّت أي إصدار جديد إلا بعد اعتمادك.</p>
      <section class="relbox" data-relapp="cad"><h3>LEVEL7 and MTM <small>برنامج الرسم</small><span class="now">المتاح للأجهزة الآن: <b dir="ltr">${esc(releases.latest || '—')}</b></span></h3>
      ${pending.length ? pending.map(v => `<div class="rel"><b>${esc(v.version)}</b><span>إصدار جديد بانتظار اعتمادك</span><button class="primary big" data-approve="${esc(v.version)}">اعتماد ونشر للأجهزة</button></div>`).join('') : '<div class="empty small">لا يوجد إصدار جديد بانتظار الاعتماد.</div>'}
      ${done.length ? `<h4>معتمدة</h4>${done.map(v => `<div class="rel"><b>${esc(v.version)}</b><span>معتمد ✓${v.version === releases.latest ? ' — متاح للأجهزة' : ''}${v.setup === 'signed' ? ' · المثبِّت موقَّع ✓' : v.setup === 'built' ? ' · المثبِّت جاهز: يُوقَّع الآن…' : ''}</span>${v.canOffer ? `<button class="primary" data-offer="${esc(v.version)}">انشر للأجهزة</button>` : ''}</div>`).join('')}` : ''}</section>
      ${APP_LIST.map(([k, n]) => `<section class="relbox" data-relapp="${k}"><h3>${n}</h3><div class="empty small">يقرأ…</div></section>`).join('')}`;
    // 1.5.0: the installer of an approved release, built on GitHub since: its fingerprint signed with the admin's key
    if (!renderReleases.signing) {
      renderReleases.signing = true;
      A.signSetups().then(r => { renderReleases.signing = false; if (r.signed.length) { toast(`وُقِّع مثبِّت الإصدار ${r.signed.join('، ')} ✓`); if (tab === 'rel') renderReleases(); } })
        .catch(e => { renderReleases.signing = false; toast('تعذر توقيع المثبِّت: ' + (e.message || e), true); });
    }
    for (const [k] of APP_LIST) {
      const box = $(`[data-relapp="${k}"]`);
      A.appReleases(k).then(r => {
        if (!box.isConnected) return;
        const cur = r.latest?.version || '';
        const vnum = v => v.split('.').map(Number);
        const isNewer = v => { if (!cur) return true; const x = vnum(v), y = vnum(cur); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
        const waiting = r.versions.filter(v => isNewer(v.version));
        // 1.3.1: the newest first; the older ones folded away (nothing approved yet: they were all shown as waiting)
        const row = (v, i) => `<div class="rel"><b>${esc(v.version)}</b><span>${i === 0 ? 'أحدث إصدار — ' : ''}${firstLine(v.notes) || 'إصدار جديد'} <i dir="ltr">(${(v.size / 1048576).toFixed(1)} MB)</i></span><button class="${i === 0 ? 'primary big' : ''}" data-app-approve="${k}:${esc(v.version)}">اعتماد ونشر للأجهزة</button></div>`;
        box.innerHTML = `<h3>${esc(r.name)}<span class="now">المتاح للأجهزة الآن: <b dir="ltr">${esc(cur || '—')}</b></span></h3>
          ${waiting.length ? row(waiting[0], 0) + (waiting.length > 1 ? `<details class="older"><summary>إصدارات أقدم (${waiting.length - 1})</summary>${waiting.slice(1).map(v => row(v, 1)).join('')}</details>` : '')
            : '<div class="empty small">لا يوجد إصدار جديد بانتظار الاعتماد.</div>'}`;
      }).catch(e => { if (box.isConnected) box.innerHTML = `<h3>${esc(APP_LIST.find(x => x[0] === k)[1])}</h3><div class="msg bad">${esc(e.message)}</div>`; });
    }
  }

  const watchSetup = { t: 0 };
  // ---- events
  document.addEventListener('click', async e => {
    const t = e.target.closest('button,[data-edit]');
    if (!t) return;
    const a = t.dataset.a, ed = t.dataset.e;
    try {
      if (a === 'pick') { await A.pickKey(); st = await A.state(); renderSetup(); }
      else if (a === 'open') { await A.openKey($('#pass').value); await load(); }
      else if (a === 'token') { await A.setToken($('#tok').value); retoken = false; st = await A.state(); toast('حُفظ رمز GitHub.'); if (st.keyOpen) await load(); else renderSetup(); }
      else if (a === 'retoken') { retoken = true; render(); $('#tok')?.focus(); }
      else if (a === 'retoken-close') { retoken = false; render(); }
      else if (t.dataset.offer) {
        const v = t.dataset.offer;
        if (!confirm(`عرض الإصدار ${v} للأجهزة؟ ستثبّته كل الأجهزة.`)) return;
        t.disabled = true; t.textContent = 'ينشر…';
        const r = await A.offer(v);
        toast(`الإصدار ${r.version} صار متاحاً للأجهزة ✓`);
        renderReleases();
      }
      else if (t.dataset.tab) { tab = t.dataset.tab; render(); }
      else if (a === 'selfupdate') {
        t.disabled = true; t.textContent = 'يحدّث…';
        const r = await A.selfUpdateInstall();
        toast(`تم التحديث إلى ${r.version} ✓`);
      }
      else if (a === 'fullupdate') {
        // 1.5.1: the whole program — downloaded, unpacked, started once to see that it works, then put in place when
        // this one has closed; it opens again by itself
        if (updating) return;
        t.disabled = true; t.textContent = 'يحدّث…';
        const say = m => { updating = m; const el = $('#fullmsg'); if (el) el.textContent = m; };
        A.onUpdateProgress(p => say(p.phase === 'download' ? `ينزّل… ${p.pct}%` : p.phase === 'unpack' ? 'يفكّ الملفات…' : p.phase === 'check' ? 'يفحص الإصدار الجديد…' : 'يثبّت — سيُغلق البرنامج ويفتح من جديد خلال دقيقة.'));
        say('ينزّل…');
        const r = await A.fullUpdateInstall();
        toast(`يُثبَّت الإصدار ${r.version} — سيُغلق البرنامج ويفتح من جديد.`);
      }
      else if (a === 'p-add') { prod = readProd(); prod.customers.push({ name: '', limit: '' }); renderProduction(); const all = document.querySelectorAll('#p-rows .p-name'); all[all.length - 1]?.focus(); }
      else if (a === 'p-del') { const rows = [...document.querySelectorAll('#p-rows .pline')], k = rows.indexOf(t.closest('.pline')); const now = readProdRows(); now.splice(k, 1); prod = { ...readProd(), customers: now }; renderProduction(); }
      else if (a === 'p-save') {
        const v = readProd();
        await A.saveProduction(v);
        prod = null; st = await A.state(); render();
        toast('حُفظ حد الإنتاج اليومي ✓ — اضغط «نشر الآن» ليصل إلى الأجهزة.');
      }
      else if (a === 'add') openEditor(-1);
      else if (t.dataset.edit !== undefined) openEditor(Number(t.dataset.edit));
      else if (a === 'publish') {
        t.disabled = true; t.textContent = 'ينشر…';
        let r = await A.publish();
        if (r.ask) {
          if (!confirm(`بلا جهاز مسجل: ${r.noDevice.join('، ')}\nلن يعملوا على أي جهاز حتى تضيف رموز أجهزتهم.\nانشر على أي حال؟`)) { t.disabled = false; render(); return; }
          r = await A.publish(true);
        }
        st = await A.state(); pub = await A.published().catch(() => pub); render();
        toast(`نُشرت الصلاحيات (الإصدار ${r.version}) ✓ — تصل للأجهزة خلال 30 دقيقة أو عند فتح البرنامج.` + (r.changed ? ' حُفظ تغيير أثناء النشر: اضغط «نشر الآن» مرة أخرى ليصل هو أيضاً.' : ''));
      } else if (t.dataset.appApprove) {
        const [k, v] = t.dataset.appApprove.split(':'), n = k === 'mtm' ? 'LEVEL7 MTM' : 'LEVEL7 Nesting';
        if (!confirm(`اعتماد ${n} ${v}؟ ستثبّته كل الأجهزة.`)) return;
        t.disabled = true; t.textContent = 'ينزّل ويعتمد…';
        const r = await A.appApprove(k, v);
        toast(`اعتُمد ${n} ${r.version} ✓ — صار متاحاً للأجهزة`);
        renderReleases();
      } else if (t.dataset.approve) {
        const v = t.dataset.approve;
        if (!confirm(`اعتماد الإصدار ${v}؟ ستثبّته كل الأجهزة.`)) return;
        t.disabled = true; t.textContent = 'يعتمد…';
        const r = await A.approve(v);
        toast(`اعتُمد الإصدار ${r.version} ✓${r.offered ? ' — صار متاحاً للأجهزة. المثبِّت يُبنى الآن (نحو 10 دقائق) ويُوقَّع تلقائياً ما دام هذا البرنامج مفتوحاً.' : ''}`);
        renderReleases();
        // 1.5.0: the installer is built on GitHub in the next minutes: looked for every minute (40 at most) and signed
        clearInterval(watchSetup.t); let n = 0;
        if (r.offered) watchSetup.t = setInterval(() => { if (++n > 40) return clearInterval(watchSetup.t); A.signSetups().then(x => { if (x.signed.length) { clearInterval(watchSetup.t); toast(`وُقِّع مثبِّت الإصدار ${x.signed.join('، ')} ✓ — الأجهزة تثبّته الآن.`); if (tab === 'rel') renderReleases(); } }).catch(() => {}); }, 60000);
      } else if (ed === 'close') closeEditor();
      else if (ed === 'save') await saveEditor();
      else if (ed === 'gen') {
        readEditor();
        const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', r = new Uint32Array(10);
        crypto.getRandomValues(r); editing.pw = [...r].map(x => abc[x % abc.length]).join(''); drawEditor();
      } else if (ed === 'adddev') {
        readEditor();
        const c = $('#e-dev').value.trim().toUpperCase();
        if (!/^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(c)) return emsg('رمز الجهاز بالشكل ABCDE-FGHJK (من شاشة الدخول عند المستخدم).');
        editing.u.devices = [...new Set([...(editing.u.devices || []), c])]; drawEditor();
      } else if (ed === 'thisdev') {
        readEditor();
        editing.u.devices = [...new Set([...(editing.u.devices || []), st.device])]; drawEditor();
      } else if (t.dataset.etab) { readEditor(); editing.tab = t.dataset.etab; drawEditor(); d0Scroll(); }
      else if (t.dataset.dev !== undefined) { readEditor(); editing.u.devices.splice(Number(t.dataset.dev), 1); drawEditor(); }
      else if (t.dataset.dur) {
        readEditor();
        const k = t.dataset.dur;
        if (k === 'none') editing.u.expires = null;
        else {
          // N days of work counting today: the last working day is today + N − 1 (in this computer's own calendar)
          const dt = new Date(); dt.setDate(dt.getDate() + Number(k) - 1);
          editing.u.expires = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
        }
        drawEditor();
      } else if (t.dataset.grp !== undefined) {
        readEditor();
        const [gp, gi] = t.dataset.grp.split(':'), g = groupsOf(gp)[Number(gi)], u = editing.u, all = g.items.every(([k]) => u.blocked.includes(k));
        u.blocked = all ? u.blocked.filter(k => !g.items.some(([kk]) => kk === k)) : [...new Set([...u.blocked, ...g.items.map(([k]) => k)])];
        drawEditor();
      } else if (ed === 'del') {
        if (!confirm(`حذف «${editing.u.name}»؟`)) return;
        const list = st.data.users.slice(); list.splice(editing.i, 1);
        await A.saveUsers(list); st = await A.state(); closeEditor(); render();
        toast('حُذف. اضغط «نشر الآن» لتصل للأجهزة.');
      }
    } catch (err) {
      const m = err.message || String(err);
      if ($('#smsg') && !st.keyOpen) $('#smsg').textContent = m, $('#smsg').className = 'msg bad';
      else if ($('#tmsg') && a === 'token') $('#tmsg').textContent = m, $('#tmsg').className = 'msg bad';
      else if (editing) emsg(m); else toast(m, true);
      if (a === 'fullupdate') updating = '';
      if (a === 'publish' || t.dataset.approve || t.dataset.appApprove || t.dataset.offer || a === 'fullupdate') { t.disabled = false; render(); }
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.app && editing) { readEditor(); const b = new Set(editing.u.blocked); t.checked ? b.delete(t.dataset.app) : b.add(t.dataset.app); editing.u.blocked = [...b]; drawEditor(); }
    else if (t.dataset.tool && editing) { readEditor(); const b = new Set(editing.u.blocked); t.checked ? b.add(t.dataset.tool) : b.delete(t.dataset.tool); editing.u.blocked = [...b]; drawEditor(); }
    else if (t.id === 'e-date' && editing) { readEditor(); drawEditor(); }
    else if (t.id === 'p-dayon') { prod = { ...readProd(), customers: readProdRows() }; renderProduction(); }
  });
  document.addEventListener('input', e => {
    if (e.target.closest?.('.prodbox')) { prod = { ...readProd(), customers: readProdRows() }; const m = $('#p-msg'); if (m) m.textContent = sameProd() ? '' : 'تغييرات لم تُحفظ بعد.'; }
    if (e.target.classList?.contains('e-tf') && editing) { readEditor(); editing.toolFilter = e.target.value; const id = e.target.id; drawEditor(); const f = $('#' + id); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'pass') $('[data-a="open"]')?.click();
    if (e.key === 'Escape' && editing) closeEditor();
  });
  void load();
})();
