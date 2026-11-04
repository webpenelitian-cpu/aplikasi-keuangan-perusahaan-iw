'use strict';
/* Aplikasi Keuangan Perusahaan (UMKM)
   Data tersimpan di perangkat (opsional disinkron ke akun di server). Laporan disusun dengan basis akrual
   mengikuti SAK EMKM: Laporan Posisi Keuangan, Laba Rugi, dan Catatan atas Laporan Keuangan. */

const KEY = 'keuangan-perusahaan-v1';            // data mode tanpa akun; mode akun memakai KEY + ':' + uid
const LOCK_KEY = 'keuangan-perusahaan-lock';
const MODE_KEY = 'keuangan-mode';                 // 'lokal' bila pengguna memilih tanpa akun
const LAST_UID_KEY = 'keuangan-last-uid';
const DEVICE_KEY = 'keuangan-device-id';
const PBKDF2_ITER = 600000;
const MIN_PW = 8;
const TX_PAGE = 300;
const MONTHS = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const MONTHS_FULL = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const TYPE_LABEL = {in:'Pemasukan', out:'Pengeluaran', transfer:'Mutasi'};
// Penomoran bukti kas yang lazim: BKM penerimaan, BKK pengeluaran, BM mutasi antarrekening
const REF_PREFIX = {in:'BKM', out:'BKK', transfer:'BM'};
const LOGO_MAX_PX = 256;
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const APP_NAME = 'Aplikasi Keuangan Perusahaan (UMKM)';

// Akun sistem untuk jurnal otomatis (double entry)
const ACC_PIUTANG = {code: '1-201', name: 'Piutang usaha'};
const ACC_UTANG = {code: '2-101', name: 'Utang usaha'};
const ACC_OPENING = {code: '3-001', name: 'Ekuitas saldo awal'};

// PP 55/2022 Pasal 59: jangka waktu PPh final 0,5% per bentuk usaha (tahun pajak sejak terdaftar)
const ENTITY = {
  ptp: {label: 'PT Perorangan', years: 4, badan: true},
  pt:  {label: 'PT (persekutuan modal)', years: 3, badan: true},
  cv:  {label: 'CV / Firma / Koperasi', years: 4, badan: true},
  op:  {label: 'Usaha orang pribadi', years: 7, badan: false},
};
const OMZET_CAP = 4800000000; // batas peredaran bruto PPh final UMKM per tahun

