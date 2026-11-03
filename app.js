'use strict';
/* Aplikasi Keuangan Perusahaan (UMKM) — semua data tersimpan di perangkat, tidak ada yang dikirim ke server. */

const KEY = 'keuangan-perusahaan-v1';            // data mode tanpa akun; mode akun memakai KEY + ':' + uid
const LOCK_KEY = 'keuangan-perusahaan-lock';
const MODE_KEY = 'keuangan-mode';                 // 'lokal' bila pengguna memilih tanpa akun
const LAST_UID_KEY = 'keuangan-last-uid';
const DEVICE_KEY = 'keuangan-device-id';
const PBKDF2_ITER = 600000;
const MIN_PW = 8;
const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const MONTHS_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const TYPE_LABEL = {in:'Pemasukan', out:'Pengeluaran', transfer:'Mutasi'};
// Penomoran bukti kas yang lazim: BKM penerimaan, BKK pengeluaran, BM mutasi antarrekening
const REF_PREFIX = {in:'BKM', out:'BKK', transfer:'BM'};
const LOGO_MAX_PX = 256;
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

// Identitas perusahaan diisi sendiri lewat menu Atur dan hanya tersimpan di perangkat.
const PROFILE = {
  name: '', tagline: '', logo: '',
  address: '', npwp: '', nib: '', phone: '', email: '',
  preparedName: '', preparedTitle: 'Bagian Keuangan',
  checkedName: '', checkedTitle: 'Pimpinan',
  pphRate: 0.5,
};
const APP_NAME = 'Aplikasi Keuangan Perusahaan (UMKM)';
const displayName = () => state.company.name || APP_NAME;