// Identitas perusahaan diisi sendiri lewat menu Atur dan hanya tersimpan di perangkat/akun.
const PROFILE = {
  name: '', tagline: '', logo: '',
  address: '', npwp: '', nib: '', phone: '', email: '',
  preparedName: '', preparedTitle: 'Bagian Keuangan',
  checkedName: '', checkedTitle: 'Pimpinan',
  pphRate: 0.5, entity: 'ptp', taxYear: '', basis: 'akrual',
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rp = n => (n < 0 ? '−Rp ' : 'Rp ') + Math.abs(Math.round(n)).toLocaleString('id-ID');
const parseNum = s => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fmtDate = d => { if (!d) return 'Saldo awal'; const [y, m, dd] = d.split('-'); return `${dd} ${MONTHS[+m - 1]} ${y}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = id => document.getElementById(id);
const moneyInput = el => el.oninput = () => { const n = parseNum(el.value); el.value = n ? n.toLocaleString('id-ID') : ''; };
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
const inRange = (date, from, to) => (!from || date >= from) && (!to || date <= to);
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const lastDayOf = ym => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const addMonths = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; };
const displayName = () => state.company.name || APP_NAME;

// Angka ke kata (untuk bukti kas)
function terbilang(n) {
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  const f = x => x < 12 ? s[x] : x < 20 ? f(x - 10) + ' belas' : x < 100 ? f(Math.floor(x / 10)) + ' puluh ' + f(x % 10)
    : x < 200 ? 'seratus ' + f(x - 100) : x < 1000 ? f(Math.floor(x / 100)) + ' ratus ' + f(x % 100)
    : x < 2000 ? 'seribu ' + f(x - 1000) : x < 1e6 ? f(Math.floor(x / 1000)) + ' ribu ' + f(x % 1000)
    : x < 1e9 ? f(Math.floor(x / 1e6)) + ' juta ' + f(x % 1e6) : x < 1e12 ? f(Math.floor(x / 1e9)) + ' miliar ' + f(x % 1e9)
    : f(Math.floor(x / 1e12)) + ' triliun ' + f(x % 1e12);
  const r = (f(Math.floor(Math.abs(n))) || 'nol').replace(/\s+/g, ' ').trim() + ' rupiah';
  return r[0].toUpperCase() + r.slice(1);
}

// Logo unggahan, atau inisial nama perusahaan bila belum ada logo
function logoHTML(size) {
  const c = state.company;
  if (LOGO_RE.test(c.logo)) return `<img src="${c.logo}" width="${size}" height="${size}" alt="Logo" style="object-fit:contain;border-radius:10px;flex:0 0 auto">`;
  const words = c.name.replace(/^(PT|CV|UD|Koperasi|Yayasan)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  const initials = words.length ? words.slice(0, 2).map(w => w[0]).join('').toUpperCase() : 'Rp';
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true" style="flex:0 0 auto"><rect width="64" height="64" rx="14" fill="#14304a"/><text x="32" y="41" text-anchor="middle" font-family="Georgia,serif" font-size="25" font-weight="700" fill="#e5a100">${esc(initials)}</text></svg>`;
}

function defaultState() {
  const cat = (code, name, type, lr = true) => ({id: uid(), code, name, type, lr});
  return {
    version: 3,
    company: {...PROFILE},
    security: {autoLockMin: 5},
    lastBackup: '',
    lockedUntil: '',
    audit: [],
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
   Semua data dari penyimpanan, server, atau file backup dibersihkan dulu: id hanya huruf/angka, tanggal
   berformat baku, angka wajar, teks dibatasi panjangnya. Mencegah file palsu menyisipkan kode. */
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
    if (k === 'pphRate') company[k] = Number.isFinite(+co[k]) && +co[k] >= 0 && +co[k] <= 100 ? +co[k] : PROFILE.pphRate;
    else if (k === 'logo') company[k] = typeof co.logo === 'string' && co.logo.length < 400000 && LOGO_RE.test(co.logo) ? co.logo : '';
    else if (k === 'entity') company[k] = Object.hasOwn(ENTITY, co.entity) ? co.entity : PROFILE.entity;
    else if (k === 'basis') company[k] = co.basis === 'kas' ? 'kas' : 'akrual';
    else if (k === 'taxYear') company[k] = /^(19|20)\d{2}$/.test(String(co.taxYear ?? '')) ? String(co.taxYear) : '';
    else company[k] = cleanStr(co[k] ?? PROFILE[k], 300);
  }
  const autoLock = +d.security?.autoLockMin;
  return {
    version: cleanNum(d.version),
    company,
    security: {autoLockMin: [1, 5, 15, 30].includes(autoLock) ? autoLock : 5},
    lastBackup: cleanDate(d.lastBackup),
    lockedUntil: cleanDate(d.lockedUntil),
    audit: (Array.isArray(d.audit) ? d.audit : []).slice(-20000).map(a => ({
      ts: cleanStr(a?.ts, 30), by: cleanStr(a?.by, 40), act: cleanStr(a?.act, 20), ent: cleanStr(a?.ent, 20),
      id: cleanId(a?.id) || '', info: cleanStr(a?.info, 600)})).filter(a => a.ts && a.act),
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
  state.version = 3;
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
  return {enc: 1, app: 'keuangan-umkm', iter: v.iter, salt: toB64(v.salt), iv: toB64(iv), ct: toB64(ct)};
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
let currentView = 'dashboard';

/* ---------- Hasil hitung bersama (dihitung sekali per perubahan data) ---------- */
let memo = null;
function M() {
  if (memo) return memo;
  const paid = new Map(), bal = new Map();
  state.accounts.forEach(a => bal.set(a.id, a.opening));
  for (const t of state.tx) {
    if (t.debtId) paid.set(t.debtId, (paid.get(t.debtId) || 0) + t.amount);
    if (t.type === 'in') bal.set(t.accountId, (bal.get(t.accountId) || 0) + t.amount);
    else if (t.type === 'out') bal.set(t.accountId, (bal.get(t.accountId) || 0) - t.amount);
    else { bal.set(t.accountId, (bal.get(t.accountId) || 0) - t.amount); bal.set(t.toAccountId, (bal.get(t.toAccountId) || 0) + t.amount); }
  }
  memo = {paid, bal, _journal: null, get journal() { return this._journal ||= buildJournal(); }};
  return memo;
}

/* ---------- Jejak audit ----------
   Setiap penambahan, perubahan, dan penghapusan dicatat (waktu, pengguna, perangkat, ringkasan) dan ikut
   tersimpan/tersinkron bersama data. Catatan audit tidak bisa diubah atau dihapus dari aplikasi. */
const txSummary = t => `${t.ref || '-'} · ${t.date} · ${TYPE_LABEL[t.type]} · ${rp(t.amount)} · ${accName(t.accountId)}${t.type === 'transfer' ? ' → ' + accName(t.toAccountId) : ' · ' + catName(t.categoryId)}${t.desc ? ' · ' + t.desc : ''}`;
const debtSummary = d => `${d.kind} · ${d.ref || '-'} · ${d.party} · ${d.date} · ${rp(d.amount)} · ${catName(d.categoryId)}`;
function log(act, ent, id, info) {
  state.audit.push({ts: new Date().toISOString(), by: (cloudInfo?.username ? '@' + cloudInfo.username : 'perangkat') + '/' + deviceId.slice(0, 6),
    act, ent, id: id || '', info: String(info).slice(0, 600)});
}
const isLocked = date => !!state.lockedUntil && !!date && date <= state.lockedUntil;
const lockMsg = () => `Periode s.d. ${fmtDate(state.lockedUntil)} sudah ditutup (tutup buku). Data di periode itu tidak bisa diubah atau dihapus.`;
function askReason(what) {
  const r = prompt(`Alasan ${what} (wajib, tercatat di jejak audit):`);
  if (r === null) return null;
  if (r.trim().length < 5) { toast('Alasan minimal 5 karakter'); return null; }
  return r.trim().slice(0, 200);
}

/* ---------- Akun & sinkron server ---------- */
let Cloud = null;          // modul cloud.js bila konfigurasi Firebase terisi
let cloudUser = null, cloudInfo = null, offlineAccount = false;
let dirty = false, pushTimer = null, syncMsg = '', syncBase = null;
const deviceId = (() => {
  try { let id = localStorage.getItem(DEVICE_KEY); if (!id) { id = uid() + uid(); localStorage.setItem(DEVICE_KEY, id); } return id; }
  catch { return uid(); }
})();
const metaKey = () => storeKey + '-meta';
function readMeta() { try { return JSON.parse(localStorage.getItem(metaKey())) || {updatedAt: 0}; } catch { return {updatedAt: 0}; } }
const writeMeta = updatedAt => localStorage.setItem(metaKey(), JSON.stringify({updatedAt}));
const conflictKeys = () => Object.keys(localStorage).filter(k => k.startsWith(storeKey + '-konflik-')).sort();

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
    const updatedAt = readMeta().updatedAt;
    await Cloud.push(localStorage.getItem(storeKey) || '', updatedAt, deviceId, syncBase);
    syncBase = updatedAt;
    setSync('Tersimpan di server · ' + new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'}));
  } catch (e) {
    if (e?.code === 'conflict') return resolveConflict();
    dirty = true;
    setSync('Gagal menyimpan ke server — dicoba lagi otomatis.');
    pushTimer = setTimeout(pushNow, 15000);
  }
}
addEventListener('online', () => { if (dirty) pushNow(); });

// Server punya versi lebih baru dari perangkat lain: data perangkat ini diamankan sebagai salinan, lalu versi server dipakai.
async function resolveConflict() {
  try { localStorage.setItem(`${storeKey}-konflik-${Date.now()}`, localStorage.getItem(storeKey) || ''); } catch {}
  dirty = false;
  await applyRemote(null, true);
  toast('Data diubah di perangkat lain. Versi server dipakai; perubahan Anda disimpan sebagai salinan (Atur → Akun).');
}

// Perubahan dari perangkat lain (data yang lebih baru di server)
async function applyRemote(meta, force = false) {
  if (!force && (!state || dirty || meta.deviceId === deviceId || !(meta.updatedAt > readMeta().updatedAt))) return;
  let r; try { r = await Cloud.pull(); } catch { return; }
  if (!r || (!force && dirty)) return;
  localStorage.setItem(storeKey, r.payload); writeMeta(r.updatedAt); syncBase = r.updatedAt;
  let d; try { d = JSON.parse(r.payload); } catch { return; }
  if (isEnvelope(d)) {
    if (!vault) return location.reload();
    try { d = await unseal(vault.key, d); } catch { return location.reload(); } // kata sandi diganti di perangkat lain
  } else vault = null;
  try { state = sanitizeState(d); } catch { return; }
  migrate();
  document.querySelectorAll('dialog[open]').forEach(x => x.close());
  renderAll(); setSync('Tersinkron dengan perangkat lain'); if (!force) toast('Data diperbarui dari perangkat lain');
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
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200);
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
  log('ubah', 'keamanan', '', 'Kata sandi enkripsi dipasang/diganti');
  await persist(); renderSecurity(); resetIdle();
  toast('Kata sandi terpasang — data kini terenkripsi');
};
$('btnRemovePw').onclick = async () => {
  if (!vault || !await verifyCurrent()) return;
  if (!confirm('Hapus kata sandi? Data akan disimpan TANPA enkripsi dan aplikasi tidak lagi terkunci.')) return;
  vault = null; clearTimeout(idleTimer);
  log('ubah', 'keamanan', '', 'Kata sandi enkripsi dihapus');
  await persist(); renderSecurity(); toast('Kata sandi dihapus');
};
$('btnLockNow').onclick = lockNow;
$('secAuto').onchange = () => { state.security.autoLockMin = +$('secAuto').value; persist(); resetIdle(); };

/* ---------- Data dasar ---------- */
const accName = id => state.accounts.find(a => a.id === id)?.name || '(akun dihapus)';
const catOf = id => state.categories.find(c => c.id === id);
const catName = id => catOf(id)?.name || '—';
const catLabel = id => { const c = catOf(id); return c ? (c.code ? `<span class="code">${esc(c.code)}</span>` : '') + esc(c.name) : '—'; };
const accLabel = a => (a.code ? `<span class="code">${esc(a.code)}</span>` : '') + esc(a.name);
// Transaksi yang dihitung sebagai pendapatan/beban di Laba Rugi
const inLR = t => t.type !== 'transfer' && catOf(t.categoryId)?.lr !== false;
const statCard = ([l, v, c, sub]) => `<div class="card stat"><div class="label">${l}</div><div class="value ${c}">${v}</div>${sub ? `<div class="muted" style="font-size:12px;margin-top:4px">${sub}</div>` : ''}</div>`;

function nextRef(type, date) {
  const p = `${REF_PREFIX[type]}-${date.slice(2, 4)}${date.slice(5, 7)}-`;
  let max = 0;
  for (const t of state.tx) if ((t.ref || '').startsWith(p)) max = Math.max(max, parseInt(t.ref.slice(p.length)) || 0);
  return p + String(max + 1).padStart(3, '0');
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
  if (!upTo) return M().bal.get(accId) || 0;
  const a = state.accounts.find(x => x.id === accId);
  let b = a ? a.opening : 0;
  for (const t of state.tx) if (t.date <= upTo) b += effect(t, accId);
  return b;
}
const totalBalance = upTo => state.accounts.reduce((s, a) => s + balance(a.id, upTo), 0);
const sorted = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

/* ---------- Jurnal umum otomatis (double entry) ----------
   Setiap transaksi kas, faktur piutang/utang, dan pelunasannya diubah menjadi jurnal debit/kredit.
   Dari jurnal ini disusun Neraca Saldo, Laporan Posisi Keuangan, dan Laba Rugi akrual. */
function catAcc(id) {
  const c = catOf(id);
  if (!c) return {code: '3-999', name: 'Kategori terhapus (belum diklasifikasi)'};
  const g = c.code?.[0];
  // Tanda L/R menentukan apakah kategori masuk laba rugi; kode akun menentukan kelompok neraca
  if (c.lr !== false) return {code: g === '4' || g === '5' ? c.code : (c.type === 'in' ? '4-999' : '5-999'), name: c.name};
  return {code: g === '1' || g === '2' || g === '3' ? c.code : '3-999', name: c.name};
}
function cashAcc(id) {
  const a = state.accounts.find(x => x.id === id);
  return {code: a?.code || '1-199', name: a?.name || 'Akun kas dihapus'};
}
function buildJournal() {
  const E = [];
  const add = (date, ref, desc, dr, cr, amt, src) => { if (amt > 0) E.push({date, ref, desc, dr, cr, amt, src}); };
  state.accounts.forEach(a => {
    if (a.opening > 0) add('', 'SA', 'Saldo awal ' + a.name, cashAcc(a.id), ACC_OPENING, a.opening, 'saldo');
    if (a.opening < 0) add('', 'SA', 'Saldo awal ' + a.name, ACC_OPENING, cashAcc(a.id), -a.opening, 'saldo');
  });
  const debtById = new Map(state.debts.map(d => [d.id, d]));
  state.debts.forEach(d => {
    const c = catAcc(d.categoryId), desc = `${d.kind === 'piutang' ? 'Faktur kepada' : 'Tagihan dari'} ${d.party}${d.desc ? ' · ' + d.desc : ''}`;
    if (d.kind === 'piutang') add(d.date, d.ref, desc, ACC_PIUTANG, c, d.amount, 'faktur');
    else add(d.date, d.ref, desc, c, ACC_UTANG, d.amount, 'faktur');
  });
  state.tx.forEach(t => {
    const acc = cashAcc(t.accountId), desc = t.desc || (t.type === 'transfer' ? 'Mutasi antarakun' : catName(t.categoryId));
    if (t.type === 'transfer') return add(t.date, t.ref, desc, cashAcc(t.toAccountId), acc, t.amount, 'mutasi');
    const debt = t.debtId && debtById.get(t.debtId);
    if (debt) return debt.kind === 'piutang' ? add(t.date, t.ref, desc, acc, ACC_PIUTANG, t.amount, 'pelunasan')
                                              : add(t.date, t.ref, desc, ACC_UTANG, acc, t.amount, 'pelunasan');
    const c = catAcc(t.categoryId);
    if (t.type === 'in') add(t.date, t.ref, desc, acc, c, t.amount, 'kas');
    else add(t.date, t.ref, desc, c, acc, t.amount, 'kas');
  });
  return E.sort((a, b) => a.date.localeCompare(b.date) || String(a.ref).localeCompare(String(b.ref)));
}
const accKey = a => a.code + '|' + a.name;
const accHTML = a => `<span class="code">${esc(a.code)}</span>${esc(a.name)}`;

// Laba rugi periode: akrual (dari jurnal) atau kas (dari transaksi), sesuai pengaturan
function lrData(from, to) {
  const ins = new Map(), outs = new Map();
  const put = (m, key, label, v) => { const r = m.get(key) || {label, v: 0}; r.v += v; m.set(key, r); };
  if (state.company.basis === 'kas') {
    for (const t of state.tx) if (inRange(t.date, from, to) && inLR(t))
      put(t.type === 'in' ? ins : outs, t.categoryId, catLabel(t.categoryId), t.amount);
  } else {
    for (const e of M().journal) {
      if (!e.date || !inRange(e.date, from, to)) continue;
      for (const [acc, dr] of [[e.dr, true], [e.cr, false]]) {
        const g = acc.code[0];
        if (g === '4') put(ins, accKey(acc), accHTML(acc), dr ? -e.amt : e.amt);
        else if (g === '5') put(outs, accKey(acc), accHTML(acc), dr ? e.amt : -e.amt);
      }
    }
  }
  const list = m => [...m.values()].filter(r => r.v).sort((a, b) => a.label.localeCompare(b.label));
  const I = list(ins), O = list(outs);
  const ti = I.reduce((s, r) => s + r.v, 0), to_ = O.reduce((s, r) => s + r.v, 0);
  return {ins: I, outs: O, ti, to: to_, net: ti - to_};
}

// Laporan posisi keuangan per tanggal
function neracaData(to) {
  const asOf = to || today(), yStart = asOf.slice(0, 4) + '-01-01';
  const G = {1: new Map(), 2: new Map(), 3: new Map()};
  let cur = 0, prev = 0;
  for (const e of M().journal) {
    if (e.date && e.date > asOf) continue;
    for (const [acc, dr] of [[e.dr, true], [e.cr, false]]) {
      const g = acc.code[0], s = dr ? e.amt : -e.amt; // positif = debit
      if (g === '1' || g === '2' || g === '3') {
        const m = G[g], r = m.get(acc.code) || {label: accHTML(acc), v: 0};
        r.v += g === '1' ? s : -s; m.set(acc.code, r);
      } else if (e.date && e.date >= yStart) cur -= s; else prev -= s;
    }
  }
  const list = m => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, r]) => r).filter(r => r.v);
  const aset = list(G[1]), liab = list(G[2]), eq = list(G[3]);
  const sum = l => l.reduce((s, r) => s + r.v, 0);
  const ta = sum(aset), tl = sum(liab), te_ = sum(eq) + prev + cur;
  return {asOf, aset, liab, eq, prev, cur, ta, tl, te: te_, diff: ta - tl - te_};
}

/* ---------- Navigasi (hanya halaman yang tampil yang dirender) ---------- */
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  currentView = b.dataset.view;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + currentView));
  renderView(currentView);
  window.scrollTo(0, 0);
});
const goView = v => document.querySelector(`nav button[data-view="${v}"]`).click();

/* ---------- Pengingat kewajiban (pajak & hukum) ---------- */
function pphEligibility() {
  const c = state.company, ent = ENTITY[c.entity] || ENTITY.ptp;
  if (!c.taxYear) return {ent, last: null};
  return {ent, last: +c.taxYear + ent.years - 1};
}
function obligations() {
  const out = [], now = today(), y = +now.slice(0, 4), ym = now.slice(0, 7), prevYm = addMonths(ym, -1);
  const c = state.company, {ent, last} = pphEligibility();
  const finalActive = !last || y <= last;
  if (finalActive && c.pphRate > 0) {
    const bruto = lrData(prevYm + '-01', lastDayOf(prevYm)).ti, pph = Math.floor(bruto * c.pphRate / 100);
    const paid = pphPaidFor(prevYm);
    if (pph > 0) out.push(paid >= pph
      ? ['ok', `PPh final masa ${MONTHS_FULL[+prevYm.slice(5) - 1]} ${prevYm.slice(0, 4)} sudah disetor (${rp(paid)}).`]
      : [now > ym + '-15' ? 'bad' : 'warn', `Setor PPh final masa ${MONTHS_FULL[+prevYm.slice(5) - 1]} ${prevYm.slice(0, 4)}: <b>${rp(pph - paid)}</b>, jatuh tempo 15 ${MONTHS_FULL[+ym.slice(5) - 1]} ${y}.`]);
  }
  if (+now.slice(5, 7) <= (ent.badan ? 4 : 3))
    out.push(['warn', `SPT Tahunan PPh ${ent.badan ? 'Badan' : 'Orang Pribadi'} tahun ${y - 1}: batas lapor ${ent.badan ? '30 April' : '31 Maret'} ${y}. Gunakan laporan <i>Laporan Keuangan Tahunan</i> ${y - 1} sebagai lampiran.`]);
  if (c.entity === 'ptp' && +now.slice(5, 7) <= 6)
    out.push(['warn', `Laporan keuangan PT Perorangan tahun ${y - 1} wajib disampaikan ke Menteri Hukum (AHU Online) paling lambat 30 Juni ${y} (PP 8/2021).`]);
  if (last && y > last) out.push(['bad', `Masa PPh final 0,5% berakhir di tahun pajak ${last} (${ent.label}: ${ent.years} tahun, PP 55/2022). Sejak ${last + 1} gunakan tarif PPh umum; ubah tarif di menu Atur.`]);
  else if (last && y === last) out.push(['warn', `Tahun ${y} adalah tahun terakhir PPh final 0,5% untuk ${ent.label} (PP 55/2022).`]);
  if (!c.taxYear) out.push(['warn', 'Isi <b>tahun mulai PPh final</b> di menu Atur agar batas masa berlaku PP 55/2022 bisa dipantau.']);
  const omzet = lrData(y + '-01-01', y + '-12-31').ti;
  if (omzet > OMZET_CAP) out.push(['bad', `Peredaran bruto ${y} (${rp(omzet)}) melewati Rp4,8 miliar: tahun pajak berikutnya tidak lagi memakai PPh final 0,5%.`]);
  else if (omzet > OMZET_CAP * 0.8) out.push(['warn', `Peredaran bruto ${y} sudah ${rp(omzet)} (mendekati batas Rp4,8 miliar PPh final).`]);
  const suggestedLock = lastDayOf(addMonths(ym, -2));
  if (state.tx.length && (!state.lockedUntil || state.lockedUntil < suggestedLock))
    out.push(['warn', `Belum tutup buku s.d. ${fmtDate(suggestedLock)}. Tutup buku mencegah data periode lalu berubah setelah dilaporkan. <button class="btn sm" data-act="goLock">Tutup buku</button>`]);
  return out;
}

/* ---------- Dasbor ---------- */
function renderDashboard() {
  const notices = [];
  if (!state.company.name) notices.push('<div class="notice">Lengkapi nama, slogan, dan logo perusahaan untuk kop laporan. <button class="btn sm" data-act="goProfile">Isi profil</button></div>');
  if (hasCrypto && !vault) notices.push('<div class="notice">Data belum dilindungi kata sandi. <button class="btn sm" data-act="goSecurity">Pasang sekarang</button></div>');
  if (state.tx.length && (!state.lastBackup || daysBetween(state.lastBackup, today()) > 7))
    notices.push(`<div class="notice">${state.lastBackup ? 'Backup terakhir ' + fmtDate(state.lastBackup) + '.' : 'Data belum pernah di-backup.'} <button class="btn sm" data-act="backup">Backup sekarang</button></div>`);
  if (cloudUser && conflictKeys().length) notices.push(`<div class="notice">Ada ${conflictKeys().length} salinan data dari konflik sinkron. Periksa di Atur → Akun.</div>`);
  $('dashNotices').innerHTML = notices.join('');

  const years = new Set([new Date().getFullYear(), ...state.tx.map(t => +t.date.slice(0, 4)), ...state.debts.map(d => +d.date.slice(0, 4))]);
  const ySel = $('dashYear'), cur = ySel.value || new Date().getFullYear();
  ySel.innerHTML = [...years].sort((a, b) => b - a).map(y => `<option ${y == cur ? 'selected' : ''}>${y}</option>`).join('');
  const year = ySel.value;
  const ym = today().slice(0, 7);

  const yearTx = state.tx.filter(t => t.date.startsWith(year));
  const sum = (list, type) => list.reduce((s, t) => t.type === type ? s + t.amount : s, 0);
  const monthTx = state.tx.filter(t => t.date.startsWith(ym));
  const lr = lrData(year + '-01-01', year + '-12-31');
  const margin = lr.ti ? Math.round(lr.net / lr.ti * 1000) / 10 : 0;
  const p = debtTotals('piutang'), u = debtTotals('utang');
  const mIn = sum(monthTx, 'in'), mOut = sum(monthTx, 'out');

  $('statCards').innerHTML = [
    ['Total Kas & Bank', rp(totalBalance()), ''],
    [`Arus kas bersih ${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`, rp(mIn - mOut), mIn - mOut >= 0 ? 'in' : 'out', `Masuk ${rp(mIn)} · keluar ${rp(mOut)}`],
    [`Pendapatan ${esc(year)}`, rp(lr.ti), 'in', state.company.basis === 'kas' ? 'basis kas' : 'basis akrual (SAK EMKM)'],
    [`Laba/Rugi ${esc(year)}`, rp(lr.net), lr.net >= 0 ? 'in' : 'out', lr.ti ? `Margin laba ${String(margin).replace('.', ',')}%` : ''],
    ['Piutang Belum Tertagih', rp(p.open), '', p.no ? `<span class="out">${p.no} lewat jatuh tempo (${rp(p.overdue)})</span>` : `${p.n} tagihan`],
    ['Utang Belum Dibayar', rp(u.open), '', u.no ? `<span class="out">${u.no} lewat jatuh tempo (${rp(u.overdue)})</span>` : `${u.n} tagihan`],
  ].map(statCard).join('');

  const ob = obligations();
  $('obligations').innerHTML = ob.length
    ? ob.map(([lvl, html]) => `<div class="ob ${lvl}"><span class="dot"></span><div>${html}</div></div>`).join('')
    : '<div class="muted">Tidak ada kewajiban yang perlu ditindaklanjuti saat ini.</div>';

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

  const cats = lr.outs.slice().sort((a, b) => b.v - a.v).slice(0, 6);
  $('topCats').innerHTML = cats.length ? cats.map(r => `
    <div class="cat-row"><span>${r.label}</span><span>${rp(r.v)}</span></div>
    <div class="meter"><span style="width:${Math.max(0, r.v / cats[0].v * 100)}%"></span></div>`).join('')
    : `<div class="empty">Belum ada beban di ${esc(year)}</div>`;

  const recent = sorted(state.tx).slice(0, 8);
  $('recentTx').innerHTML = recent.length ? `<table><tbody>${recent.map(t => `
    <tr><td style="white-space:nowrap">${fmtDate(t.date)}</td><td>${esc(t.desc || (t.type === 'transfer' ? 'Mutasi antarakun' : catName(t.categoryId)))}</td>
    <td class="num ${t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : ''}">${t.type === 'out' ? '−' : ''}${rp(t.amount)}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">Belum ada transaksi. Ketuk <b>+ Transaksi</b> untuk mulai mencatat.</div>`;

  $('accBalances').innerHTML = `<table><tbody>${state.accounts.map(a => `
    <tr><td>${accLabel(a)}</td><td class="num">${rp(balance(a.id))}</td></tr>`).join('')}
    <tr><td><b>Total</b></td><td class="num"><b>${rp(totalBalance())}</b></td></tr></tbody></table>`;
}
$('dashYear').onchange = renderDashboard;