// Logo unggahan, atau inisial nama perusahaan bila belum ada logo
function logoHTML(size) {
  const c = state.company;
  if (LOGO_RE.test(c.logo)) return `<img src="${c.logo}" width="${size}" height="${size}" alt="Logo" style="object-fit:contain;border-radius:10px;flex:0 0 auto">`;
  const words = c.name.replace(/^(PT|CV|UD|Koperasi|Yayasan)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  const initials = words.length ? words.slice(0, 2).map(w => w[0]).join('').toUpperCase() : 'Rp';
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" style="flex:0 0 auto"><rect width="64" height="64" rx="14" fill="#14304a"/><text x="32" y="41" text-anchor="middle" font-family="Georgia,serif" font-size="25" font-weight="700" fill="#e5a100">${esc(initials)}</text></svg>`;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rp = n => (n < 0 ? '−Rp ' : 'Rp ') + Math.abs(Math.round(n)).toLocaleString('id-ID');
const parseNum = s => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fmtDate = d => { const [y, m, dd] = d.split('-'); return `${dd} ${MONTHS[+m - 1]} ${y}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const moneyInput = el => el.oninput = () => { const n = parseNum(el.value); el.value = n ? n.toLocaleString('id-ID') : ''; };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

function defaultState() {
  const cat = (code, name, type, lr = true) => ({id: uid(), code, name, type, lr});
  return {
    version: 2,
    company: {...PROFILE},
    security: {autoLockMin: 5},
    lastBackup: '',
    // Akun & kategori umum; ubah, tambah, atau hapus di menu Atur sesuai daftar akun perusahaan
    accounts: [
      {id: 'kas', code: '1-101', name: 'Kas', opening: 0},
      {id: 'bank', code: '1-102', name: 'Bank', opening: 0},
    ],
    categories: [
      cat('4-101', 'Penjualan', 'in'),
      cat('4-102', 'Pendapatan jasa', 'in'),
      cat('4-901', 'Pendapatan lain-lain', 'in'),
      cat('3-101', 'Setoran modal', 'in', false),
      cat('2-201', 'Penerimaan pinjaman', 'in', false),
      cat('5-101', 'Pembelian barang / harga pokok', 'out'),
      cat('5-201', 'Gaji dan BPJS', 'out'),
      cat('5-301', 'Sewa', 'out'),
      cat('5-302', 'Listrik, air & internet', 'out'),
      cat('5-303', 'Transportasi', 'out'),
      cat('5-304', 'ATK & perlengkapan', 'out'),
      cat('5-305', 'Administrasi bank', 'out'),
      cat('5-501', 'PPh final', 'out'),
      cat('5-901', 'Beban lain-lain', 'out'),
      cat('1-401', 'Pembelian aset tetap', 'out', false),
      cat('2-202', 'Pembayaran pokok pinjaman', 'out', false),
      cat('3-102', 'Prive / penarikan pemilik', 'out', false),
    ],
    tx: [],
    debts: [],
  };
}

/* ---------- Validasi data ----------
   Semua data dari penyimpanan atau file backup dibersihkan dulu: id hanya huruf/angka, tanggal
   berformat baku, angka wajar, teks dibatasi panjangnya. Mencegah file backup palsu menyisipkan kode. */
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanStr = (v, max = 500) => String(v ?? '').slice(0, max);
const cleanNum = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(-1e15, Math.min(1e15, Math.round(n))) : 0; };
const cleanId = v => ID_RE.test(String(v ?? '')) ? String(v) : null;
const cleanDate = v => DATE_RE.test(String(v ?? '')) ? String(v) : '';

function sanitizeState(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.tx) || !Array.isArray(d.accounts) || !Array.isArray(d.categories))
    throw new Error('Struktur data tidak dikenali');
  const co = typeof d.company === 'string' ? (d.company && d.company !== 'Nama Perusahaan' ? {name: d.company} : {}) : (d.company || {});
  const company = {};
  for (const k of Object.keys(PROFILE)) {
    company[k] = k === 'pphRate'
      ? (Number.isFinite(+co[k]) && +co[k] >= 0 && +co[k] <= 100 ? +co[k] : PROFILE.pphRate)
      : k === 'logo'
        ? (typeof co.logo === 'string' && co.logo.length < 400000 && LOGO_RE.test(co.logo) ? co.logo : '')
        : cleanStr(co[k] ?? PROFILE[k], 300);
  }
  const autoLock = +d.security?.autoLockMin;
  return {
    version: cleanNum(d.version),
    company,
    security: {autoLockMin: [1, 5, 15, 30].includes(autoLock) ? autoLock : 5},
    lastBackup: cleanDate(d.lastBackup),
    accounts: d.accounts.map(a => ({id: cleanId(a?.id), code: cleanStr(a?.code, 20), name: cleanStr(a?.name, 120), opening: cleanNum(a?.opening)}))
      .filter(a => a.id),
    categories: d.categories.map(c => ({id: cleanId(c?.id), code: cleanStr(c?.code, 20), name: cleanStr(c?.name, 120),
      type: c?.type === 'out' ? 'out' : 'in', lr: c?.lr === undefined ? undefined : c.lr !== false})).filter(c => c.id),
    tx: d.tx.map(t => {
      const x = {id: cleanId(t?.id), created: cleanNum(t?.created), type: ['in', 'out', 'transfer'].includes(t?.type) ? t.type : null,
        date: cleanDate(t?.date), ref: cleanStr(t?.ref, 40), amount: Math.abs(cleanNum(t?.amount)),
        accountId: cleanId(t?.accountId), toAccountId: t?.toAccountId ? cleanId(t.toAccountId) : null,
        categoryId: t?.categoryId ? cleanId(t.categoryId) : null, desc: cleanStr(t?.desc)};
      if (cleanId(t?.debtId)) x.debtId = t.debtId;
      return x;
    }).filter(t => t.id && t.type && t.date && t.accountId),
    debts: (Array.isArray(d.debts) ? d.debts : []).map(x => ({id: cleanId(x?.id), created: cleanNum(x?.created),
      kind: x?.kind === 'utang' ? 'utang' : 'piutang', party: cleanStr(x?.party, 120), ref: cleanStr(x?.ref, 40),
      date: cleanDate(x?.date), due: cleanDate(x?.due), amount: Math.abs(cleanNum(x?.amount)),
      categoryId: cleanId(x?.categoryId), desc: cleanStr(x?.desc)})).filter(x => x.id && x.date),
  };
}

// Melengkapi data versi lama
function migrate() {
  // Data versi pertama tanpa transaksi diganti daftar akun & kategori bawaan terbaru
  if (!state.version && !state.tx.length && !state.debts.length) {
    const d = defaultState();
    state.accounts = d.accounts; state.categories = d.categories;
  }
  state.version = 2;
  state.categories.forEach(c => {
    if (c.lr === undefined) c.lr = !/modal|setoran pemilik|pinjaman|prive/i.test(c.name);
  });
}

/* ---------- Enkripsi (AES-GCM 256, kunci dari kata sandi lewat PBKDF2-SHA256) ---------- */
const te = new TextEncoder(), td = new TextDecoder();
const hasCrypto = !!(window.crypto && crypto.subtle);
function toB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256'}, base,
    {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
async function seal(v, json) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name: 'AES-GCM', iv}, v.key, te.encode(json));
  return {enc: 1, app: 'catatan-keuangan', iter: v.iter, salt: toB64(v.salt), iv: toB64(iv), ct: toB64(ct)};
}
async function unseal(key, env) {
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: fromB64(env.iv)}, key, fromB64(env.ct));
  return JSON.parse(td.decode(pt));
}
const isEnvelope = x => x && x.enc === 1 && typeof x.salt === 'string' && typeof x.iv === 'string' && typeof x.ct === 'string';
const envIter = env => Number.isInteger(env.iter) && env.iter >= 100000 && env.iter <= 5e6 ? env.iter : PBKDF2_ITER;

let state = null;
let vault = null; // {key, salt, iter} selama kata sandi aktif dan aplikasi terbuka
let saving = Promise.resolve();
let storeKey = KEY;

/* ---------- Akun & sinkron server ---------- */
let Cloud = null;          // modul cloud.js bila konfigurasi Firebase terisi
let cloudUser = null, cloudInfo = null, offlineAccount = false;
let dirty = false, pushTimer = null, syncMsg = '';
const deviceId = (() => {
  try { let id = localStorage.getItem(DEVICE_KEY); if (!id) { id = uid() + uid(); localStorage.setItem(DEVICE_KEY, id); } return id; }
  catch { return uid(); }
})();
const metaKey = () => storeKey + '-meta';
function readMeta() { try { return JSON.parse(localStorage.getItem(metaKey())) || {updatedAt: 0}; } catch { return {updatedAt: 0}; } }
const writeMeta = updatedAt => localStorage.setItem(metaKey(), JSON.stringify({updatedAt}));

function setSync(msg) {
  syncMsg = msg;
  const el = document.getElementById('syncStatus'); if (el) el.textContent = msg;
}
function schedulePush() {
  clearTimeout(pushTimer);
  setSync('Menyimpan ke server…');
  pushTimer = setTimeout(pushNow, 1500);
}
async function pushNow() {
  clearTimeout(pushTimer);
  if (!cloudUser || !dirty) return;
  if (!navigator.onLine) return setSync('Offline — perubahan disinkron otomatis saat online.');
  try {
    await saving;
    dirty = false;
    await Cloud.push(localStorage.getItem(storeKey) || '', readMeta().updatedAt, deviceId);
    setSync('Tersimpan di server · ' + new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'}));
  } catch {
    dirty = true;
    setSync('Gagal menyimpan ke server — dicoba lagi otomatis.');
    pushTimer = setTimeout(pushNow, 15000);
  }
}
addEventListener('online', () => { if (dirty) pushNow(); });

// Perubahan dari perangkat lain (data yang lebih baru di server)
async function applyRemote(meta) {
  if (!state || dirty || meta.deviceId === deviceId || !(meta.updatedAt > readMeta().updatedAt)) return;
  let r; try { r = await Cloud.pull(); } catch { return; }
  if (!r || dirty) return;
  localStorage.setItem(storeKey, r.payload); writeMeta(r.updatedAt);
  let d; try { d = JSON.parse(r.payload); } catch { return; }
  if (isEnvelope(d)) {
    if (!vault) return location.reload();
    try { d = await unseal(vault.key, d); } catch { return location.reload(); } // kata sandi diganti di perangkat lain
  } else vault = null;
  try { state = sanitizeState(d); } catch { return; }
  migrate();
  document.querySelectorAll('dialog[open]').forEach(x => x.close());
  renderAll(); setSync('Tersinkron dengan perangkat lain'); toast('Data diperbarui dari perangkat lain');
}

function persist() {
  const json = JSON.stringify(state), v = vault;
  saving = saving.then(async () => {
    localStorage.setItem(storeKey, v ? JSON.stringify(await seal(v, json)) : json);
    writeMeta(Date.now());
    if (cloudUser) { dirty = true; schedulePush(); }
  }).catch(() => toast('Gagal menyimpan di perangkat — segera lakukan backup!'));
  return saving;
}
function save() { persist(); renderAll(); }
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Dialog kata sandi ---------- */
function askPassword({title, hint = '', confirm = false}) {
  return new Promise(resolve => {
    $('pwTitle').textContent = title;
    $('pwHint').textContent = hint;
    $('pw1').value = $('pw2').value = ''; $('pwErr').textContent = '';
    $('pw1').autocomplete = confirm ? 'new-password' : 'current-password';
    $('pw2Wrap').style.display = confirm ? '' : 'none';
    const dlg = $('pwDialog');
    const done = v => { dlg.close(); $('pw1').value = $('pw2').value = ''; resolve(v); };
    $('pwForm').onsubmit = e => {
      e.preventDefault();
      const a = $('pw1').value, b = $('pw2').value;
      if (confirm && a.length < MIN_PW) return $('pwErr').textContent = `Minimal ${MIN_PW} karakter.`;
      if (confirm && a !== b) return $('pwErr').textContent = 'Kedua kata sandi tidak sama.';
      if (!a) return $('pwErr').textContent = 'Kata sandi wajib diisi.';
      done(a);
    };
    $('btnPwCancel').onclick = () => done(null);
    dlg.oncancel = e => { e.preventDefault(); done(null); };
    dlg.showModal(); $('pw1').focus();
  });
}

/* ---------- Layar kunci & pembatasan percobaan ---------- */
function lockInfo() { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || {fails: 0, until: 0}; } catch { return {fails: 0, until: 0}; } }
function setLockInfo(x) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(x)); } catch {} }

function showLock(env) {
  document.body.className = 'locked';
  const msg = $('lockMsg'), btn = $('lockBtn');
  const tick = () => {
    const wait = Math.ceil((lockInfo().until - Date.now()) / 1000);
    btn.disabled = wait > 0;
    if (wait > 0) { msg.textContent = `Terlalu banyak percobaan. Coba lagi dalam ${wait} detik.`; setTimeout(tick, 1000); }
  };
  tick();
  $('lockPw').focus();
  $('lockForm').onsubmit = async e => {
    e.preventDefault();
    if (lockInfo().until > Date.now()) return tick();
    const pw = $('lockPw').value; if (!pw) return;
    btn.disabled = true; msg.textContent = 'Memeriksa…';
    try {
      const salt = fromB64(env.salt), iter = envIter(env);
      const key = await deriveKey(pw, salt, iter);
      const data = await unseal(key, env);
      vault = {key, salt, iter};
      setLockInfo({fails: 0, until: 0});
      $('lockPw').value = '';
      start(data);
    } catch {
      // Jeda bertambah dua kali lipat setelah 5 kali salah: 30 dtk, 1 mnt, 2 mnt, …
      const info = lockInfo(); info.fails++;
      if (info.fails >= 5) info.until = Date.now() + 30000 * 2 ** Math.min(info.fails - 5, 8);
      setLockInfo(info);
      $('lockPw').value = '';
      msg.textContent = 'Kata sandi salah.';
      btn.disabled = false; tick();
    }
  };
  $('btnLockReset').onclick = () => {
    if (!confirm('Hapus SEMUA data keuangan di perangkat ini? Data hanya bisa kembali dari file backup.')) return;
    if (prompt('Ketik HAPUS untuk konfirmasi') !== 'HAPUS') return;
    localStorage.removeItem(storeKey); localStorage.removeItem(metaKey()); setLockInfo({fails: 0, until: 0});
    // Di mode akun, salinan di server juga dihapus agar tidak terunduh lagi
    (cloudUser ? Cloud.wipe().catch(() => {}) : Promise.resolve()).then(() => location.reload());
  };
}

async function lockNow() {
  if (!vault) return;
  await saving;
  location.reload(); // muat ulang = semua data di memori ikut terhapus
}
let idleTimer = null, hiddenAt = 0;
function resetIdle() {
  clearTimeout(idleTimer);
  if (vault) idleTimer = setTimeout(lockNow, (state?.security?.autoLockMin || 5) * 60000);
}
function armAutoLock() {
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => addEventListener(ev, resetIdle, {passive: true}));
  // Aplikasi ditinggal (pindah aplikasi / layar mati) lebih dari 1 menit → terkunci
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (vault && hiddenAt && Date.now() - hiddenAt > 60000) lockNow();
  });
  resetIdle();
}

/* ---------- Pengaturan keamanan ---------- */
function renderSecurity() {
  const noCrypto = !hasCrypto;
  $('secStatus').innerHTML = noCrypto
    ? '<div class="notice">Kata sandi & enkripsi hanya tersedia bila aplikasi dibuka lewat alamat https (mis. GitHub Pages).</div>'
    : vault
      ? '<div class="notice ok"><b>Terlindungi.</b> Data di perangkat ini terenkripsi (AES-256) dan aplikasi meminta kata sandi setiap dibuka.</div>'
      : '<div class="notice"><b>Belum terlindungi.</b> Siapa pun yang memegang perangkat ini bisa membuka data. Pasang kata sandi untuk mengenkripsi data dan mengunci aplikasi.</div>';
  $('btnSetPw').textContent = vault ? 'Ganti kata sandi' : 'Pasang kata sandi';
  $('btnSetPw').disabled = noCrypto;
  $('btnRemovePw').style.display = vault ? '' : 'none';
  $('btnLockNow').style.display = vault ? '' : 'none';
  $('secAuto').value = String(state.security.autoLockMin);
  $('secAuto').disabled = !vault;
}
async function verifyCurrent() {
  const pw = await askPassword({title: 'Masukkan kata sandi saat ini'});
  if (pw === null) return false;
  try {
    // Kata sandi benar bila kuncinya bisa membuka data terenkripsi yang tersimpan
    const key = await deriveKey(pw, vault.salt, vault.iter);
    await saving;
    await unseal(key, JSON.parse(localStorage.getItem(storeKey)));
    return true;
  } catch { toast('Kata sandi salah'); return false; }
}
$('btnSetPw').onclick = async () => {
  if (vault && !await verifyCurrent()) return;
  const pw = await askPassword({title: vault ? 'Kata sandi baru' : 'Pasang kata sandi', confirm: true,
    hint: `Minimal ${MIN_PW} karakter. Gunakan gabungan huruf, angka, dan simbol. Jika lupa, data di perangkat ini tidak bisa dibuka — simpan juga file backup.`});
  if (pw === null) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  vault = {key: await deriveKey(pw, salt, PBKDF2_ITER), salt, iter: PBKDF2_ITER};
  await persist(); renderSecurity(); resetIdle();
  toast('Kata sandi terpasang — data kini terenkripsi');
};
$('btnRemovePw').onclick = async () => {
  if (!vault || !await verifyCurrent()) return;
  if (!confirm('Hapus kata sandi? Data akan disimpan TANPA enkripsi dan aplikasi tidak lagi terkunci.')) return;
  vault = null; clearTimeout(idleTimer);
  await persist(); renderSecurity(); toast('Kata sandi dihapus');
};
$('btnLockNow').onclick = lockNow;
$('secAuto').onchange = () => { state.security.autoLockMin = +$('secAuto').value; persist(); resetIdle(); };

const accName = id => state.accounts.find(a => a.id === id)?.name || '(akun dihapus)';
const catOf = id => state.categories.find(c => c.id === id);
const catName = id => catOf(id)?.name || '—';
const catLabel = id => { const c = catOf(id); return c ? (c.code ? `<span class="code">${esc(c.code)}</span>` : '') + esc(c.name) : '—'; };
// Transaksi yang dihitung sebagai pendapatan/beban di Laba Rugi
const inLR = t => t.type !== 'transfer' && catOf(t.categoryId)?.lr !== false;
const statCard = ([l, v, c, sub]) => `<div class="card stat"><div class="label">${l}</div><div class="value ${c}">${v}</div>${sub ? `<div class="muted" style="font-size:12px;margin-top:4px">${sub}</div>` : ''}</div>`;

function nextRef(type, date) {
  const p = `${REF_PREFIX[type]}-${date.slice(2, 4)}${date.slice(5, 7)}-`;
  const used = state.tx.filter(t => (t.ref || '').startsWith(p)).map(t => parseInt(t.ref.slice(p.length)) || 0);
  return p + String(Math.max(0, ...used) + 1).padStart(3, '0');
}

// Pengaruh transaksi terhadap saldo satu akun
function effect(t, accId) {
  if (t.type === 'in') return t.accountId === accId ? t.amount : 0;
  if (t.type === 'out') return t.accountId === accId ? -t.amount : 0;
  let e = 0;
  if (t.accountId === accId) e -= t.amount;
  if (t.toAccountId === accId) e += t.amount;
  return e;
}
function balance(accId, upTo) {
  const a = state.accounts.find(x => x.id === accId);
  let b = a ? a.opening : 0;
  for (const t of state.tx) if (!upTo || t.date <= upTo) b += effect(t, accId);
  return b;
}
const totalBalance = upTo => state.accounts.reduce((s, a) => s + balance(a.id, upTo), 0);
const sorted = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

/* ---------- Navigasi ---------- */
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
  window.scrollTo(0, 0);
});

/* ---------- Dasbor ---------- */
function renderDashboard() {
  const notices = [];
  if (!state.company.name) notices.push('<div class="notice">Lengkapi nama, slogan, dan logo perusahaan untuk kop laporan. <button class="btn sm" data-act="goProfile">Isi profil</button></div>');
  if (hasCrypto && !vault) notices.push('<div class="notice">Data belum dilindungi kata sandi. <button class="btn sm" data-act="goSecurity">Pasang sekarang</button></div>');
  if (state.tx.length && (!state.lastBackup || daysBetween(state.lastBackup, today()) > 7))
    notices.push(`<div class="notice">${state.lastBackup ? 'Backup terakhir ' + fmtDate(state.lastBackup) + '.' : 'Data belum pernah di-backup.'} <button class="btn sm" data-act="backup">Backup sekarang</button></div>`);
  $('dashNotices').innerHTML = notices.join('');

  const years = new Set([new Date().getFullYear(), ...state.tx.map(t => +t.date.slice(0, 4))]);
  const ySel = $('dashYear'), cur = ySel.value || new Date().getFullYear();
  ySel.innerHTML = [...years].sort((a, b) => b - a).map(y => `<option ${y == cur ? 'selected' : ''}>${y}</option>`).join('');
  const year = ySel.value;
  const ym = today().slice(0, 7);

  const yearTx = state.tx.filter(t => t.date.startsWith(year));
  const sum = (list, type) => list.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);
  const monthTx = state.tx.filter(t => t.date.startsWith(ym));
  const lrTx = yearTx.filter(inLR);
  const yIn = sum(lrTx, 'in'), yOut = sum(lrTx, 'out');
  const p = debtTotals('piutang'), u = debtTotals('utang');

  $('statCards').innerHTML = [
    ['Total Kas & Bank', rp(totalBalance()), ''],
    [`Pemasukan ${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`, rp(sum(monthTx, 'in')), 'in'],
    [`Pengeluaran ${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`, rp(sum(monthTx, 'out')), 'out'],
    [`Laba/Rugi ${esc(year)}`, rp(yIn - yOut), yIn - yOut >= 0 ? 'in' : 'out'],
    ['Piutang Belum Tertagih', rp(p.open), '', p.no ? `<span class="out">${p.no} lewat jatuh tempo (${rp(p.overdue)})</span>` : `${p.n} tagihan`],
    ['Utang Belum Dibayar', rp(u.open), '', u.no ? `<span class="out">${u.no} lewat jatuh tempo (${rp(u.overdue)})</span>` : `${u.n} tagihan`],
  ].map(statCard).join('');

  const months = MONTHS.map((m, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    const l = yearTx.filter(t => t.date.startsWith(key));
    return {m, in: sum(l, 'in'), out: sum(l, 'out')};
  });
  const max = Math.max(1, ...months.flatMap(x => [x.in, x.out]));
  $('monthBars').innerHTML = months.map(x => `
    <div class="bar-group" title="${x.m}: masuk ${rp(x.in)} / keluar ${rp(x.out)}">
      <div class="bar-pair"><div class="bar in" style="height:${x.in / max * 100}%"></div><div class="bar out" style="height:${x.out / max * 100}%"></div></div>
      <div class="bar-label">${x.m.slice(0, 3)}</div>
    </div>`).join('');

  const byCat = {};
  yearTx.filter(t => t.type === 'out').forEach(t => byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount);
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('topCats').innerHTML = cats.length ? cats.map(([id, v]) => `
    <div class="cat-row"><span>${esc(catName(id))}</span><span>${rp(v)}</span></div>
    <div class="meter"><span style="width:${v / cats[0][1] * 100}%"></span></div>`).join('')
    : `<div class="empty">Belum ada pengeluaran di ${esc(year)}</div>`;

  const recent = sorted(state.tx).slice(0, 8);
  $('recentTx').innerHTML = recent.length ? `<table><tbody>${recent.map(t => `
    <tr><td style="white-space:nowrap">${fmtDate(t.date)}</td><td>${esc(t.desc || (t.type === 'transfer' ? 'Mutasi antarakun' : catName(t.categoryId)))}</td>
    <td class="num ${t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : ''}">${t.type === 'out' ? '−' : ''}${rp(t.amount)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">Belum ada transaksi. Ketuk <b>+ Transaksi</b> untuk mulai mencatat.</div>`;

  $('accBalances').innerHTML = `<table><tbody>${state.accounts.map(a => `
    <tr><td>${a.code ? `<span class="code">${esc(a.code)}</span>` : ''}${esc(a.name)}</td><td class="num">${rp(balance(a.id))}</td></tr>`).join('')}
    <tr><td><b>Total</b></td><td class="num"><b>${rp(totalBalance())}</b></td></tr></tbody></table>`;
}
$('dashYear').onchange = renderDashboard;

/* ---------- Transaksi ---------- */
function fillSelect(sel, items, allLabel, label = i => (i.code ? i.code + ' · ' : '') + i.name) {
  const v = sel.value;
  sel.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') +
    items.map(i => `<option value="${esc(i.id)}">${esc(label(i))}</option>`).join('');
  if ([...sel.options].some(o => o.value === v)) sel.value = v;
}
function filteredTx() {
  const from = $('fFrom').value, to = $('fTo').value, type = $('fType').value,
        acc = $('fAcc').value, cat = $('fCat').value, q = $('fSearch').value.toLowerCase();
  return sorted(state.tx).filter(t =>
    (!from || t.date >= from) && (!to || t.date <= to) && (!type || t.type === type) &&
    (!acc || t.accountId === acc || t.toAccountId === acc) && (!cat || t.categoryId === cat) &&
    (!q || (t.desc + ' ' + (t.ref || '')).toLowerCase().includes(q)));
}
function renderTx() {
  fillSelect($('fAcc'), state.accounts, 'Semua akun');
  fillSelect($('fCat'), state.categories, 'Semua kategori');
  const list = filteredTx();
  const tin = list.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const tout = list.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);
  $('filterSummary').innerHTML = [
    ['Jumlah transaksi', list.length.toLocaleString('id-ID'), ''],
    ['Total pemasukan', rp(tin), 'in'], ['Total pengeluaran', rp(tout), 'out'], ['Selisih', rp(tin - tout), tin - tout >= 0 ? 'in' : 'out'],
  ].map(statCard).join('');

  $('txBody').innerHTML = list.length ? list.map(t => `
    <tr>
      <td data-label="Tanggal">${fmtDate(t.date)}</td><td data-label="No. bukti">${esc(t.ref)}</td>
      <td data-label="Jenis"><span class="badge ${t.type === 'transfer' ? 'tr' : t.type}">${TYPE_LABEL[t.type]}</span></td>
      <td data-label="Kategori">${t.type === 'transfer' ? '—' : catLabel(t.categoryId)}</td>
      <td data-label="Akun">${esc(accName(t.accountId))}${t.type === 'transfer' ? ' → ' + esc(accName(t.toAccountId)) : ''}</td>
      <td data-label="Uraian">${esc(t.desc)}</td>
      <td data-label="Jumlah" class="num ${t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : ''}"><b>${t.type === 'out' ? '−' : ''}${rp(t.amount)}</b></td>
      <td data-label="" class="no-print num"><button class="btn sm" data-act="openTx" data-id="${esc(t.id)}">Ubah</button></td>
    </tr>`).join('') : `<tr><td colspan="8" class="empty" data-label="">Tidak ada transaksi yang cocok.</td></tr>`;
}
['fFrom', 'fTo', 'fType', 'fAcc', 'fCat', 'fSearch'].forEach(id => $(id).oninput = renderTx);
$('btnResetFilter').onclick = () => { ['fFrom', 'fTo', 'fType', 'fAcc', 'fCat', 'fSearch'].forEach(id => $(id).value = ''); renderTx(); };

// Teks yang diawali = + - @ diberi tanda kutip agar tidak dijalankan sebagai rumus oleh Excel
const csvCell = v => {
  let s = String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
$('btnCsv').onclick = () => {
  const rows = [['Tanggal', 'No. Bukti', 'Jenis', 'Kode Akun', 'Kategori', 'Akun', 'Ke Akun', 'Uraian', 'Jumlah']];
  filteredTx().forEach(t => rows.push([t.date, t.ref || '', TYPE_LABEL[t.type], t.type === 'transfer' ? '' : catOf(t.categoryId)?.code || '',
    t.type === 'transfer' ? '' : catName(t.categoryId), accName(t.accountId), t.type === 'transfer' ? accName(t.toAccountId) : '',
    t.desc || '', t.type === 'out' ? -t.amount : t.amount]));
  const csv = rows.map(r => r.map(csvCell).join(';')).join('\r\n');
  download('﻿' + csv, `transaksi-${today()}.csv`, 'text/csv');
};

/* ---------- Dialog transaksi ---------- */
let editing = null, txType = 'in';
function setTxType(t) {
  txType = t;
  document.querySelectorAll('#txTypeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('txCatWrap').style.display = t === 'transfer' ? 'none' : '';
  $('txToWrap').style.display = t === 'transfer' ? '' : 'none';
  $('txAccLabel').textContent = t === 'transfer' ? 'Dari akun' : t === 'in' ? 'Masuk ke akun' : 'Dibayar dari akun';
  fillSelect($('txCat'), state.categories.filter(c => c.type === t));
  refreshAutoRef();
}
// No. bukti otomatis selama pengguna belum mengetik sendiri
function refreshAutoRef() {
  if ($('txRef').dataset.auto === '1' && $('txDate').value) $('txRef').value = nextRef(txType, $('txDate').value);
}
document.querySelectorAll('#txTypeSeg button').forEach(b => b.onclick = () => setTxType(b.dataset.t));
$('txDate').onchange = refreshAutoRef;
$('txRef').oninput = () => { $('txRef').dataset.auto = ''; };
moneyInput($('txAmount'));

function openTx(id) {
  editing = id ? state.tx.find(t => t.id === id) : null;
  fillSelect($('txAcc'), state.accounts);
  fillSelect($('txTo'), state.accounts);
  const t = editing || {type: txType === 'transfer' ? 'in' : txType, date: today()};
  $('txDate').value = t.date;
  $('txRef').dataset.auto = editing ? '' : '1';
  $('txRef').value = t.ref || '';
  setTxType(t.type);
  const debt = editing?.debtId && state.debts.find(d => d.id === editing.debtId);
  $('txLink').style.display = debt ? '' : 'none';
  if (debt) $('txLink').textContent = `Pembayaran ${KIND_LABEL[debt.kind].toLowerCase()} — ${debt.party}${debt.ref ? ' · ' + debt.ref : ''}`;
  document.querySelectorAll('#txTypeSeg button').forEach(b => b.disabled = !!debt);
  $('txDialogTitle').textContent = editing ? 'Ubah Transaksi' : 'Transaksi Baru';
  $('txAmount').value = t.amount ? t.amount.toLocaleString('id-ID') : '';
  $('txDesc').value = t.desc || '';
  if (t.accountId) $('txAcc').value = t.accountId;
  if (t.toAccountId) $('txTo').value = t.toAccountId;
  else if (state.accounts[1]) $('txTo').value = state.accounts[1].id;
  if (t.categoryId) $('txCat').value = t.categoryId;
  $('btnDeleteTx').style.display = editing ? '' : 'none';
  $('txDialog').showModal();
}
$('btnAdd').onclick = () => openTx();
$('btnCancelTx').onclick = () => $('txDialog').close();
$('btnDeleteTx').onclick = () => {
  if (!confirm('Hapus transaksi ini?')) return;
  state.tx = state.tx.filter(t => t !== editing);
  $('txDialog').close(); save(); toast('Transaksi dihapus');
};
$('txForm').onsubmit = e => {
  const amount = parseNum($('txAmount').value);
  const fail = msg => { e.preventDefault(); toast(msg); };
  if (amount <= 0) return fail('Jumlah harus lebih dari 0');
  if (!state.accounts.length) return fail('Tambahkan akun dulu di menu Atur');
  if (txType === 'transfer' && $('txAcc').value === $('txTo').value) return fail('Akun asal dan tujuan harus berbeda');
  if (txType !== 'transfer' && !$('txCat').value) return fail('Pilih kategori');
  const debt = editing?.debtId && state.debts.find(d => d.id === editing.debtId);
  if (debt && amount > remainOf(debt) + editing.amount) return fail('Jumlah melebihi sisa ' + rp(remainOf(debt) + editing.amount));
  const data = {
    type: txType, date: $('txDate').value, ref: $('txRef').value.trim().slice(0, 40), amount,
    accountId: $('txAcc').value, desc: $('txDesc').value.trim().slice(0, 500),
    categoryId: txType === 'transfer' ? null : $('txCat').value,
    toAccountId: txType === 'transfer' ? $('txTo').value : null,
  };
  if (editing) Object.assign(editing, data);
  else state.tx.push({id: uid(), created: Date.now(), ...data});
  save(); toast(editing ? 'Transaksi diperbarui' : 'Transaksi tersimpan · ' + data.ref);
};

/* ---------- Piutang & Utang ---------- */
// Pembayaran piutang/utang = transaksi biasa (masuk/keluar) yang membawa debtId,
// sehingga saldo akun dan Laba Rugi (berbasis kas) otomatis ikut berubah.
const KIND_LABEL = {piutang: 'Piutang', utang: 'Utang'};
const debtTx = (d, upTo) => state.tx.filter(t => t.debtId === d.id && (!upTo || t.date <= upTo));
const paidOf = (d, upTo) => debtTx(d, upTo).reduce((s, t) => s + t.amount, 0);
const remainOf = (d, upTo) => d.amount - paidOf(d, upTo);
function debtStatus(d) {
  if (remainOf(d) <= 0) return {key: 'paid', label: 'Lunas', cls: 'in'};
  if (d.due && d.due < today()) return {key: 'overdue', label: `Telat ${daysBetween(d.due, today())} hari`, cls: 'out'};
  return {key: 'open', label: paidOf(d) > 0 ? 'Dibayar sebagian' : 'Belum dibayar', cls: 'warn'};
}
function debtTotals(kind) {
  const open = state.debts.filter(d => d.kind === kind && remainOf(d) > 0);
  const overdue = open.filter(d => d.due && d.due < today());
  const sumRemain = l => l.reduce((s, d) => s + remainOf(d), 0);
  return {open: sumRemain(open), overdue: sumRemain(overdue), n: open.length, no: overdue.length};
}

function renderDebts() {
  const p = debtTotals('piutang'), u = debtTotals('utang');
  $('debtCards').innerHTML = [
    ['Piutang belum tertagih', rp(p.open), 'in', `${p.n} tagihan`],
    ['Piutang lewat jatuh tempo', rp(p.overdue), p.overdue ? 'out' : '', `${p.no} tagihan`],
    ['Utang belum dibayar', rp(u.open), 'out', `${u.n} tagihan`],
    ['Utang lewat jatuh tempo', rp(u.overdue), u.overdue ? 'out' : '', `${u.no} tagihan`],
  ].map(statCard).join('');

  const kind = $('dKind').value, st = $('dStatus').value, q = $('dSearch').value.toLowerCase();
  const list = state.debts.filter(d => {
    const s = debtStatus(d).key;
    return (!kind || d.kind === kind) && (!st || (st === 'open' ? s !== 'paid' : s === st)) &&
      (!q || (d.party + ' ' + (d.ref || '')).toLowerCase().includes(q));
  }).sort((a, b) => (a.due || a.date).localeCompare(b.due || b.date));

  $('debtBody').innerHTML = list.length ? list.map(d => { const s = debtStatus(d); return `
    <tr>
      <td data-label="Jenis"><span class="badge ${d.kind === 'piutang' ? 'in' : 'out'}">${KIND_LABEL[d.kind]}</span></td>
      <td data-label="Pihak"><b>${esc(d.party)}</b></td><td data-label="No. faktur">${esc(d.ref)}</td>
      <td data-label="Tanggal">${fmtDate(d.date)}</td><td data-label="Jatuh tempo">${d.due ? fmtDate(d.due) : '—'}</td>
      <td data-label="Nilai" class="num">${rp(d.amount)}</td><td data-label="Terbayar" class="num">${rp(paidOf(d))}</td>
      <td data-label="Sisa" class="num"><b>${rp(Math.max(0, remainOf(d)))}</b></td>
      <td data-label="Status"><span class="badge ${s.cls}">${s.label}</span></td>
      <td data-label="" class="no-print num" style="white-space:nowrap">${s.key !== 'paid' ? `<button class="btn sm primary" data-act="openPay" data-id="${esc(d.id)}">${d.kind === 'piutang' ? 'Terima' : 'Bayar'}</button> ` : ''}<button class="btn sm" data-act="openDebt" data-id="${esc(d.id)}">Detail</button></td>
    </tr>`; }).join('') : `<tr><td colspan="10" class="empty" data-label="">Tidak ada data piutang/utang yang cocok.</td></tr>`;
}
['dKind', 'dStatus', 'dSearch'].forEach(id => $(id).oninput = renderDebts);

let editingDebt = null, debtKind = 'piutang';
function setDebtKind(k) {
  debtKind = k;
  document.querySelectorAll('#debtKindSeg button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('debtPartyLabel').textContent = k === 'piutang' ? 'Klien / pihak yang berutang' : 'Pemasok / pihak pemberi utang';
  fillSelect($('dCat'), state.categories.filter(c => c.type === (k === 'piutang' ? 'in' : 'out')));
}
document.querySelectorAll('#debtKindSeg button').forEach(b => b.onclick = () => setDebtKind(b.dataset.k));
moneyInput($('dAmount'));

function openDebt(id) {
  editingDebt = id ? state.debts.find(d => d.id === id) : null;
  const d = editingDebt || {kind: debtKind, date: today()};
  setDebtKind(d.kind);
  const pays = editingDebt ? debtTx(editingDebt).sort((a, b) => a.date.localeCompare(b.date)) : [];
  // Jenis tidak boleh diganti setelah ada pembayaran (arah transaksinya sudah tercatat)
  document.querySelectorAll('#debtKindSeg button').forEach(b => b.disabled = pays.length > 0);
  $('debtTitle').textContent = editingDebt ? 'Detail ' + KIND_LABEL[d.kind] : 'Piutang / Utang Baru';
  $('dParty').value = d.party || '';
  $('dRef').value = d.ref || '';
  $('dDate').value = d.date;
  $('dDue').value = d.due || '';
  $('dAmount').value = d.amount ? d.amount.toLocaleString('id-ID') : '';
  $('dDesc').value = d.desc || '';
  if (d.categoryId) $('dCat').value = d.categoryId;
  $('partyList').innerHTML = [...new Set(state.debts.map(x => x.party))].map(p => `<option value="${esc(p)}">`).join('');
  $('debtPayments').innerHTML = !editingDebt ? '' : `<h3 style="font-size:13px;margin:0 0 6px">Riwayat pembayaran</h3>` + (pays.length
    ? `<table><tbody>${pays.map(t => `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.ref)}</td><td class="num">${rp(t.amount)}</td>
        <td class="num"><button type="button" class="btn sm" data-act="editPayment" data-id="${esc(t.id)}">Ubah</button></td></tr>`).join('')}
        <tr><td colspan="2"><b>Sisa</b></td><td class="num"><b>${rp(Math.max(0, remainOf(editingDebt)))}</b></td><td></td></tr></tbody></table>`
    : '<div class="muted">Belum ada pembayaran.</div>');
  $('btnDeleteDebt').style.display = editingDebt ? '' : 'none';
  $('debtDialog').showModal();
}
$('btnAddDebt').onclick = () => openDebt();
$('btnCancelDebt').onclick = () => $('debtDialog').close();
$('debtForm').onsubmit = e => {
  const amount = parseNum($('dAmount').value), party = $('dParty').value.trim().slice(0, 120);
  const fail = msg => { e.preventDefault(); toast(msg); };
  if (!party) return fail('Isi nama pihak');
  if (amount <= 0) return fail('Nilai harus lebih dari 0');
  if (!$('dCat').value) return fail('Pilih kategori');
  if ($('dDue').value && $('dDue').value < $('dDate').value) return fail('Jatuh tempo tidak boleh sebelum tanggal');
  if (editingDebt && amount < paidOf(editingDebt)) return fail('Nilai lebih kecil dari yang sudah dibayar (' + rp(paidOf(editingDebt)) + ')');
  const data = {kind: debtKind, party, ref: $('dRef').value.trim().slice(0, 40), date: $('dDate').value, due: $('dDue').value,
    amount, categoryId: $('dCat').value, desc: $('dDesc').value.trim().slice(0, 500)};
  if (editingDebt) {
    Object.assign(editingDebt, data);
    debtTx(editingDebt).forEach(t => t.categoryId = data.categoryId);
  } else state.debts.push({id: uid(), created: Date.now(), ...data});
  save(); toast('Data tersimpan');
};
$('btnDeleteDebt').onclick = () => {
  const n = debtTx(editingDebt).length;
  if (!confirm(n ? `Hapus data ini? ${n} transaksi pembayarannya tetap ada di daftar Transaksi, tetapi tidak lagi terhubung.` : 'Hapus data ini?')) return;
  state.tx.forEach(t => { if (t.debtId === editingDebt.id) delete t.debtId; });
  state.debts = state.debts.filter(d => d !== editingDebt);
  $('debtDialog').close(); save(); toast('Data dihapus');
};

let payingDebt = null;
function openPay(id) {
  if (!state.accounts.length) return toast('Tambahkan akun dulu di menu Atur');
  payingDebt = state.debts.find(d => d.id === id);
  if (!payingDebt) return;
  const r = remainOf(payingDebt);
  fillSelect($('pAcc'), state.accounts);
  $('payTitle').textContent = payingDebt.kind === 'piutang' ? 'Terima Pembayaran Piutang' : 'Bayar Utang';
  $('payInfo').innerHTML = `${esc(payingDebt.party)}${payingDebt.ref ? ' · ' + esc(payingDebt.ref) : ''} — sisa <b>${rp(r)}</b>`;
  $('pAccLabel').textContent = payingDebt.kind === 'piutang' ? 'Masuk ke akun' : 'Dibayar dari akun';
  $('pDate').value = today();
  $('pAmount').value = r.toLocaleString('id-ID');
  $('pRef').value = nextRef(payingDebt.kind === 'piutang' ? 'in' : 'out', today());
  $('payDialog').showModal();
}
moneyInput($('pAmount'));
$('btnCancelPay').onclick = () => $('payDialog').close();
$('payForm').onsubmit = e => {
  const d = payingDebt, amount = parseNum($('pAmount').value);
  if (amount <= 0) { e.preventDefault(); return toast('Jumlah harus lebih dari 0'); }
  if (amount > remainOf(d)) { e.preventDefault(); return toast('Jumlah melebihi sisa ' + rp(remainOf(d))); }
  state.tx.push({id: uid(), created: Date.now(), type: d.kind === 'piutang' ? 'in' : 'out', date: $('pDate').value,
    ref: $('pRef').value.trim().slice(0, 40), amount, accountId: $('pAcc').value, categoryId: d.categoryId, toAccountId: null, debtId: d.id,
    desc: `${d.kind === 'piutang' ? 'Pelunasan piutang' : 'Pembayaran utang'} ${d.party}${d.ref ? ' (' + d.ref + ')' : ''}`.slice(0, 500)});
  save(); toast(remainOf(d) <= 0 ? 'Pembayaran tercatat — LUNAS' : 'Pembayaran tercatat');
};

/* ---------- Laporan ---------- */
function initReportDates() {
  const y = new Date().getFullYear();
  $('rFrom').value = `${y}-01-01`; $('rTo').value = `${y}-12-31`;
}
function kop(title, sub) {
  const c = state.company;
  const meta = [c.address, c.npwp && 'NPWP ' + c.npwp, c.nib && 'NIB ' + c.nib, c.phone, c.email].filter(Boolean).map(esc).join(' · ');
  return `<div class="kop">${logoHTML(48)}<div><div class="kop-name">${esc(c.name || 'Nama Perusahaan')}</div>${c.tagline ? `<div class="kop-meta"><i>${esc(c.tagline)}</i></div>` : ''}<div class="kop-meta">${meta}</div></div></div>
    <h2>${title}</h2><div class="sub">${sub}</div>`;
}
function signBlock() {
  const c = state.company, blank = '(....................................)';
  return `<div class="sign">
    <div>Dibuat oleh<div class="sp"></div><b>${c.preparedName ? esc(c.preparedName.toUpperCase()) : blank}</b><div>${esc(c.preparedTitle)}</div></div>
    <div>Diperiksa oleh<div class="sp"></div><b>${c.checkedName ? esc(c.checkedName.toUpperCase()) : blank}</b><div>${esc(c.checkedTitle)}</div></div></div>`;
}
function renderReport() {
  fillSelect($('rAcc'), state.accounts);
  const type = $('rType').value, from = cleanDate($('rFrom').value), to = cleanDate($('rTo').value);
  $('rAccWrap').style.display = type === 'bk' ? '' : 'none';
  $('rFromWrap').style.display = type === 'umur' ? 'none' : '';
  const inRange = state.tx.filter(t => (!from || t.date >= from) && (!to || t.date <= to));
  const period = `Periode ${from ? fmtDate(from) : 'awal'} s.d. ${to ? fmtDate(to) : 'sekarang'}`;
  const dayBefore = from ? new Date(new Date(from).getTime() - 864e5).toISOString().slice(0, 10) : null;
  let html = '';

  if (type === 'lr') {
    const group = t => {
      const m = {};
      inRange.filter(x => x.type === t && inLR(x)).forEach(x => m[x.categoryId] = (m[x.categoryId] || 0) + x.amount);
      return Object.entries(m).sort((a, b) => (catOf(a[0])?.code || 'z').localeCompare(catOf(b[0])?.code || 'z') || b[1] - a[1]);
    };
    const ins = group('in'), outs = group('out');
    const ti = ins.reduce((s, x) => s + x[1], 0), to_ = outs.reduce((s, x) => s + x[1], 0);
    const rows = list => list.map(([id, v]) => `<tr><td style="padding-left:24px">${catLabel(id)}</td><td class="num">${rp(v)}</td></tr>`).join('')
      || '<tr><td class="muted" style="padding-left:24px">—</td><td></td></tr>';
    html = kop('Laporan Laba Rugi', period) + `<table>
      <tr class="sect"><td colspan="2">Pendapatan</td></tr>${rows(ins)}
      <tr><td><b>Total Pendapatan</b></td><td class="num"><b>${rp(ti)}</b></td></tr>
      <tr class="sect"><td colspan="2">Beban</td></tr>${rows(outs)}
      <tr><td><b>Total Beban</b></td><td class="num"><b>(${rp(to_)})</b></td></tr>
      <tr class="total"><td>${ti - to_ >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH'}</td><td class="num ${ti - to_ >= 0 ? 'in' : 'out'}">${rp(ti - to_)}</td></tr>
    </table><p class="muted" style="font-size:12px">Laporan berbasis kas: piutang/utang dihitung saat dibayar. Kategori tanpa centang L/R (modal, pinjaman, pembelian aset, prive) tidak dimasukkan.</p>` + signBlock();
  } else if (type === 'ak') {
    const rows = state.accounts.map(a => {
      const open = dayBefore ? balance(a.id, dayBefore) : a.opening;
      let inn = 0, out = 0;
      inRange.forEach(t => { const e = effect(t, a.id); if (e > 0) inn += e; else out -= e; });
      return {a, open, inn, out, close: open + inn - out};
    });
    const tot = k => rows.reduce((s, r) => s + r[k], 0);
    html = kop('Laporan Arus Kas per Akun', period) + `<table>
      <thead><tr><th>Akun</th><th class="num">Saldo Awal</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo Akhir</th></tr></thead>
      ${rows.map(r => `<tr><td>${r.a.code ? `<span class="code">${esc(r.a.code)}</span>` : ''}${esc(r.a.name)}</td><td class="num">${rp(r.open)}</td><td class="num in">${rp(r.inn)}</td><td class="num out">${rp(r.out)}</td><td class="num">${rp(r.close)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${rp(tot('open'))}</td><td class="num">${rp(tot('inn'))}</td><td class="num">${rp(tot('out'))}</td><td class="num">${rp(tot('close'))}</td></tr>
    </table><p class="muted" style="font-size:12px">Mutasi antarakun tercatat masuk/keluar di masing-masing akun, sehingga totalnya saling meniadakan. Cocokkan saldo akhir dengan rekening koran setiap akhir bulan.</p>` + signBlock();
  } else if (type === 'bk') {
    const accId = $('rAcc').value, a = state.accounts.find(x => x.id === accId);
    if (!a) { $('reportOut').innerHTML = '<div class="empty">Belum ada akun.</div>'; return; }
    let run = dayBefore ? balance(accId, dayBefore) : a.opening;
    const list = inRange.filter(t => effect(t, accId) !== 0).sort((x, y) => x.date.localeCompare(y.date) || x.created - y.created);
    html = kop('Buku Kas & Bank — ' + (a.code ? esc(a.code) + ' ' : '') + esc(a.name), period) + `<table>
      <thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Uraian</th><th>Kode</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo</th></tr></thead>
      <tr class="sect"><td colspan="6">Saldo awal</td><td class="num">${rp(run)}</td></tr>
      ${list.map(t => { const e = effect(t, accId); run += e;
        const ket = t.desc || (t.type === 'transfer' ? `Mutasi ${accName(t.accountId)} → ${accName(t.toAccountId)}` : catName(t.categoryId));
        return `<tr><td style="white-space:nowrap">${fmtDate(t.date)}</td><td>${esc(t.ref)}</td><td>${esc(ket)}</td><td>${esc(catOf(t.categoryId)?.code || '')}</td>
          <td class="num">${e > 0 ? rp(e) : ''}</td><td class="num">${e < 0 ? rp(-e) : ''}</td><td class="num">${rp(run)}</td></tr>`; }).join('')}
      <tr class="total"><td colspan="6">Saldo akhir</td><td class="num">${rp(run)}</td></tr>
    </table>` + signBlock();
  } else if (type === 'umur') {
    const asOf = to || today();
    const buckets = ['Belum jatuh tempo', '1–30 hari', '31–60 hari', '61–90 hari', '> 90 hari'];
    const bucketOf = d => {
      if (!d.due || d.due >= asOf) return 0;
      const n = daysBetween(d.due, asOf);
      return n <= 30 ? 1 : n <= 60 ? 2 : n <= 90 ? 3 : 4;
    };
    const total = v => v.reduce((a, b) => a + b, 0);
    const section = kind => {
      const rows = new Map();
      state.debts.filter(d => d.kind === kind && d.date <= asOf).forEach(d => {
        const r = remainOf(d, asOf);
        if (r <= 0) return;
        if (!rows.has(d.party)) rows.set(d.party, buckets.map(() => 0));
        rows.get(d.party)[bucketOf(d)] += r;
      });
      const parties = [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      const tot = buckets.map((_, i) => parties.reduce((s, [, v]) => s + v[i], 0));
      return `<tr class="sect"><td colspan="7">${KIND_LABEL[kind]}</td></tr>` +
        (parties.map(([p, v]) => `<tr><td style="padding-left:24px">${esc(p)}</td>${v.map(x => `<td class="num">${x ? rp(x) : '—'}</td>`).join('')}<td class="num">${rp(total(v))}</td></tr>`).join('')
          || '<tr><td colspan="7" class="muted" style="padding-left:24px">Tidak ada saldo</td></tr>') +
        `<tr class="total"><td>Total ${KIND_LABEL[kind]}</td>${tot.map(x => `<td class="num">${rp(x)}</td>`).join('')}<td class="num">${rp(total(tot))}</td></tr>`;
    };
    html = kop('Umur Piutang &amp; Utang', 'Per ' + fmtDate(asOf)) + `<table>
        <thead><tr><th>Pihak</th>${buckets.map(b => `<th class="num">${b}</th>`).join('')}<th class="num">Total</th></tr></thead>
        ${section('piutang')}${section('utang')}
      </table><p class="muted" style="font-size:12px">Umur dihitung dari jatuh tempo sampai tanggal "Sampai". Tagihan tanpa jatuh tempo dianggap belum jatuh tempo.</p>` + signBlock();
  } else if (type === 'pph') {
    const rate = (+state.company.pphRate || 0) / 100;
    const start = (from || inRange.map(t => t.date).sort()[0] || today()).slice(0, 7), end = (to || today()).slice(0, 7);
    const pphCats = new Set(state.categories.filter(c => c.code === '5-501').map(c => c.id));
    const nextYm = ym => { let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
    const rows = [];
    for (let ym = start; ym <= end && rows.length < 120; ym = nextYm(ym)) {
      const bruto = state.tx.filter(t => t.type === 'in' && inLR(t) && t.date.startsWith(ym)).reduce((s, t) => s + t.amount, 0);
      const pph = Math.floor(bruto * rate);
      const due = `${nextYm(ym)}-15`;
      // Setoran PPh final yang dibayar pada bulan berikutnya dianggap untuk masa ini
      const paid = state.tx.filter(t => t.type === 'out' && pphCats.has(t.categoryId) && t.date.startsWith(nextYm(ym))).reduce((s, t) => s + t.amount, 0);
      const st = !pph ? ['Nihil', ''] : paid >= pph ? ['Lunas', 'in'] : due < today() ? ['Kurang setor', 'out'] : ['Belum jatuh tempo', 'warn'];
      rows.push({ym, bruto, pph, due, paid, st});
    }
    const sumK = k => rows.reduce((s, r) => s + r[k], 0);
    html = kop(`Rekap PPh Final ${esc(String(state.company.pphRate).replace('.', ','))}%`, period) + `<table>
      <thead><tr><th>Masa</th><th class="num">Peredaran bruto</th><th class="num">PPh terutang</th><th>Jatuh tempo</th><th class="num">Disetor</th><th>Status</th></tr></thead>
      ${rows.map(r => `<tr><td>${MONTHS_FULL[+r.ym.slice(5) - 1]} ${r.ym.slice(0, 4)}</td><td class="num">${rp(r.bruto)}</td><td class="num">${rp(r.pph)}</td>
        <td style="white-space:nowrap">${fmtDate(r.due)}</td><td class="num">${rp(r.paid)}</td><td><span class="badge ${r.st[1]}">${r.st[0]}</span></td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${rp(sumK('bruto'))}</td><td class="num">${rp(sumK('pph'))}</td><td></td><td class="num">${rp(sumK('paid'))}</td><td></td></tr>
    </table><p class="muted" style="font-size:12px">Peredaran bruto = kategori pendapatan yang masuk L/R. Usaha perantara cukup mencatat komisinya sebagai pendapatan. Setoran = transaksi kategori kode 5-501 pada bulan berikutnya. Tarif dapat diubah di menu Atur; geser jatuh tempo bila tanggal 15 jatuh pada hari libur.</p>` + signBlock();
  }
  $('reportOut').innerHTML = html;
}
['rType', 'rFrom', 'rTo', 'rAcc'].forEach(id => $(id).oninput = renderReport);
$('rType').addEventListener('change', () => { if ($('rType').value === 'umur') { $('rTo').value = today(); renderReport(); } });

/* ---------- Pengaturan ---------- */
const PROFILE_FIELDS = {pName: 'name', pTagline: 'tagline', pAddress: 'address', pNpwp: 'npwp', pNib: 'nib', pPhone: 'phone',
  pEmail: 'email', pPrepName: 'preparedName', pPrepTitle: 'preparedTitle', pCheckName: 'checkedName', pCheckTitle: 'checkedTitle', pPph: 'pphRate'};
function renderSettings() {
  const c = state.company;
  $('companyName').textContent = displayName();
  $('companyTagline').textContent = c.tagline;
  document.title = c.name ? 'Keuangan UMKM · ' + c.name : APP_NAME;
  $('brandLogo').innerHTML = logoHTML(38);
  $('logoPreview').innerHTML = logoHTML(64);
  $('btnLogoRemove').style.display = c.logo ? '' : 'none';
  Object.entries(PROFILE_FIELDS).forEach(([id, k]) => {
    if (document.activeElement !== $(id)) $(id).value = k === 'pphRate' ? String(c[k]).replace('.', ',') : c[k] ?? '';
  });
  $('accList').innerHTML = state.accounts.map(a => `<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td class="num">${rp(a.opening)}</td>
    <td class="num" style="white-space:nowrap"><button class="btn sm" data-act="editAcc" data-id="${esc(a.id)}">Ubah</button> <button class="btn sm danger" data-act="delAcc" data-id="${esc(a.id)}">Hapus</button></td></tr>`).join('');
  $('catList').innerHTML = state.categories.map(c => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td><span class="badge ${c.type === 'out' ? 'out' : 'in'}">${TYPE_LABEL[c.type]}</span></td>
    <td><input type="checkbox" ${c.lr !== false ? 'checked' : ''} data-act="toggleLR" data-id="${esc(c.id)}" title="Dihitung di Laba Rugi"></td>
    <td class="num" style="white-space:nowrap"><button class="btn sm" data-act="editCat" data-id="${esc(c.id)}">Ubah</button> <button class="btn sm danger" data-act="delCat" data-id="${esc(c.id)}">Hapus</button></td></tr>`).join('');
  renderSecurity();
  renderAccount();
}
function renderAccount() {
  const box = $('accountBox');
  if (!Cloud?.enabled()) {
    box.innerHTML = '<div class="muted">Penyimpanan server belum diaktifkan (konfigurasi Firebase di <code>firebase-config.js</code> masih kosong). Data hanya tersimpan di perangkat ini; pindahkan antar perangkat dengan Backup &amp; Pulihkan.</div>';
    return;
  }
  if (offlineAccount) {
    box.innerHTML = '<div class="notice">Offline: memakai salinan data akun di perangkat ini. Perubahan akan tersimpan ke server setelah aplikasi dibuka kembali saat online.</div>';
    return;
  }
  if (!cloudUser) {
    box.innerHTML = `<div class="notice">Anda memakai aplikasi <b>tanpa akun</b>; data hanya ada di perangkat ini.</div>
      <button class="btn primary" data-act="goLogin">Masuk / Daftar akun</button>`;
    return;
  }
  box.innerHTML = `<div>Masuk sebagai <b>@${esc(cloudInfo.username || '—')}</b></div>
    <div class="muted" style="font-size:12px">${cloudInfo.google ? 'Akun Google · ' + esc(cloudInfo.email || '') : 'Akun username & kata sandi'}</div>
    <div class="muted" id="syncStatus" style="margin:8px 0">${esc(syncMsg)}</div>
    <div class="muted" style="font-size:12px;margin-bottom:10px">${vault
      ? 'Data dienkripsi di perangkat sebelum dikirim, sehingga server pun tidak bisa membacanya.'
      : 'Tips: pasang kata sandi di kartu Keamanan agar data dienkripsi sebelum dikirim ke server.'}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" data-act="syncNow">Sinkron sekarang</button>
      <button class="btn danger" data-act="logout">Keluar</button>
    </div>`;
}
$('btnSaveCompany').onclick = () => {
  Object.entries(PROFILE_FIELDS).forEach(([id, k]) => {
    if (k === 'pphRate') { const r = parseFloat($(id).value.replace(',', '.')); state.company[k] = Number.isFinite(r) && r >= 0 && r <= 100 ? r : PROFILE.pphRate; }
    else state.company[k] = $(id).value.trim().slice(0, 300);
  });
  save(); toast('Profil disimpan');
};
// Logo digambar ulang lewat canvas: diperkecil ke maks. 256 px dan dibersihkan dari metadata/isi tersembunyi
$('logoFile').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast('Gunakan gambar PNG, JPG, atau WebP');
  if (f.size > 5 * 1024 * 1024) return toast('Ukuran logo maksimal 5 MB');
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.width * scale)); cv.height = Math.max(1, Math.round(img.height * scale));
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL('image/png');
      if (!LOGO_RE.test(url) || url.length >= 400000) return toast('Logo tidak bisa dipakai');
      state.company.logo = url; save(); toast('Logo disimpan');
    };
    img.onerror = () => toast('File gambar tidak valid');
    img.src = reader.result;
  };
  reader.readAsDataURL(f);
};
$('btnLogoRemove').onclick = () => { state.company.logo = ''; save(); toast('Logo dihapus'); };
moneyInput($('newAccOpen'));
$('btnAddAcc').onclick = () => {
  const name = $('newAccName').value.trim().slice(0, 120); if (!name) return toast('Isi nama akun');
  state.accounts.push({id: uid(), code: $('newAccCode').value.trim().slice(0, 20), name, opening: parseNum($('newAccOpen').value)});
  $('newAccCode').value = $('newAccName').value = $('newAccOpen').value = ''; save();
};
$('btnAddCat').onclick = () => {
  const name = $('newCatName').value.trim().slice(0, 120); if (!name) return toast('Isi nama kategori');
  state.categories.push({id: uid(), code: $('newCatCode').value.trim().slice(0, 20), name, type: $('newCatType').value === 'out' ? 'out' : 'in', lr: true});
  $('newCatCode').value = $('newCatName').value = ''; save();
};

// Satu penangan untuk semua tombol yang dibuat dinamis (tanpa onclick di HTML, sesuai CSP)
const ACTIONS = {
  openTx, openPay, openDebt,
  editPayment: id => { $('debtDialog').close(); openTx(id); },
  editAcc: id => {
    const a = state.accounts.find(x => x.id === id); if (!a) return;
    const code = prompt('Kode akun:', a.code); if (code === null) return;
    const name = prompt('Nama akun:', a.name); if (name === null) return;
    const open = prompt('Saldo awal (Rp):', a.opening); if (open === null) return;
    a.code = code.trim().slice(0, 20); a.name = name.trim().slice(0, 120) || a.name; a.opening = parseNum(open); save();
  },
  delAcc: id => {
    if (state.tx.some(t => t.accountId === id || t.toAccountId === id)) return toast('Akun masih dipakai transaksi, tidak bisa dihapus');
    if (confirm('Hapus akun ini?')) { state.accounts = state.accounts.filter(a => a.id !== id); save(); }
  },
  editCat: id => {
    const c = state.categories.find(x => x.id === id); if (!c) return;
    const code = prompt('Kode akun:', c.code); if (code === null) return;
    const name = prompt('Nama kategori:', c.name); if (name === null) return;
    c.code = code.trim().slice(0, 20); c.name = name.trim().slice(0, 120) || c.name; save();
  },
  delCat: id => {
    if (state.tx.some(t => t.categoryId === id) || state.debts.some(d => d.categoryId === id)) return toast('Kategori masih dipakai, tidak bisa dihapus');
    if (confirm('Hapus kategori ini?')) { state.categories = state.categories.filter(c => c.id !== id); save(); }
  },
  print: () => window.print(),
  backup: () => $('btnBackup').click(),
  goLogin: () => { localStorage.removeItem(MODE_KEY); location.reload(); },
  syncNow: async () => {
    if (!cloudUser) return;
    dirty = true; await pushNow();
  },
  logout: async () => {
    if (!confirm('Keluar dari akun? Salinan data di perangkat ini dihapus; data tetap aman di server dan muncul lagi saat Anda masuk.')) return;
    if (dirty) await pushNow();
    if (dirty && !confirm('Ada perubahan yang BELUM tersimpan ke server (offline?). Tetap keluar dan buang perubahan itu?')) return;
    await Cloud.signOut().catch(() => {});
    [storeKey, metaKey(), LAST_UID_KEY].forEach(k => localStorage.removeItem(k));
    location.reload();
  },
  goProfile: () => { document.querySelector('nav button[data-view="pengaturan"]').click(); $('pName').focus(); },
  goSecurity: () => { document.querySelector('nav button[data-view="pengaturan"]').click(); $('btnSetPw').focus(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.type === 'checkbox' || !Object.hasOwn(ACTIONS, el.dataset.act)) return;
  ACTIONS[el.dataset.act](el.dataset.id);
});
document.addEventListener('change', e => {
  const el = e.target.closest('input[data-act="toggleLR"]');
  const c = el && state.categories.find(x => x.id === el.dataset.id);
  if (c) { c.lr = el.checked; save(); }
});

/* ---------- Backup & pulihkan ---------- */
// Di HP, file dikirim lewat menu Bagikan (Drive, File); di komputer langsung diunduh
async function download(content, name, type) {
  const blob = new Blob([content], {type});
  try {
    const file = new File([blob], name, {type});
    if (matchMedia('(pointer:coarse)').matches && navigator.canShare?.({files: [file]})) {
      await navigator.share({files: [file], title: name});
      return true;
    }
  } catch (err) { if (err?.name === 'AbortError') return false; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
$('btnBackup').onclick = async () => {
  if (!vault && !confirm('Kata sandi belum dipasang, sehingga file backup TIDAK terenkripsi dan bisa dibaca siapa pun yang memegang filenya. Lanjutkan?')) return;
  state.lastBackup = today();
  const json = JSON.stringify(state);
  const content = vault ? JSON.stringify(await seal(vault, json)) : JSON.stringify(state, null, 2);
  if (await download(content, `backup-keuangan-${today()}${vault ? '-terenkripsi' : ''}.json`, 'application/json')) save();
};
$('fileRestore').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (f.size > 20 * 1024 * 1024) return toast('File terlalu besar untuk sebuah backup');
  try {
    let d = JSON.parse(await f.text());
    if (isEnvelope(d)) {
      if (!hasCrypto) return toast('Backup terenkripsi hanya bisa dibuka lewat alamat https');
      const pw = await askPassword({title: 'Kata sandi file backup', hint: 'Masukkan kata sandi yang aktif saat backup ini dibuat.'});
      if (pw === null) return;
      try { d = await unseal(await deriveKey(pw, fromB64(d.salt), envIter(d)), d); }
      catch { return toast('Kata sandi backup salah'); }
    }
    const clean = sanitizeState(d);
    if (!confirm(`Pulihkan ${clean.tx.length} transaksi dan ${clean.debts.length} piutang/utang dari file? Data saat ini akan diganti.`)) return;
    clean.security = state.security; // pengaturan keamanan perangkat ini tetap
    state = clean; migrate(); save(); toast('Data berhasil dipulihkan');
  } catch { toast('File backup tidak valid'); }
};
$('btnWipe').onclick = () => {
  if (!confirm('Hapus SEMUA data? Pastikan sudah backup.')) return;
  if (prompt('Ketik HAPUS untuk konfirmasi') !== 'HAPUS') return;
  const sec = state.security;
  state = defaultState(); state.security = sec; save(); toast('Semua data dihapus');
};

/* ---------- Pasang sebagai aplikasi (Android & iOS) ---------- */
let installPrompt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
function renderInstall() {
  const box = $('installBox');
  if (isStandalone()) { box.innerHTML = '<div class="muted">Aplikasi sudah terpasang di perangkat ini.</div>'; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  box.innerHTML = `<h3 style="margin-top:0">Pasang di HP</h3>` + (installPrompt
    ? '<button class="btn accent" id="btnInstall">Pasang aplikasi</button>'
    : ios ? '<div class="muted">Di iPhone/iPad: buka di <b>Safari</b>, ketuk tombol <b>Bagikan</b>, lalu pilih <b>Tambah ke Layar Utama</b>.</div>'
          : '<div class="muted">Di Android: buka di <b>Chrome</b>, ketuk menu <b>⋮</b>, lalu pilih <b>Instal aplikasi</b> atau <b>Tambahkan ke layar utama</b>.</div>');
  if (installPrompt) $('btnInstall').onclick = async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; renderInstall(); };
}
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; if (state) renderInstall(); });
addEventListener('appinstalled', () => { installPrompt = null; if (state) renderInstall(); toast('Aplikasi terpasang'); });

function renderAll() { renderDashboard(); renderTx(); renderDebts(); renderReport(); renderSettings(); }

/* ---------- Mulai ---------- */
function start(data) {
  try { state = data ? sanitizeState(data) : defaultState(); }
  catch {
    // Data rusak: simpan salinannya, jangan ditimpa diam-diam
    try { localStorage.setItem(KEY + '-rusak-' + Date.now(), JSON.stringify(data)); } catch {}
    state = defaultState();
    setTimeout(() => toast('Data tersimpan rusak; salinannya diamankan. Pulihkan dari backup.'), 500);
  }
  migrate();
  document.body.className = '';
  initReportDates(); renderAll(); renderInstall(); armAutoLock();
  if (cloudUser) { if (dirty) schedulePush(); else setSync('Tersinkron dengan server'); }
}

// Buka data dari penyimpanan perangkat (key = mode tanpa akun atau salinan akun)
function openStore(key) {
  storeKey = key;
  let raw = null, parsed = null;
  try { raw = localStorage.getItem(key); } catch {}
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = {broken: true}; }
  if (isEnvelope(parsed)) {
    if (!hasCrypto) { document.body.className = ''; document.body.innerHTML = '<p style="padding:20px">Data terenkripsi hanya bisa dibuka lewat alamat https.</p>'; return; }
    showLock(parsed);
  } else start(parsed);
}

/* ---------- Layar login ---------- */
const AUTH_ERR = {
  'auth/invalid-credential': 'Username atau kata sandi salah.', 'auth/wrong-password': 'Username atau kata sandi salah.',
  'auth/user-not-found': 'Username atau kata sandi salah.', 'auth/invalid-email': 'Username tidak valid.',
  'auth/email-already-in-use': 'Username sudah dipakai. Pilih yang lain.', 'username-taken': 'Username sudah dipakai. Pilih yang lain.',
  'username-invalid': 'Username 3–30 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.',
  'auth/weak-password': `Kata sandi terlalu lemah (minimal ${MIN_PW} karakter).`,
  'auth/too-many-requests': 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.',
  'auth/network-request-failed': 'Tidak ada koneksi internet.',
  'auth/unauthorized-domain': 'Alamat situs ini belum diizinkan di Firebase (Authentication → Settings → Authorized domains).',
  'auth/operation-not-allowed': 'Metode login ini belum diaktifkan di Firebase (Authentication → Sign-in method).',
  'auth/popup-closed-by-user': '', 'auth/cancelled-popup-request': '',
};
const authErr = e => AUTH_ERR[e?.code]
  ?? (/api-key|invalid-api|project/.test(e?.code || '') ? 'Konfigurasi Firebase tidak valid. Periksa isi firebase-config.js.' : 'Gagal masuk. Coba lagi.');
let authMode = 'login';
function showAuth(msg = '') {
  document.body.className = 'auth';
  $('authMsg').textContent = msg;
  const setMode = m => {
    authMode = m;
    document.querySelectorAll('#authTabs button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('authPw2Wrap').style.display = m === 'register' ? '' : 'none';
    $('authPw').autocomplete = m === 'register' ? 'new-password' : 'current-password';
    $('authSubmit').textContent = m === 'register' ? 'Daftar' : 'Masuk';
    $('authMsg').textContent = '';
  };
  document.querySelectorAll('#authTabs button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  const busy = on => document.querySelectorAll('#auth button, #auth input').forEach(x => x.disabled = on);
  const run = async fn => {
    busy(true); $('authMsg').textContent = 'Memproses…';
    try { const u = await fn(); if (u) { $('authPw').value = $('authPw2').value = ''; await openAccount(u); } }
    catch (e) { $('authMsg').textContent = authErr(e); }
    finally { busy(false); }
  };
  $('btnGoogle').onclick = () => run(() => Cloud.signInGoogle());
  $('authForm').onsubmit = e => {
    e.preventDefault();
    const u = $('authUser').value.trim().toLowerCase(), pw = $('authPw').value;
    if (!Cloud.USERNAME_RE.test(u)) return $('authMsg').textContent = AUTH_ERR['username-invalid'];
    if (authMode === 'register') {
      if (pw.length < MIN_PW) return $('authMsg').textContent = `Kata sandi minimal ${MIN_PW} karakter.`;
      if (pw !== $('authPw2').value) return $('authMsg').textContent = 'Kedua kata sandi tidak sama.';
      return run(() => Cloud.registerUsername(u, pw));
    }
    if (!pw) return $('authMsg').textContent = 'Isi kata sandi.';
    run(() => Cloud.signInUsername(u, pw));
  };
  $('btnLocalMode').onclick = () => {
    if (!confirm('Pakai tanpa akun? Data hanya tersimpan di perangkat ini dan tidak bisa dibuka dari perangkat lain. Anda bisa masuk ke akun kapan saja dari menu Atur.')) return;
    localStorage.setItem(MODE_KEY, 'lokal'); openStore(KEY);
  };
}
function askUsername() {
  return new Promise(resolve => {
    const dlg = $('unameDialog'); $('unameInput').value = ''; $('unameErr').textContent = '';
    const done = v => { dlg.close(); resolve(v); };
    $('unameForm').onsubmit = async e => {
      e.preventDefault();
      const u = $('unameInput').value.trim().toLowerCase();
      if (!Cloud.USERNAME_RE.test(u)) return $('unameErr').textContent = AUTH_ERR['username-invalid'];
      try { await Cloud.claimUsername(u); done(u); }
      catch (err) { $('unameErr').textContent = authErr(err); }
    };
    $('btnUnameCancel').onclick = () => done(null);
    dlg.oncancel = e => { e.preventDefault(); done(null); };
    dlg.showModal(); $('unameInput').focus();
  });
}

async function openAccount(user) {
  cloudUser = user;
  storeKey = KEY + ':' + user.uid;
  localStorage.setItem(LAST_UID_KEY, user.uid);
  localStorage.removeItem(MODE_KEY);
  $('authMsg').textContent = 'Memuat data akun…';
  let username = null;
  try { username = await Cloud.getUsername(); } catch {}
  if (!username && user.email?.endsWith('@pengguna.invalid')) username = user.email.split('@')[0];
  if (!username) {
    username = await askUsername();
    if (username === null) { await Cloud.signOut(); cloudUser = null; return showAuth(); }
  }
  cloudInfo = {username, email: user.email, google: user.providerData.some(p => p.providerId === 'google.com')};

  let remote = null, reachable = true;
  try { remote = await Cloud.pull(); } catch { reachable = false; }
  const localRaw = localStorage.getItem(storeKey), lm = readMeta();
  if (remote && (!localRaw || remote.updatedAt > lm.updatedAt)) {
    localStorage.setItem(storeKey, remote.payload); writeMeta(remote.updatedAt);
  } else if (reachable && !remote && !localRaw && localStorage.getItem(KEY)
             && confirm('Ada data keuangan di perangkat ini yang belum terhubung ke akun. Pindahkan ke akun ini agar tersimpan di server?')) {
    localStorage.setItem(storeKey, localStorage.getItem(KEY)); writeMeta(Date.now());
    localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-meta');
  }
  dirty = !!localStorage.getItem(storeKey) && (!remote || readMeta().updatedAt > remote.updatedAt);
  setSync(reachable ? 'Tersinkron dengan server' : 'Tidak terhubung ke server — perubahan disinkron saat online.');
  Cloud.watch(applyRemote);
  openStore(storeKey);
}

async function boot() {
  // Anti-clickjacking: aplikasi menolak dibuka di dalam bingkai (iframe) situs lain
  if (window.top !== window.self) {
    document.body.className = '';
    document.body.innerHTML = '<p style="padding:20px">Demi keamanan, aplikasi ini tidak bisa dibuka di dalam situs lain.</p>';
    return;
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
  // Minta browser tidak menghapus data saat ruang penyimpanan HP menipis
  navigator.storage?.persist?.().catch(() => {});

  try { Cloud = await import('./cloud.js'); } catch { Cloud = null; }
  if (!Cloud?.enabled() || localStorage.getItem(MODE_KEY) === 'lokal') return openStore(KEY);
  const res = await Cloud.init();
  if (res.user) return openAccount(res.user);
  if (!res.online) {
    // Tanpa internet: buka salinan akun terakhir di perangkat ini bila ada
    const last = localStorage.getItem(LAST_UID_KEY);
    if (last && localStorage.getItem(KEY + ':' + last)) { offlineAccount = true; return openStore(KEY + ':' + last); }
    return showAuth('Tidak bisa terhubung ke server. Periksa internet, atau pakai tanpa akun.');
  }
  showAuth();
}
boot();