/* ---------- Transaksi ---------- */
let txLimit = TX_PAGE;
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
    inRange(t.date, from, to) && (!type || t.type === type) &&
    (!acc || t.accountId === acc || t.toAccountId === acc) && (!cat || t.categoryId === cat) &&
    (!q || (t.desc + ' ' + (t.ref || '')).toLowerCase().includes(q)));
}
function renderTx() {
  fillSelect($('fAcc'), state.accounts, 'Semua akun');
  fillSelect($('fCat'), state.categories, 'Semua kategori');
  const list = filteredTx();
  let tin = 0, tout = 0;
  for (const t of list) { if (t.type === 'in') tin += t.amount; else if (t.type === 'out') tout += t.amount; }
  $('filterSummary').innerHTML = [
    ['Jumlah transaksi', list.length.toLocaleString('id-ID'), ''],
    ['Total pemasukan', rp(tin), 'in'], ['Total pengeluaran', rp(tout), 'out'], ['Selisih', rp(tin - tout), tin - tout >= 0 ? 'in' : 'out'],
  ].map(statCard).join('');

  const shown = list.slice(0, txLimit);
  $('txBody').innerHTML = shown.length ? shown.map(t => `
    <tr>
      <td data-label="Tanggal">${fmtDate(t.date)}${isLocked(t.date) ? ' <span class="badge" title="Periode ditutup">🔒</span>' : ''}</td><td data-label="No. bukti">${esc(t.ref)}</td>
      <td data-label="Jenis"><span class="badge ${t.type === 'transfer' ? 'tr' : t.type}">${TYPE_LABEL[t.type]}</span></td>
      <td data-label="Kategori">${t.type === 'transfer' ? '—' : catLabel(t.categoryId)}</td>
      <td data-label="Akun">${esc(accName(t.accountId))}${t.type === 'transfer' ? ' → ' + esc(accName(t.toAccountId)) : ''}</td>
      <td data-label="Uraian">${esc(t.desc)}</td>
      <td data-label="Jumlah" class="num ${t.type === 'in' ? 'in' : t.type === 'out' ? 'out' : ''}"><b>${t.type === 'out' ? '−' : ''}${rp(t.amount)}</b></td>
      <td data-label="" class="no-print num"><button class="btn sm" data-act="openTx" data-id="${esc(t.id)}">${isLocked(t.date) ? 'Lihat' : 'Ubah'}</button></td>
    </tr>`).join('') + (list.length > shown.length
      ? `<tr><td colspan="8" data-label="" style="text-align:center"><button class="btn" data-act="moreTx">Tampilkan ${Math.min(TX_PAGE, list.length - shown.length)} berikutnya (${list.length - shown.length} lagi)</button></td></tr>` : '')
    : `<tr><td colspan="8" class="empty" data-label="">Tidak ada transaksi yang cocok.</td></tr>`;
}
const rerenderTx = debounce(() => { txLimit = TX_PAGE; renderTx(); });
['fFrom', 'fTo', 'fType', 'fAcc', 'fCat'].forEach(id => $(id).oninput = () => { txLimit = TX_PAGE; renderTx(); });
$('fSearch').oninput = rerenderTx;
$('btnResetFilter').onclick = () => { ['fFrom', 'fTo', 'fType', 'fAcc', 'fCat', 'fSearch'].forEach(id => $(id).value = ''); txLimit = TX_PAGE; renderTx(); };

// Teks yang diawali = + - @ diberi tanda kutip agar tidak dijalankan sebagai rumus oleh Excel
const csvCell = v => {
  let s = String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');
$('btnCsv').onclick = () => {
  const rows = [['Tanggal', 'No. Bukti', 'Jenis', 'Kode Akun', 'Kategori', 'Akun', 'Ke Akun', 'Uraian', 'Jumlah']];
  filteredTx().forEach(t => rows.push([t.date, t.ref || '', TYPE_LABEL[t.type], t.type === 'transfer' ? '' : catOf(t.categoryId)?.code || '',
    t.type === 'transfer' ? '' : catName(t.categoryId), accName(t.accountId), t.type === 'transfer' ? accName(t.toAccountId) : '',
    t.desc || '', t.type === 'out' ? -t.amount : t.amount]));
  download(toCsv(rows), `transaksi-${today()}.csv`, 'text/csv');
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
  showPriveHint();
}
// No. bukti otomatis selama pengguna belum mengetik sendiri
function refreshAutoRef() {
  if ($('txRef').dataset.auto === '1' && $('txDate').value) $('txRef').value = nextRef(txType, $('txDate').value);
}
// Pengingat pemisahan harta perusahaan & pribadi
function showPriveHint() {
  const c = catOf($('txCat').value);
  $('txHint').textContent = txType === 'out' && /prive|penarikan pemilik/i.test(c?.name || '')
    ? 'Prive adalah penarikan uang perusahaan untuk keperluan pribadi pemilik. Harta perusahaan dan pribadi wajib dipisahkan; catat setiap penarikan dengan uraian yang jelas.' : '';
}
document.querySelectorAll('#txTypeSeg button').forEach(b => b.onclick = () => setTxType(b.dataset.t));
$('txDate').onchange = refreshAutoRef;
$('txCat').onchange = showPriveHint;
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
  if (t.categoryId) { fillSelect($('txCat'), state.categories.filter(c => c.type === t.type)); $('txCat').value = t.categoryId; }
  setTxType(t.type);
  if (t.categoryId) $('txCat').value = t.categoryId;
  const debt = editing?.debtId && state.debts.find(d => d.id === editing.debtId);
  const locked = editing && isLocked(editing.date);
  $('txLink').style.display = debt || locked ? '' : 'none';
  $('txLink').textContent = [locked ? lockMsg() : '', debt ? `Pembayaran ${KIND_LABEL[debt.kind].toLowerCase()} — ${debt.party}${debt.ref ? ' · ' + debt.ref : ''}` : ''].filter(Boolean).join(' ');
  document.querySelectorAll('#txTypeSeg button').forEach(b => b.disabled = !!debt || locked);
  $('txDialogTitle').textContent = editing ? (locked ? 'Detail Transaksi' : 'Ubah Transaksi') : 'Transaksi Baru';
  $('txAmount').value = t.amount ? t.amount.toLocaleString('id-ID') : '';
  $('txDesc').value = t.desc || '';
  if (t.accountId) $('txAcc').value = t.accountId;
  if (t.toAccountId) $('txTo').value = t.toAccountId;
  else if (state.accounts[1]) $('txTo').value = state.accounts[1].id;
  $('txForm').querySelectorAll('input, select, textarea').forEach(x => x.disabled = locked);
  $('btnSaveTx').style.display = locked ? 'none' : '';
  $('btnDeleteTx').style.display = editing && !locked ? '' : 'none';
  $('btnPrintTx').style.display = editing ? '' : 'none';
  showPriveHint();
  $('txDialog').showModal();
}
$('btnAdd').onclick = () => openTx();
$('btnCancelTx').onclick = () => $('txDialog').close();
$('btnPrintTx').onclick = () => { if (editing) printVoucher(editing); };
$('btnDeleteTx').onclick = () => {
  if (!editing || isLocked(editing.date)) return toast(lockMsg());
  const reason = askReason('menghapus transaksi'); if (!reason) return;
  log('hapus', 'transaksi', editing.id, `${txSummary(editing)} · alasan: ${reason}`);
  state.tx = state.tx.filter(t => t !== editing);
  $('txDialog').close(); save(); toast('Transaksi dihapus (tercatat di jejak audit)');
};
$('txForm').onsubmit = e => {
  const amount = parseNum($('txAmount').value), date = $('txDate').value;
  const fail = msg => { e.preventDefault(); toast(msg); };
  if (editing && isLocked(editing.date)) return fail(lockMsg());
  if (!DATE_RE.test(date)) return fail('Isi tanggal transaksi');
  if (isLocked(date)) return fail(lockMsg());
  if (amount <= 0) return fail('Jumlah harus lebih dari 0');
  if (!state.accounts.length) return fail('Tambahkan akun dulu di menu Atur');
  if (txType === 'transfer' && $('txAcc').value === $('txTo').value) return fail('Akun asal dan tujuan harus berbeda');
  if (txType !== 'transfer' && !$('txCat').value) return fail('Pilih kategori');
  const ref = $('txRef').value.trim().slice(0, 40);
  if (!ref) return fail('No. bukti wajib diisi (dasar penelusuran audit)');
  if (state.tx.some(t => t !== editing && t.ref === ref)) return fail(`No. bukti ${ref} sudah dipakai transaksi lain`);
  const debt = editing?.debtId && state.debts.find(d => d.id === editing.debtId);
  if (debt && amount > remainOf(debt) + editing.amount) return fail('Jumlah melebihi sisa ' + rp(remainOf(debt) + editing.amount));
  const data = {
    type: txType, date, ref, amount,
    accountId: $('txAcc').value, desc: $('txDesc').value.trim().slice(0, 500),
    categoryId: txType === 'transfer' ? null : $('txCat').value,
    toAccountId: txType === 'transfer' ? $('txTo').value : null,
  };
  if (editing) {
    const before = txSummary(editing);
    Object.assign(editing, data);
    log('ubah', 'transaksi', editing.id, `${before} ⇒ ${txSummary(editing)}`);
  } else {
    const t = {id: uid(), created: Date.now(), ...data};
    state.tx.push(t);
    log('tambah', 'transaksi', t.id, txSummary(t));
  }
  save(); toast(editing ? 'Transaksi diperbarui' : 'Transaksi tersimpan · ' + data.ref);
};

/* ---------- Bukti kas (cetak) ---------- */
function printVoucher(t) {
  const title = t.type === 'in' ? 'BUKTI KAS MASUK' : t.type === 'out' ? 'BUKTI KAS KELUAR' : 'BUKTI MUTASI KAS/BANK';
  const party = t.type === 'in' ? 'Diterima dari' : t.type === 'out' ? 'Dibayarkan kepada' : 'Mutasi';
  const debt = t.debtId && state.debts.find(d => d.id === t.debtId);
  const c = state.company, blank = '(..........................)';
  $('printArea').innerHTML = `<div class="report">${kop(title, 'No. ' + esc(t.ref || '-'))}
    <table class="voucher">
      <tr><td>Tanggal</td><td>${fmtDate(t.date)}</td></tr>
      <tr><td>${party}</td><td>${esc(debt ? debt.party : t.type === 'transfer' ? accName(t.accountId) + ' → ' + accName(t.toAccountId) : '')}&nbsp;</td></tr>
      <tr><td>Uraian</td><td>${esc(t.desc || catName(t.categoryId))}</td></tr>
      <tr><td>Akun kas/bank</td><td>${esc(accName(t.accountId))}</td></tr>
      ${t.type !== 'transfer' ? `<tr><td>Kode akun lawan</td><td>${debt ? (debt.kind === 'piutang' ? '1-201 Piutang usaha' : '2-101 Utang usaha') : catLabel(t.categoryId)}</td></tr>` : ''}
      <tr><td>Jumlah</td><td><b style="font-size:16px">${rp(t.amount)}</b></td></tr>
      <tr><td>Terbilang</td><td><i>${esc(terbilang(t.amount))}</i></td></tr>
    </table>
    <div class="sign three">
      <div>Dibuat oleh<div class="sp"></div><b>${c.preparedName ? esc(c.preparedName) : blank}</b></div>
      <div>Disetujui oleh<div class="sp"></div><b>${c.checkedName ? esc(c.checkedName) : blank}</b></div>
      <div>${t.type === 'in' ? 'Penyetor' : 'Penerima'}<div class="sp"></div><b>${blank}</b></div>
    </div>
    <p class="muted" style="font-size:11px">Dicetak ${new Date().toLocaleString('id-ID')} · lampirkan dokumen pendukung (faktur/kuitansi/bukti transfer) dan simpan minimal 10 tahun (UU KUP Pasal 28).</p></div>`;
  document.body.classList.add('print-voucher');
  window.print();
}
addEventListener('afterprint', () => document.body.classList.remove('print-voucher'));

/* ---------- Piutang & Utang ---------- */
// Faktur piutang/utang diakui saat terjadi (akrual); pelunasannya = transaksi kas yang membawa debtId.
const KIND_LABEL = {piutang: 'Piutang', utang: 'Utang'};
const debtTx = (d, upTo) => state.tx.filter(t => t.debtId === d.id && (!upTo || t.date <= upTo));
const paidOf = (d, upTo) => upTo ? debtTx(d, upTo).reduce((s, t) => s + t.amount, 0) : (M().paid.get(d.id) || 0);
const remainOf = (d, upTo) => d.amount - paidOf(d, upTo);
function debtStatus(d) {
  if (remainOf(d) <= 0) return {key: 'paid', label: 'Lunas', cls: 'in'};
  if (d.due && d.due < today()) return {key: 'overdue', label: `Telat ${daysBetween(d.due, today())} hari`, cls: 'out'};
  return {key: 'open', label: paidOf(d) > 0 ? 'Dibayar sebagian' : 'Belum dibayar', cls: 'warn'};
}
function debtTotals(kind) {
  let open = 0, overdue = 0, n = 0, no = 0;
  const now = today();
  for (const d of state.debts) {
    if (d.kind !== kind) continue;
    const r = remainOf(d);
    if (r <= 0) continue;
    open += r; n++;
    if (d.due && d.due < now) { overdue += r; no++; }
  }
  return {open, overdue, n, no};
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
['dKind', 'dStatus'].forEach(id => $(id).oninput = renderDebts);
$('dSearch').oninput = debounce(renderDebts);

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
  const locked = editingDebt && isLocked(editingDebt.date);
  // Jenis tidak boleh diganti setelah ada pembayaran (arah transaksinya sudah tercatat)
  document.querySelectorAll('#debtKindSeg button').forEach(b => b.disabled = pays.length > 0 || locked);
  $('debtTitle').textContent = editingDebt ? 'Detail ' + KIND_LABEL[d.kind] : 'Piutang / Utang Baru';
  $('dParty').value = d.party || '';
  $('dRef').value = d.ref || '';
  $('dDate').value = d.date;
  $('dDue').value = d.due || '';
  $('dAmount').value = d.amount ? d.amount.toLocaleString('id-ID') : '';
  $('dDesc').value = d.desc || '';
  if (d.categoryId) $('dCat').value = d.categoryId;
  $('debtForm').querySelectorAll('.form-grid input, .form-grid select, .form-grid textarea').forEach(x => x.disabled = locked);
  $('partyList').innerHTML = [...new Set(state.debts.map(x => x.party))].map(p => `<option value="${esc(p)}">`).join('');
  $('debtPayments').innerHTML = (locked ? `<div class="notice">${esc(lockMsg())}</div>` : '') + (!editingDebt ? '' : `<h3 style="font-size:13px;margin:0 0 6px">Riwayat pembayaran</h3>` + (pays.length
    ? `<table><tbody>${pays.map(t => `<tr><td>${fmtDate(t.date)}</td><td>${esc(t.ref)}</td><td class="num">${rp(t.amount)}</td>
        <td class="num"><button type="button" class="btn sm" data-act="editPayment" data-id="${esc(t.id)}">Buka</button></td></tr>`).join('')}
        <tr><td colspan="2"><b>Sisa</b></td><td class="num"><b>${rp(Math.max(0, remainOf(editingDebt)))}</b></td><td></td></tr></tbody></table>`
    : '<div class="muted">Belum ada pembayaran.</div>'));
  $('btnSaveDebt').style.display = locked ? 'none' : '';
  $('btnDeleteDebt').style.display = editingDebt && !locked ? '' : 'none';
  $('debtDialog').showModal();
}
$('btnAddDebt').onclick = () => openDebt();
$('btnCancelDebt').onclick = () => $('debtDialog').close();
$('debtForm').onsubmit = e => {
  const amount = parseNum($('dAmount').value), party = $('dParty').value.trim().slice(0, 120), date = $('dDate').value;
  const fail = msg => { e.preventDefault(); toast(msg); };
  if (editingDebt && isLocked(editingDebt.date)) return fail(lockMsg());
  if (!party) return fail('Isi nama pihak');
  if (!DATE_RE.test(date)) return fail('Isi tanggal faktur');
  if (isLocked(date)) return fail(lockMsg());
  if (amount <= 0) return fail('Nilai harus lebih dari 0');
  if (!$('dCat').value) return fail('Pilih kategori');
  if ($('dDue').value && $('dDue').value < date) return fail('Jatuh tempo tidak boleh sebelum tanggal');
  if (editingDebt && amount < paidOf(editingDebt)) return fail('Nilai lebih kecil dari yang sudah dibayar (' + rp(paidOf(editingDebt)) + ')');
  const data = {kind: debtKind, party, ref: $('dRef').value.trim().slice(0, 40), date, due: $('dDue').value,
    amount, categoryId: $('dCat').value, desc: $('dDesc').value.trim().slice(0, 500)};
  if (editingDebt) {
    const before = debtSummary(editingDebt);
    Object.assign(editingDebt, data);
    debtTx(editingDebt).forEach(t => t.categoryId = data.categoryId);
    log('ubah', debtKind, editingDebt.id, `${before} ⇒ ${debtSummary(editingDebt)}`);
  } else {
    const d = {id: uid(), created: Date.now(), ...data};
    state.debts.push(d);
    log('tambah', debtKind, d.id, debtSummary(d));
  }
  save(); toast('Data tersimpan');
};
$('btnDeleteDebt').onclick = () => {
  if (!editingDebt || isLocked(editingDebt.date)) return toast(lockMsg());
  const n = debtTx(editingDebt).length;
  if (n && debtTx(editingDebt).some(t => isLocked(t.date))) return toast('Ada pembayaran di periode yang sudah ditutup; data ini tidak bisa dihapus.');
  if (!confirm(n ? `Hapus data ini? ${n} transaksi pembayarannya tetap ada di daftar Transaksi, tetapi tidak lagi terhubung.` : 'Hapus data ini?')) return;
  const reason = askReason('menghapus ' + editingDebt.kind); if (!reason) return;
  log('hapus', editingDebt.kind, editingDebt.id, `${debtSummary(editingDebt)} · alasan: ${reason}`);
  state.tx.forEach(t => { if (t.debtId === editingDebt.id) delete t.debtId; });
  state.debts = state.debts.filter(d => d !== editingDebt);
  $('debtDialog').close(); save(); toast('Data dihapus (tercatat di jejak audit)');
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
  const d = payingDebt, amount = parseNum($('pAmount').value), date = $('pDate').value, ref = $('pRef').value.trim().slice(0, 40);
  const fail = msg => { e.preventDefault(); toast(msg); };
  if (!DATE_RE.test(date)) return fail('Isi tanggal pembayaran');
  if (isLocked(date)) return fail(lockMsg());
  if (date < d.date) return fail('Tanggal pembayaran tidak boleh sebelum tanggal faktur');
  if (amount <= 0) return fail('Jumlah harus lebih dari 0');
  if (amount > remainOf(d)) return fail('Jumlah melebihi sisa ' + rp(remainOf(d)));
  if (!ref) return fail('No. bukti wajib diisi');
  if (state.tx.some(t => t.ref === ref)) return fail(`No. bukti ${ref} sudah dipakai`);
  const t = {id: uid(), created: Date.now(), type: d.kind === 'piutang' ? 'in' : 'out', date, ref, amount,
    accountId: $('pAcc').value, categoryId: d.categoryId, toAccountId: null, debtId: d.id,
    desc: `${d.kind === 'piutang' ? 'Pelunasan piutang' : 'Pembayaran utang'} ${d.party}${d.ref ? ' (' + d.ref + ')' : ''}`.slice(0, 500)};
  state.tx.push(t);
  log('tambah', 'pelunasan', t.id, txSummary(t));
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
const basisNote = () => state.company.basis === 'kas'
  ? 'Basis kas: pendapatan dan beban diakui saat uang diterima/dibayar.'
  : 'Basis akrual (SAK EMKM): pendapatan diakui saat faktur piutang diterbitkan atau kas diterima, beban saat tagihan utang diterima atau kas dibayar.';
const footerNote = () => `<p class="muted" style="font-size:11px">Dicetak ${new Date().toLocaleString('id-ID')} dari ${esc(APP_NAME)}. ${state.lockedUntil ? 'Data s.d. ' + fmtDate(state.lockedUntil) + ' telah ditutup (tutup buku).' : 'Periode belum ditutup; angka masih dapat berubah.'}</p>`;

function lrTable(L) {
  const rows = list => list.map(r => `<tr><td style="padding-left:24px">${r.label}</td><td class="num">${rp(r.v)}</td></tr>`).join('')
    || '<tr><td class="muted" style="padding-left:24px">—</td><td></td></tr>';
  return `<table>
    <tr class="sect"><td colspan="2">Pendapatan</td></tr>${rows(L.ins)}
    <tr><td><b>Total Pendapatan</b></td><td class="num"><b>${rp(L.ti)}</b></td></tr>
    <tr class="sect"><td colspan="2">Beban</td></tr>${rows(L.outs)}
    <tr><td><b>Total Beban</b></td><td class="num"><b>(${rp(L.to)})</b></td></tr>
    <tr class="total"><td>${L.net >= 0 ? 'LABA BERSIH' : 'RUGI BERSIH'}</td><td class="num ${L.net >= 0 ? 'in' : 'out'}">${rp(L.net)}</td></tr>
  </table>`;
}
function neracaTable(N) {
  const rows = list => list.map(r => `<tr><td style="padding-left:24px">${r.label}</td><td class="num">${rp(r.v)}</td></tr>`).join('')
    || '<tr><td class="muted" style="padding-left:24px">—</td><td></td></tr>';
  return `<table>
    <tr class="sect"><td colspan="2">ASET</td></tr>${rows(N.aset)}
    <tr class="total"><td>TOTAL ASET</td><td class="num">${rp(N.ta)}</td></tr>
    <tr class="sect"><td colspan="2">LIABILITAS</td></tr>${rows(N.liab)}
    <tr><td><b>Total Liabilitas</b></td><td class="num"><b>${rp(N.tl)}</b></td></tr>
    <tr class="sect"><td colspan="2">EKUITAS</td></tr>${rows(N.eq)}
    <tr><td style="padding-left:24px">Saldo laba (rugi) tahun-tahun lalu</td><td class="num">${rp(N.prev)}</td></tr>
    <tr><td style="padding-left:24px">Laba (rugi) tahun berjalan</td><td class="num">${rp(N.cur)}</td></tr>
    <tr><td><b>Total Ekuitas</b></td><td class="num"><b>${rp(N.te)}</b></td></tr>
    <tr class="total"><td>TOTAL LIABILITAS DAN EKUITAS</td><td class="num">${rp(N.tl + N.te)}</td></tr>
  </table>
  <p style="font-size:12px" class="${N.diff ? 'out' : 'in'}">${N.diff ? '⚠ Tidak seimbang, selisih ' + rp(N.diff) + '. Periksa kode akun kategori.' : '✓ Seimbang: total aset = total liabilitas dan ekuitas.'}</p>`;
}
function notesHTML(from, to, N, L) {
  const c = state.company, ent = ENTITY[c.entity] || ENTITY.ptp, {last} = pphEligibility();
  const prive = state.tx.filter(t => inRange(t.date, from, to) && t.type === 'out' && /prive|penarikan pemilik/i.test(catName(t.categoryId))).reduce((s, t) => s + t.amount, 0);
  const debtsOpen = kind => state.debts.filter(d => d.kind === kind && d.date <= N.asOf && remainOf(d, N.asOf) > 0);
  const debtRows = kind => debtsOpen(kind).map(d => `<tr><td style="padding-left:24px">${esc(d.party)} · ${esc(d.ref || '-')} · jatuh tempo ${d.due ? fmtDate(d.due) : '—'}</td><td class="num">${rp(remainOf(d, N.asOf))}</td></tr>`).join('') || '<tr><td class="muted" style="padding-left:24px">Nihil</td><td></td></tr>';
  return `<h3>Catatan atas Laporan Keuangan</h3>
  <ol class="notes">
    <li><b>Umum.</b> ${esc(c.name || 'Entitas')} adalah ${esc(ent.label)}${c.npwp ? ' dengan NPWP ' + esc(c.npwp) : ''}${c.nib ? ', NIB ' + esc(c.nib) : ''}${c.address ? ', beralamat di ' + esc(c.address) : ''}.</li>
    <li><b>Dasar penyusunan.</b> Laporan disusun berdasarkan Standar Akuntansi Keuangan Entitas Mikro, Kecil, dan Menengah (SAK EMKM) dengan asumsi kelangsungan usaha, dalam mata uang Rupiah, untuk periode ${from ? fmtDate(from) : 'awal pencatatan'} s.d. ${fmtDate(to)}. ${esc(basisNote())}</li>
    <li><b>Kas dan setara kas</b> terdiri atas kas tunai dan saldo rekening bank: ${state.accounts.map(a => esc(a.name) + ' ' + rp(balance(a.id, N.asOf))).join('; ') || 'nihil'}.</li>
    <li><b>Piutang usaha</b> dicatat sebesar nilai faktur dikurangi pelunasan. Rincian per ${fmtDate(N.asOf)}:<table>${debtRows('piutang')}</table></li>
    <li><b>Utang usaha</b> dicatat sebesar nilai tagihan dikurangi pembayaran. Rincian per ${fmtDate(N.asOf)}:<table>${debtRows('utang')}</table></li>
    <li><b>Aset tetap</b> dicatat sebesar biaya perolehan. Penyusutan belum dihitung otomatis oleh aplikasi; bila material, catat beban penyusutan sesuai kebijakan entitas.</li>
    <li><b>Perpajakan.</b> ${last ? `Entitas memakai PPh final ${String(c.pphRate).replace('.', ',')}% atas peredaran bruto (PP 55/2022) sampai tahun pajak ${last}.` : `Tarif PPh final yang dipakai ${String(c.pphRate).replace('.', ',')}% atas peredaran bruto (PP 55/2022).`} Beban PPh final periode ini termasuk dalam beban usaha.</li>
    <li><b>Pemisahan harta.</b> Penarikan untuk keperluan pribadi pemilik (prive) periode ini: ${rp(prive)}, dicatat sebagai pengurang ekuitas, bukan beban usaha.</li>
    <li><b>Laba (rugi)</b> periode ini ${rp(L.net)}.</li>
  </ol>`;
}

// Setoran PPh final untuk suatu masa = transaksi kategori kode 5-501 yang dibayar pada bulan berikutnya
function pphPaidFor(ym) {
  const next = addMonths(ym, 1), ids = new Set(state.categories.filter(c => c.code === '5-501').map(c => c.id));
  return state.tx.reduce((s, t) => t.type === 'out' && ids.has(t.categoryId) && t.date.startsWith(next) ? s + t.amount : s, 0);
}

function renderReport() {
  fillSelect($('rAcc'), state.accounts);
  const type = $('rType').value, from = cleanDate($('rFrom').value), to = cleanDate($('rTo').value);
  $('rAccWrap').style.display = type === 'bk' ? '' : 'none';
  $('rFromWrap').style.display = type === 'umur' || type === 'neraca' || type === 'ns' ? 'none' : '';
  const period = `Periode ${from ? fmtDate(from) : 'awal'} s.d. ${to ? fmtDate(to) : 'sekarang'}`;
  const dayBefore = from ? new Date(new Date(from).getTime() - 864e5).toISOString().slice(0, 10) : null;
  const inRangeTx = state.tx.filter(t => inRange(t.date, from, to));
  let html = '';

  if (type === 'lr') {
    html = kop('Laporan Laba Rugi', period) + lrTable(lrData(from, to)) + `<p class="muted" style="font-size:12px">${esc(basisNote())} Kategori tanpa centang L/R (modal, pinjaman, pembelian aset, prive) tidak dimasukkan.</p>` + signBlock();
  } else if (type === 'neraca') {
    const N = neracaData(to);
    html = kop('Laporan Posisi Keuangan (Neraca)', 'Per ' + fmtDate(N.asOf)) + neracaTable(N) + signBlock();
  } else if (type === 'tahunan') {
    const N = neracaData(to), L = lrData(from, to);
    html = kop('Laporan Keuangan', period) + '<h3>1. Laporan Posisi Keuangan per ' + fmtDate(N.asOf) + '</h3>' + neracaTable(N)
      + '<h3>2. Laporan Laba Rugi</h3>' + lrTable(L) + notesHTML(from || '', N.asOf, N, L)
      + `<p class="muted" style="font-size:12px">${state.company.entity === 'ptp' ? 'PT Perorangan wajib menyampaikan laporan keuangan tahunan kepada Menteri Hukum melalui AHU Online paling lambat 6 bulan setelah akhir periode akuntansi (PP 8/2021). ' : ''}Laporan ini juga dapat dilampirkan pada SPT Tahunan PPh.</p>` + signBlock();
  } else if (type === 'jurnal') {
    const list = M().journal.filter(e => e.date ? inRange(e.date, from, to) : !from);
    let td_ = 0;
    html = kop('Jurnal Umum', period) + `<table>
      <thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Akun</th><th>Keterangan</th><th class="num">Debit</th><th class="num">Kredit</th></tr></thead>
      ${list.slice(0, 3000).map(e => { td_ += e.amt; return `
        <tr><td style="white-space:nowrap">${fmtDate(e.date)}</td><td>${esc(e.ref)}</td><td>${accHTML(e.dr)}</td><td>${esc(e.desc)}</td><td class="num">${rp(e.amt)}</td><td></td></tr>
        <tr><td></td><td></td><td style="padding-left:28px">${accHTML(e.cr)}</td><td></td><td></td><td class="num">${rp(e.amt)}</td></tr>`; }).join('')}
      <tr class="total"><td colspan="4">Total</td><td class="num">${rp(td_)}</td><td class="num">${rp(td_)}</td></tr>
    </table>${list.length > 3000 ? '<p class="muted">Ditampilkan 3.000 jurnal pertama; persempit periode atau ekspor CSV.</p>' : ''}<p class="muted" style="font-size:12px">Jurnal disusun otomatis dari transaksi kas, faktur piutang/utang, dan pelunasannya (pencatatan berpasangan).</p>` + signBlock();
  } else if (type === 'ns') {
    const asOf = to || today(), m = new Map();
    for (const e of M().journal) {
      if (e.date && e.date > asOf) continue;
      for (const [acc, dr] of [[e.dr, true], [e.cr, false]]) {
        const r = m.get(accKey(acc)) || {acc, d: 0, k: 0};
        if (dr) r.d += e.amt; else r.k += e.amt;
        m.set(accKey(acc), r);
      }
    }
    const rows = [...m.values()].sort((a, b) => accKey(a.acc).localeCompare(accKey(b.acc)));
    let sd = 0, sk = 0;
    html = kop('Neraca Saldo', 'Per ' + fmtDate(asOf)) + `<table>
      <thead><tr><th>Akun</th><th class="num">Mutasi debit</th><th class="num">Mutasi kredit</th><th class="num">Saldo debit</th><th class="num">Saldo kredit</th></tr></thead>
      ${rows.map(r => { const s = r.d - r.k; if (s > 0) sd += s; else sk -= s; return `<tr><td>${accHTML(r.acc)}</td><td class="num">${rp(r.d)}</td><td class="num">${rp(r.k)}</td><td class="num">${s > 0 ? rp(s) : ''}</td><td class="num">${s < 0 ? rp(-s) : ''}</td></tr>`; }).join('')}
      <tr class="total"><td colspan="3">Total</td><td class="num">${rp(sd)}</td><td class="num">${rp(sk)}</td></tr>
    </table><p style="font-size:12px" class="${sd === sk ? 'in' : 'out'}">${sd === sk ? '✓ Total saldo debit = total saldo kredit.' : '⚠ Tidak seimbang.'}</p>` + signBlock();
  } else if (type === 'ak') {
    const rows = state.accounts.map(a => {
      const open = dayBefore ? balance(a.id, dayBefore) : a.opening;
      let inn = 0, out = 0;
      inRangeTx.forEach(t => { const e = effect(t, a.id); if (e > 0) inn += e; else out -= e; });
      return {a, open, inn, out, close: open + inn - out};
    });
    const tot = k => rows.reduce((s, r) => s + r[k], 0);
    html = kop('Laporan Arus Kas per Akun', period) + `<table>
      <thead><tr><th>Akun</th><th class="num">Saldo Awal</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Saldo Akhir</th></tr></thead>
      ${rows.map(r => `<tr><td>${accLabel(r.a)}</td><td class="num">${rp(r.open)}</td><td class="num in">${rp(r.inn)}</td><td class="num out">${rp(r.out)}</td><td class="num">${rp(r.close)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${rp(tot('open'))}</td><td class="num">${rp(tot('inn'))}</td><td class="num">${rp(tot('out'))}</td><td class="num">${rp(tot('close'))}</td></tr>
    </table><p class="muted" style="font-size:12px">Mutasi antarakun tercatat masuk/keluar di masing-masing akun, sehingga totalnya saling meniadakan. Cocokkan saldo akhir dengan rekening koran setiap akhir bulan.</p>` + signBlock();
  } else if (type === 'bk') {
    const accId = $('rAcc').value, a = state.accounts.find(x => x.id === accId);
    if (!a) { $('reportOut').innerHTML = '<div class="empty">Belum ada akun.</div>'; return; }
    let run = dayBefore ? balance(accId, dayBefore) : a.opening;
    const list = inRangeTx.filter(t => effect(t, accId) !== 0).sort((x, y) => x.date.localeCompare(y.date) || x.created - y.created);
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
    const c = state.company, rate = (+c.pphRate || 0) / 100, {ent, last} = pphEligibility();
    const start = (from || inRangeTx.map(t => t.date).sort()[0] || today()).slice(0, 7), end = (to || today()).slice(0, 7);
    const ids = new Set(state.categories.filter(x => x.code === '5-501').map(x => x.id));
    const rows = [];
    for (let ym = start; ym <= end && rows.length < 120; ym = addMonths(ym, 1)) {
      const bruto = lrData(ym + '-01', lastDayOf(ym)).ti;
      const pph = last && +ym.slice(0, 4) > last ? 0 : Math.floor(bruto * rate);
      const due = `${addMonths(ym, 1)}-15`;
      const pays = state.tx.filter(t => t.type === 'out' && ids.has(t.categoryId) && t.date.startsWith(addMonths(ym, 1)));
      const paid = pays.reduce((s, t) => s + t.amount, 0);
      const st = !pph ? ['Nihil', ''] : paid >= pph ? ['Lunas', 'in'] : due < today() ? ['Kurang setor', 'out'] : ['Belum jatuh tempo', 'warn'];
      rows.push({ym, bruto, pph, due, paid, st, refs: pays.map(t => t.ref).join(', ')});
    }
    const sumK = k => rows.reduce((s, r) => s + r[k], 0);
    html = kop(`Rekap PPh Final ${esc(String(c.pphRate).replace('.', ','))}% (PP 55/2022)`, period) + `<table>
      <thead><tr><th>Masa</th><th class="num">Peredaran bruto</th><th class="num">PPh terutang</th><th>Jatuh tempo</th><th class="num">Disetor</th><th>No. bukti / NTPN</th><th>Status</th></tr></thead>
      ${rows.map(r => `<tr><td>${MONTHS_FULL[+r.ym.slice(5) - 1]} ${r.ym.slice(0, 4)}</td><td class="num">${rp(r.bruto)}</td><td class="num">${rp(r.pph)}</td>
        <td style="white-space:nowrap">${fmtDate(r.due)}</td><td class="num">${rp(r.paid)}</td><td>${esc(r.refs)}</td><td><span class="badge ${r.st[1]}">${r.st[0]}</span></td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${rp(sumK('bruto'))}</td><td class="num">${rp(sumK('pph'))}</td><td></td><td class="num">${rp(sumK('paid'))}</td><td></td><td></td></tr>
    </table><p class="muted" style="font-size:12px">
      Peredaran bruto mengikuti ${state.company.basis === 'kas' ? 'penerimaan kas' : 'pendapatan akrual'} dari kategori pendapatan (usaha perantara cukup mencatat komisinya).
      Setor paling lambat tanggal 15 bulan berikutnya lewat kode billing Coretax (KAP-KJS 411128-420); setoran dengan NTPN dianggap telah melaporkan SPT Masa.
      Isi No. bukti transaksi setoran dengan NTPN agar mudah ditelusuri.
      ${ent.label}: PPh final berlaku ${ent.years} tahun pajak${last ? ` (s.d. ${last})` : ''}, untuk peredaran bruto ≤ Rp4,8 miliar setahun${ent.badan ? '; badan tidak mendapat pengurangan Rp500 juta' : '; orang pribadi bebas PPh atas peredaran bruto s.d. Rp500 juta setahun (hitung manual)'}.</p>` + signBlock();
  } else if (type === 'audit') {
    const list = state.audit.filter(a => inRange(a.ts.slice(0, 10), from, to)).slice().reverse();
    html = kop('Jejak Audit', period) + `<table>
      <thead><tr><th>Waktu</th><th>Pengguna/perangkat</th><th>Aksi</th><th>Data</th><th>Rincian</th></tr></thead>
      ${list.slice(0, 3000).map(a => `<tr><td style="white-space:nowrap">${esc(new Date(a.ts).toLocaleString('id-ID'))}</td><td>${esc(a.by)}</td><td><span class="badge ${a.act === 'hapus' ? 'out' : a.act === 'tambah' ? 'in' : 'warn'}">${esc(a.act)}</span></td><td>${esc(a.ent)}</td><td>${esc(a.info)}</td></tr>`).join('')
        || '<tr><td colspan="5" class="muted">Belum ada catatan pada periode ini.</td></tr>'}
    </table><p class="muted" style="font-size:12px">Jejak audit mencatat setiap penambahan, perubahan, dan penghapusan data beserta alasannya. Catatan ini tidak dapat diubah dari aplikasi.</p>`;
  }
  $('reportOut').innerHTML = html + (type !== 'audit' ? footerNote() : '');
}
['rType', 'rFrom', 'rTo', 'rAcc'].forEach(id => $(id).oninput = renderReport);
$('rType').addEventListener('change', () => { if (['umur', 'neraca', 'ns'].includes($('rType').value) && $('rTo').value > today()) { $('rTo').value = today(); renderReport(); } });
// Ekspor tabel laporan yang sedang tampil ke CSV (Excel)
function reportCsv() {
  const rows = [];
  $('reportOut').querySelectorAll('h2, h3, table').forEach(el => {
    if (el.tagName !== 'TABLE') { rows.push([el.textContent.trim()]); return; }
    el.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr').forEach(tr =>
      rows.push([...tr.children].map(td => { const s = td.textContent.trim(), n = /^−?Rp [\d.]+$/.test(s) ? parseNum(s) * (s.startsWith('−') ? -1 : 1) : null; return n ?? s; })));
    rows.push([]);
  });
  download(toCsv(rows), `laporan-${$('rType').value}-${today()}.csv`, 'text/csv');
}

/* ---------- Pengaturan ---------- */
const PROFILE_FIELDS = {pName: 'name', pTagline: 'tagline', pAddress: 'address', pNpwp: 'npwp', pNib: 'nib', pPhone: 'phone',
  pEmail: 'email', pPrepName: 'preparedName', pPrepTitle: 'preparedTitle', pCheckName: 'checkedName', pCheckTitle: 'checkedTitle',
  pPph: 'pphRate', pEntity: 'entity', pTaxYear: 'taxYear', pBasis: 'basis'};
function renderHeader() {
  const c = state.company;
  $('companyName').textContent = displayName();
  $('companyTagline').textContent = c.tagline;
  document.title = c.name ? 'Keuangan UMKM · ' + c.name : APP_NAME;
  $('brandLogo').innerHTML = logoHTML(38);
}
function renderSettings() {
  const c = state.company;
  $('logoPreview').innerHTML = logoHTML(64);
  $('btnLogoRemove').style.display = c.logo ? '' : 'none';
  Object.entries(PROFILE_FIELDS).forEach(([id, k]) => {
    if (document.activeElement !== $(id)) $(id).value = k === 'pphRate' ? String(c[k]).replace('.', ',') : c[k] ?? '';
  });
  const {ent, last} = pphEligibility();
  $('taxInfo').textContent = last ? `${ent.label}: PPh final 0,5% berlaku ${ent.years} tahun pajak, yaitu ${c.taxYear}–${last} (PP 55/2022).` : `${ent.label}: PPh final 0,5% berlaku ${ent.years} tahun pajak sejak terdaftar (PP 55/2022).`;
  $('accList').innerHTML = state.accounts.map(a => `<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td class="num">${rp(a.opening)}</td>
    <td class="num" style="white-space:nowrap"><button class="btn sm" data-act="editAcc" data-id="${esc(a.id)}">Ubah</button> <button class="btn sm danger" data-act="delAcc" data-id="${esc(a.id)}">Hapus</button></td></tr>`).join('');
  $('catList').innerHTML = state.categories.map(c => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td><span class="badge ${c.type === 'out' ? 'out' : 'in'}">${TYPE_LABEL[c.type]}</span></td>
    <td><input type="checkbox" ${c.lr !== false ? 'checked' : ''} data-act="toggleLR" data-id="${esc(c.id)}" title="Dihitung di Laba Rugi"></td>
    <td class="num" style="white-space:nowrap"><button class="btn sm" data-act="editCat" data-id="${esc(c.id)}">Ubah</button> <button class="btn sm danger" data-act="delCat" data-id="${esc(c.id)}">Hapus</button></td></tr>`).join('');
  $('lockStatus').innerHTML = state.lockedUntil
    ? `<div class="notice ok">Buku ditutup s.d. <b>${fmtDate(state.lockedUntil)}</b>. Transaksi, faktur, dan pelunasan bertanggal sampai hari itu tidak bisa diubah atau dihapus.</div>`
    : '<div class="notice">Belum ada periode yang ditutup.</div>';
  if (document.activeElement !== $('lockDate')) $('lockDate').value = state.lockedUntil || lastDayOf(addMonths(today().slice(0, 7), -1));
  $('auditCount').textContent = `${state.audit.length.toLocaleString('id-ID')} catatan di jejak audit.`;
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
  const conflicts = conflictKeys();
  box.innerHTML = `<div>Masuk sebagai <b>@${esc(cloudInfo.username || '—')}</b></div>
    <div class="muted" style="font-size:12px">${cloudInfo.google ? 'Akun Google · ' + esc(cloudInfo.email || '') : 'Akun username & kata sandi'}</div>
    <div class="muted" id="syncStatus" style="margin:8px 0">${esc(syncMsg)}</div>
    <div class="muted" style="font-size:12px;margin-bottom:10px">${vault
      ? 'Data dienkripsi di perangkat sebelum dikirim, sehingga server pun tidak bisa membacanya.'
      : 'Tips: pasang kata sandi di kartu Keamanan agar data dienkripsi sebelum dikirim ke server.'}</div>
    ${conflicts.length ? `<div class="notice">Salinan dari konflik sinkron (data perangkat ini yang tidak terkirim): ${conflicts.map(k => `<button class="btn sm" data-act="dlConflict" data-id="${esc(k.split('-konflik-')[1])}">${esc(new Date(+k.split('-konflik-')[1]).toLocaleString('id-ID'))}</button>`).join(' ')} <button class="btn sm danger" data-act="clearConflicts">Hapus salinan</button></div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" data-act="syncNow">Sinkron sekarang</button>
      <button class="btn" data-act="logout">Keluar</button>
      <button class="btn danger" data-act="deleteAccount">Hapus akun &amp; data server</button>
    </div>`;
}
$('btnSaveCompany').onclick = () => {
  const before = JSON.stringify({...state.company, logo: undefined});
  Object.entries(PROFILE_FIELDS).forEach(([id, k]) => {
    const v = $(id).value.trim();
    if (k === 'pphRate') { const r = parseFloat(v.replace(',', '.')); state.company[k] = Number.isFinite(r) && r >= 0 && r <= 100 ? r : PROFILE.pphRate; }
    else if (k === 'taxYear') state.company[k] = /^(19|20)\d{2}$/.test(v) ? v : '';
    else if (k === 'entity') state.company[k] = Object.hasOwn(ENTITY, v) ? v : PROFILE.entity;
    else if (k === 'basis') state.company[k] = v === 'kas' ? 'kas' : 'akrual';
    else state.company[k] = v.slice(0, 300);
  });
  if (before !== JSON.stringify({...state.company, logo: undefined})) log('ubah', 'profil', '', 'Profil/pengaturan pajak diperbarui');
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
  const opening = parseNum($('newAccOpen').value);
  if (opening && state.lockedUntil) return toast('Saldo awal tidak bisa diisi setelah tutup buku; catat sebagai transaksi setoran.');
  const a = {id: uid(), code: $('newAccCode').value.trim().slice(0, 20), name, opening};
  state.accounts.push(a);
  log('tambah', 'akun', a.id, `${a.code} ${a.name} · saldo awal ${rp(a.opening)}`);
  $('newAccCode').value = $('newAccName').value = $('newAccOpen').value = ''; save();
};
$('btnAddCat').onclick = () => {
  const name = $('newCatName').value.trim().slice(0, 120); if (!name) return toast('Isi nama kategori');
  const c = {id: uid(), code: $('newCatCode').value.trim().slice(0, 20), name, type: $('newCatType').value === 'out' ? 'out' : 'in', lr: true};
  state.categories.push(c);
  log('tambah', 'kategori', c.id, `${c.code} ${c.name}`);
  $('newCatCode').value = $('newCatName').value = ''; save();
};
$('btnLock').onclick = () => {
  const d = $('lockDate').value;
  if (!DATE_RE.test(d)) return toast('Pilih tanggal tutup buku');
  if (d > today()) return toast('Tanggal tutup buku tidak boleh di masa depan');
  if (state.lockedUntil && d < state.lockedUntil) {
    const reason = askReason(`membuka kembali periode ${fmtDate(d)}–${fmtDate(state.lockedUntil)}`); if (!reason) return;
    log('buka', 'tutup buku', '', `Tutup buku dimundurkan dari ${state.lockedUntil} ke ${d} · alasan: ${reason}`);
  } else {
    if (!confirm(`Tutup buku s.d. ${fmtDate(d)}? Data bertanggal sampai hari itu tidak bisa diubah atau dihapus lagi.`)) return;
    log('tutup', 'tutup buku', '', `Buku ditutup s.d. ${d}`);
  }
  state.lockedUntil = d; save(); toast('Tutup buku tersimpan');
};

// Satu penangan untuk semua tombol yang dibuat dinamis (tanpa onclick di HTML, sesuai CSP)
const ACTIONS = {
  openTx, openPay, openDebt,
  editPayment: id => { $('debtDialog').close(); openTx(id); },
  moreTx: () => { txLimit += TX_PAGE; renderTx(); },
  editAcc: id => {
    const a = state.accounts.find(x => x.id === id); if (!a) return;
    const code = prompt('Kode akun:', a.code); if (code === null) return;
    const name = prompt('Nama akun:', a.name); if (name === null) return;
    let opening = a.opening;
    if (!state.lockedUntil) { const o = prompt('Saldo awal (Rp):', a.opening); if (o === null) return; opening = parseNum(o); }
    else toast('Saldo awal terkunci karena sudah tutup buku');
    const before = `${a.code} ${a.name} ${rp(a.opening)}`;
    a.code = code.trim().slice(0, 20); a.name = name.trim().slice(0, 120) || a.name; a.opening = opening;
    log('ubah', 'akun', a.id, `${before} ⇒ ${a.code} ${a.name} ${rp(a.opening)}`); save();
  },
  delAcc: id => {
    if (state.tx.some(t => t.accountId === id || t.toAccountId === id)) return toast('Akun masih dipakai transaksi, tidak bisa dihapus');
    const a = state.accounts.find(x => x.id === id);
    if (a?.opening && state.lockedUntil) return toast('Akun bersaldo awal tidak bisa dihapus setelah tutup buku');
    if (confirm('Hapus akun ini?')) { log('hapus', 'akun', id, `${a?.code} ${a?.name}`); state.accounts = state.accounts.filter(x => x.id !== id); save(); }
  },
  editCat: id => {
    const c = state.categories.find(x => x.id === id); if (!c) return;
    const code = prompt('Kode akun (1 aset, 2 liabilitas, 3 ekuitas, 4 pendapatan, 5 beban):', c.code); if (code === null) return;
    const name = prompt('Nama kategori:', c.name); if (name === null) return;
    const before = `${c.code} ${c.name}`;
    c.code = code.trim().slice(0, 20); c.name = name.trim().slice(0, 120) || c.name;
    log('ubah', 'kategori', c.id, `${before} ⇒ ${c.code} ${c.name}`); save();
  },
  delCat: id => {
    if (state.tx.some(t => t.categoryId === id) || state.debts.some(d => d.categoryId === id)) return toast('Kategori masih dipakai, tidak bisa dihapus');
    const c = catOf(id);
    if (confirm('Hapus kategori ini?')) { log('hapus', 'kategori', id, `${c?.code} ${c?.name}`); state.categories = state.categories.filter(x => x.id !== id); save(); }
  },
  print: () => window.print(),
  reportCsv,
  backup: () => $('btnBackup').click(),
  goLogin: () => { localStorage.removeItem(MODE_KEY); location.reload(); },
  goLock: () => { goView('pengaturan'); $('lockDate').focus(); $('lockDate').scrollIntoView({block: 'center'}); },
  syncNow: async () => { if (!cloudUser) return; dirty = true; await pushNow(); },
  dlConflict: ts => { const raw = localStorage.getItem(`${storeKey}-konflik-${ts}`); if (raw) download(raw, `salinan-konflik-${ts}.json`, 'application/json'); },
  clearConflicts: () => { if (confirm('Hapus semua salinan konflik di perangkat ini?')) { conflictKeys().forEach(k => localStorage.removeItem(k)); renderAll(); } },
  logout: async () => {
    if (!confirm('Keluar dari akun? Salinan data di perangkat ini dihapus; data tetap aman di server dan muncul lagi saat Anda masuk.')) return;
    if (dirty) await pushNow();
    if (dirty && !confirm('Ada perubahan yang BELUM tersimpan ke server (offline?). Tetap keluar dan buang perubahan itu?')) return;
    await Cloud.signOut().catch(() => {});
    [storeKey, metaKey(), LAST_UID_KEY, ...conflictKeys()].forEach(k => localStorage.removeItem(k));
    location.reload();
  },
  // Hak penghapusan data pribadi (UU 27/2022 tentang Pelindungan Data Pribadi)
  deleteAccount: async () => {
    if (!confirm('Hapus akun beserta SELURUH data keuangan di server? Tindakan ini tidak bisa dibatalkan. Unduh backup lebih dulu bila masih diperlukan (dokumen pembukuan wajib disimpan 10 tahun).')) return;
    if (prompt(`Ketik username Anda (${cloudInfo.username}) untuk konfirmasi`) !== cloudInfo.username) return toast('Konfirmasi tidak cocok');
    try {
      await Cloud.deleteAccount(cloudInfo.username);
      [storeKey, metaKey(), LAST_UID_KEY, ...conflictKeys()].forEach(k => localStorage.removeItem(k));
      alert('Akun dan data di server sudah dihapus.');
      location.reload();
    } catch (e) {
      toast(e?.code === 'auth/requires-recent-login' || e?.code === 'recent-login'
        ? 'Demi keamanan, keluar lalu masuk kembali, kemudian ulangi penghapusan akun dalam 5 menit.' : 'Gagal menghapus akun. Coba lagi.');
    }
  },
  goProfile: () => { goView('pengaturan'); $('pName').focus(); },
  goSecurity: () => { goView('pengaturan'); $('btnSetPw').focus(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.type === 'checkbox' || !Object.hasOwn(ACTIONS, el.dataset.act)) return;
  ACTIONS[el.dataset.act](el.dataset.id);
});
document.addEventListener('change', e => {
  const el = e.target.closest('input[data-act="toggleLR"]');
  const c = el && state.categories.find(x => x.id === el.dataset.id);
  if (c) { c.lr = el.checked; log('ubah', 'kategori', c.id, `${c.code} ${c.name}: masuk L/R = ${c.lr ? 'ya' : 'tidak'}`); save(); }
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
    const prevAudit = state.audit;
    state = clean; migrate();
    // Jejak audit lama tetap dipertahankan dan peristiwa pemulihan ikut dicatat
    const seen = new Set(state.audit.map(a => a.ts + a.id + a.act));
    prevAudit.forEach(a => { if (!seen.has(a.ts + a.id + a.act)) state.audit.push(a); });
    state.audit.sort((a, b) => a.ts.localeCompare(b.ts));
    log('pulihkan', 'data', '', `Data dipulihkan dari file ${f.name}: ${clean.tx.length} transaksi, ${clean.debts.length} piutang/utang`);
    save(); toast('Data berhasil dipulihkan');
  } catch { toast('File backup tidak valid'); }
};
$('btnWipe').onclick = () => {
  if (state.lockedUntil && !confirm('Buku sudah ditutup. Menghapus semua data akan menghapus catatan yang mungkin sudah dilaporkan. Lanjutkan?')) return;
  if (!confirm('Hapus SEMUA data? Pastikan sudah backup.')) return;
  if (prompt('Ketik HAPUS untuk konfirmasi') !== 'HAPUS') return;
  const sec = state.security, n = state.tx.length;
  state = defaultState(); state.security = sec;
  log('hapus', 'data', '', `Semua data dihapus (${n} transaksi)`);
  save(); toast('Semua data dihapus');
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

const VIEWS = {dashboard: renderDashboard, transaksi: renderTx, hutang: renderDebts, laporan: renderReport, pengaturan: renderSettings};
function renderView(v) { VIEWS[v]?.(); }
function renderAll() { memo = null; renderHeader(); renderView(currentView); }

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
  'auth/password-does-not-meet-requirements': `Kata sandi belum memenuhi syarat (minimal ${MIN_PW} karakter).`,
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
  syncBase = remote ? remote.updatedAt : null;
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
