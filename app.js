'use strict';
/* Aplikasi Keuangan Perusahaan (UMKM)
   Data tersimpan di perangkat (opsional disinkron ke akun di server). Laporan disusun dengan basis akrual
   mengikuti SAK EMKM: Laporan Posisi Keuangan, Laba Rugi, dan Catatan atas Laporan Keuangan. */

const KEY = 'keuangan-perusahaan-v1';            // data mode tanpa akun; mode akun memakai KEY + ':' + uid
const LOCK_KEY = 'keuangan-perusahaan-lock';
const MODE_KEY = 'keuangan-mode';                 // 'lokal' bila pengguna memilih tanpa akun
const LAST_UID_KEY = 'keuangan-last-uid';
const DEVICE_KEY = 'keuangan-device-id';
const VIEW_KEY = 'keuangan-halaman';
const ACTIVE_KEY = 'keuangan-aktif-terakhir';     // waktu terakhir akun dipakai di perangkat ini
const IDLE_NOTE_KEY = 'keuangan-keluar-otomatis';
const IDLE_LOGOUT_MS = 60 * 60 * 1000, IDLE_WARN_MS = 2 * 60 * 1000;
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
const DATA_VERSION = 5; // naikkan bila struktur data berubah; versi lama aplikasi tidak boleh menimpa data yang lebih baru
const STORE_WARN = 3500000; // peringatan sebelum penyimpanan perangkat (sekitar 5 juta karakter) penuh

// Akun sistem untuk jurnal otomatis (double entry)
const ACC_PIUTANG = {code: '1-201', name: 'Piutang usaha'};
const ACC_UTANG = {code: '2-101', name: 'Utang usaha'};
const ACC_OPENING = {code: '3-001', name: 'Ekuitas saldo awal'};
const ACC_PERSEDIAAN = {code: '1-301', name: 'Persediaan barang dagang'};
const ACC_HPP = {code: '5-100', name: 'Harga pokok penjualan'};
const ACC_KASBON = {code: '1-203', name: 'Piutang karyawan (kasbon)'};
const ACC_PPH21 = {code: '2-103', name: 'Utang PPh 21'};
const ACC_BPJS = {code: '2-104', name: 'Utang BPJS'};
const ACC_BEBAN_BPJS = {code: '5-202', name: 'Beban BPJS perusahaan'};
const ACC_PPN_IN = {code: '1-402', name: 'PPN masukan'};
const ACC_KREDIT_PPH = {code: '1-403', name: 'PPh dipotong/dipungut pihak lain'};
const ACC_PPH_POT = {code: '2-105', name: 'Utang PPh potput'};
const ACC_PPN = {code: '2-106', name: 'Utang PPN'};
const ACC_BEBAN_JASA = {code: '5-306', name: 'Beban jasa vendor'};
const ACC_PPN_WAPU = {code: '2-107', name: 'Utang PPN dipungut (WAPU)'};
const ACC_SELISIH = {code: '5-102', name: 'Selisih persediaan'};
// Kategori yang dipakai modul jual beli & penggajian; dibuat otomatis bila belum ada
const SYS_CATS = [
  ['4-101', 'Penjualan', 'in', true], ['4-102', 'Pendapatan jasa', 'in', true], ['5-201', 'Gaji dan BPJS', 'out', true],
  [ACC_PERSEDIAAN.code, ACC_PERSEDIAAN.name, 'out', false], [ACC_KASBON.code, ACC_KASBON.name, 'out', false],
  [ACC_PPH21.code, ACC_PPH21.name, 'out', false], [ACC_BPJS.code, ACC_BPJS.name, 'out', false],
  [ACC_PPN.code, ACC_PPN.name, 'out', false], [ACC_PPN_WAPU.code, ACC_PPN_WAPU.name, 'out', false], [ACC_PPH_POT.code, ACC_PPH_POT.name, 'out', false],
];
// Perlakuan pajak per jenis barang/jasa, berlaku untuk semua bidang usaha.
// pph: 22 dipungut WAPU, 23 dipotong, 23r royalti, 42k/42s PPh final konstruksi/sewa; lux: PPN tanpa DPP nilai lain
const TAX_TYPES = {
  bkp: {label: 'Barang umum kena PPN', ppn: true, pph: '22', kind: 'barang'},
  lux: {label: 'Barang mewah (PPN penuh)', ppn: true, lux: true, pph: '22', kind: 'barang'},
  nonbkp: {label: 'Barang bebas / tidak kena PPN', ppn: false, pph: '22', kind: 'barang'},
  jasa: {label: 'Jasa umum kena PPN', ppn: true, pph: '23', kind: 'jasa'},
  konsultan: {label: 'Jasa konsultan, teknik, manajemen', ppn: true, pph: '23', kind: 'jasa'},
  angkut: {label: 'Jasa angkutan & pengiriman', ppn: true, pph: '23', kind: 'jasa'},
  katering: {label: 'Jasa katering', ppn: true, pph: '23', kind: 'jasa'},
  tenaga: {label: 'Jasa kebersihan, keamanan, tenaga kerja', ppn: true, pph: '23', kind: 'jasa'},
  rawat: {label: 'Jasa perawatan, perbaikan, instalasi', ppn: true, pph: '23', kind: 'jasa'},
  iklan: {label: 'Jasa iklan, desain, IT', ppn: true, pph: '23', kind: 'jasa'},
  nonjkp: {label: 'Jasa tidak kena PPN', ppn: false, pph: '23', kind: 'jasa'},
  sewalain: {label: 'Sewa kendaraan, alat, harta lain', ppn: true, pph: '23', kind: 'jasa'},
  sewa: {label: 'Sewa tanah/bangunan (PPh final)', ppn: true, pph: '42s', kind: 'jasa'},
  kons: {label: 'Jasa konstruksi (PPh final)', ppn: true, pph: '42k', kind: 'jasa'},
  royalti: {label: 'Royalti & lisensi', ppn: true, pph: '23r', kind: 'jasa'},
};
const PPH_LABEL = {22: 'PPh Pasal 22', 23: 'PPh Pasal 23', '23r': 'PPh Pasal 23 royalti', '42k': 'PPh final konstruksi', '42s': 'PPh final sewa'};
// PPN 12% dengan DPP nilai lain 11/12 untuk barang/jasa bukan mewah (PMK 131/2024). Semua tarif bisa diubah di Jual/Beli → Pajak.
const TAX = {pkp: false, skb: false, ppnRate: 12, dppNum: 11, dppDen: 12, pph22: 1.5, pph23: 2, pph23r: 15, pph42k: 1.75, pph42s: 10};

/* Tarif ketenagakerjaan & PPh 21. Angka BPJS, batas upah, dan UMP berubah berkala, sehingga bisa diubah di menu Karyawan → Aturan.
   TER: Lampiran PP 58/2023, [batas atas bruto bulanan dalam juta rupiah, tarif %]. */
const TER = {
  A: [[5.4,0],[5.65,.25],[5.95,.5],[6.3,.75],[6.75,1],[7.5,1.25],[8.55,1.5],[9.65,1.75],[10.05,2],[10.35,2.25],[10.7,2.5],[11.05,3],[11.6,3.5],[12.5,4],[13.75,5],[15.1,6],[16.95,7],[19.75,8],[24.15,9],[26.45,10],[28,11],[30.05,12],[32.4,13],[35.4,14],[39.1,15],[43.85,16],[47.8,17],[51.4,18],[56.3,19],[62.2,20],[68.6,21],[77.5,22],[89,23],[103,24],[125,25],[157,26],[206,27],[337,28],[454,29],[550,30],[695,31],[910,32],[1400,33],[Infinity,34]],
  B: [[6.2,0],[6.5,.25],[6.85,.5],[7.3,.75],[9.2,1],[10.75,1.5],[11.25,2],[11.6,2.5],[12.6,3],[13.6,4],[14.95,5],[16.4,6],[18.45,7],[21.85,8],[26,9],[27.7,10],[29.35,11],[31.45,12],[33.95,13],[37.1,14],[41.1,15],[45.8,16],[49.5,17],[53.8,18],[58.5,19],[64,20],[71,21],[80,22],[93,23],[109,24],[129,25],[163,26],[211,27],[374,28],[459,29],[555,30],[704,31],[957,32],[1405,33],[Infinity,34]],
  C: [[6.6,0],[6.95,.25],[7.35,.5],[7.8,.75],[8.85,1],[9.8,1.25],[10.95,1.5],[11.2,1.75],[12.05,2],[12.95,3],[14.15,4],[15.55,5],[17.05,6],[19.5,7],[22.7,8],[26.6,9],[28.1,10],[30.1,11],[32.6,12],[35.4,13],[38.9,14],[43,15],[47.4,16],[51.2,17],[55.8,18],[60.4,19],[66.7,20],[74.5,21],[83.2,22],[95.6,23],[110,24],[134,25],[169,26],[221,27],[390,28],[463,29],[561,30],[709,31],[965,32],[1419,33],[Infinity,34]],
};
const PTKP = {'TK/0': 54e6, 'TK/1': 58.5e6, 'TK/2': 63e6, 'TK/3': 67.5e6, 'K/0': 58.5e6, 'K/1': 63e6, 'K/2': 67.5e6, 'K/3': 72e6};
const TER_CAT = {'TK/0': 'A', 'TK/1': 'A', 'K/0': 'A', 'TK/2': 'B', 'TK/3': 'B', 'K/1': 'B', 'K/2': 'B', 'K/3': 'C'};
const PASAL17 = [[6e7, 5], [2.5e8, 15], [5e8, 25], [5e9, 30], [Infinity, 35]];
const EMP_STATUS = {pkwtt: 'PKWTT (tetap)', pkwt: 'PKWT (kontrak)', harian: 'Harian lepas'};
// umpMode: 'wajib' = memakai upah minimum; 'kesepakatan' = usaha mikro/kecil, upah menurut kesepakatan (PP 36/2021 Pasal 36)
const HR = {umpMode: 'wajib', ump: 0, floor: 0, workDays: 5, jkk: 0.24, jkm: 0.3, jhtCo: 3.7, jhtEe: 2, jpCo: 2, jpEe: 1, kesCo: 4, kesEe: 1,
  jpCap: 11086300, kesCap: 12000000, onJkk: true, onJkm: true, onJht: true, onJp: true, onKes: true};

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
  pphRate: 0.5, entity: 'ptp', taxYear: '', basis: 'akrual', bankInfo: '', invoiceNote: '', nitku: '',
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const rp = n => (n < 0 ? '−Rp ' : 'Rp ') + Math.abs(Math.round(n)).toLocaleString('id-ID');
const parseNum = s => Math.round(Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.')) || 0);
const parseMoney = s => Math.abs(parseNum(s));
// Jumlah barang: koma atau titik sebagai desimal; "1.000" dibaca seribu
const parseQty = s => { const v = String(s ?? '').trim(); return cleanQty(/,/.test(v) ? v.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, '') : v); };
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
const displayName = () => state.company.name || company?.name || APP_NAME;

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
  return ensureCats({
    version: 4,
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
    items: [], vendors: [], trades: [], returns: [], adjusts: [], employees: [], payrolls: [],
    hr: {...HR}, tax: {...TAX}, ...erpDefaults(),
  });
}
const isSysCat = c => SYS_CATS.some(([code]) => code === c?.code);
// Pembelian persediaan hanya lewat menu Jual/Beli agar stok dan neraca tetap cocok
const manualCat = (c, keepId) => c.code !== ACC_PERSEDIAAN.code || c.id === keepId;
function ensureCats(s) {
  for (const [code, name, type, lr] of SYS_CATS)
    if (!s.categories.some(c => c.code === code)) s.categories.push({id: uid(), code, name, type, lr});
  return s;
}

/* ---------- Validasi data ----------
   Semua data dari penyimpanan, server, atau file backup dibersihkan dulu: id hanya huruf/angka, tanggal
   berformat baku, angka wajar, teks dibatasi panjangnya. Mencegah file palsu menyisipkan kode. */
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanStr = (v, max = 500) => String(v ?? '').slice(0, max);
const cleanNum = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(-1e15, Math.min(1e15, Math.round(n))) : 0; };
const cleanId = v => ID_RE.test(String(v ?? '')) ? String(v) : null;
const cleanDate = v => {
  const s = String(v ?? ''); if (!DATE_RE.test(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate() ? s : '';
};
const cleanQty = v => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1e9, Math.round(n * 1000) / 1000)) : 0; };
const cleanPct = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : def; };
const list = v => Array.isArray(v) ? v : [];

function sanitizeHr(h) {
  h = h && typeof h === 'object' ? h : {};
  const r = {umpMode: h.umpMode === 'kesepakatan' ? 'kesepakatan' : 'wajib', workDays: +h.workDays === 6 ? 6 : 5};
  for (const k of ['ump', 'floor', 'jpCap', 'kesCap']) r[k] = h[k] === undefined ? HR[k] : Math.abs(cleanNum(h[k]));
  for (const k of ['jkk', 'jkm', 'jhtCo', 'jhtEe', 'jpCo', 'jpEe', 'kesCo', 'kesEe']) r[k] = cleanPct(h[k], HR[k]);
  for (const k of ['onJkk', 'onJkm', 'onJht', 'onJp', 'onKes']) r[k] = h[k] !== false;
  return r;
}
function sanitizeTax(h) {
  h = h && typeof h === 'object' ? h : {};
  const r = {pkp: h.pkp === true, skb: h.skb === true};
  for (const k of ['ppnRate', 'pph22', 'pph23', 'pph23r', 'pph42k', 'pph42s']) r[k] = cleanPct(h[k], TAX[k]);
  for (const k of ['dppNum', 'dppDen']) r[k] = +h[k] > 0 && +h[k] <= 1000 ? +h[k] : TAX[k];
  return r;
}
const cleanLine = l => ({itemId: cleanId(l?.itemId), qty: cleanQty(l?.qty), price: Math.abs(cleanNum(l?.price))});
function cleanPayLine(l) {
  const n = k => cleanNum(l?.[k]), part = (o, keys) => Object.fromEntries(keys.map(k => [k, Math.abs(cleanNum(o?.[k]))]));
  return {empId: cleanId(l?.empId), name: cleanStr(l?.name, 120), title: cleanStr(l?.title, 120), ptkp: Object.hasOwn(PTKP, l?.ptkp) ? l.ptkp : 'TK/0',
    status: Object.hasOwn(EMP_STATUS, l?.status) ? l.status : 'pkwtt', taxBy: l?.taxBy === 'perusahaan' ? 'perusahaan' : 'karyawan',
    days: cleanQty(l?.days), otHours: cleanQty(l?.otHours), hdHours: cleanQty(l?.hdHours), rate: cleanPct(l?.rate, 0),
    base: n('base'), fixed: n('fixed'), varAllow: n('varAllow'), ot: n('ot'), bonus: n('bonus'), deduct: n('deduct'), taxAllow: n('taxAllow'),
    bruto: n('bruto'), pph: n('pph'), net: n('net'), co: part(l?.co, ['jkk', 'jkm', 'jht', 'jp', 'kes']), ee: part(l?.ee, ['jht', 'jp', 'kes'])};
}

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
      if (cleanId(t?.tradeId)) x.tradeId = t.tradeId;
      if (cleanId(t?.payrollId)) x.payrollId = t.payrollId;
      if (cleanId(t?.returnId)) x.returnId = t.returnId;
      if (cleanId(t?.kasbonId)) x.kasbonId = t.kasbonId;
      if (t?.cleared === true) x.cleared = true;
      if (cleanId(t?.centerId)) x.centerId = t.centerId;
      return x;
    }).filter(t => t.id && t.type && t.date && t.accountId),
    debts: (Array.isArray(d.debts) ? d.debts : []).map(x => {
      const r = {id: cleanId(x?.id), created: cleanNum(x?.created),
        kind: x?.kind === 'utang' ? 'utang' : 'piutang', party: cleanStr(x?.party, 120), ref: cleanStr(x?.ref, 40),
        date: cleanDate(x?.date), due: cleanDate(x?.due), amount: Math.abs(cleanNum(x?.amount)),
        categoryId: cleanId(x?.categoryId), desc: cleanStr(x?.desc)};
      if (cleanId(x?.tradeId)) r.tradeId = x.tradeId;
      return r;
    }).filter(x => x.id && x.date),
    items: list(d.items).map(i => ({id: cleanId(i?.id), code: cleanStr(i?.code, 30), name: cleanStr(i?.name, 120), unit: cleanStr(i?.unit, 20),
      kind: i?.kind === 'jasa' ? 'jasa' : 'barang', taxType: Object.hasOwn(TAX_TYPES, i?.taxType) ? i.taxType : i?.kind === 'jasa' ? 'jasa' : 'bkp', price: Math.abs(cleanNum(i?.price)), openQty: cleanQty(i?.openQty),
      openCost: Math.abs(cleanNum(i?.openCost)), minQty: cleanQty(i?.minQty), leadDays: Math.abs(cleanNum(i?.leadDays))})).filter(i => i.id && i.name),
    vendors: list(d.vendors).map(v => ({id: cleanId(v?.id), name: cleanStr(v?.name, 120), pic: cleanStr(v?.pic, 120), phone: cleanStr(v?.phone, 40),
      email: cleanStr(v?.email, 120), address: cleanStr(v?.address, 300), npwp: cleanStr(v?.npwp, 30), bank: cleanStr(v?.bank, 120),
      terms: Math.abs(cleanNum(v?.terms)), note: cleanStr(v?.note, 300), pkp: v?.pkp === true, wapu: v?.wapu === true, noPph: v?.noPph === true})).filter(v => v.id && v.name),
    trades: list(d.trades).map(t => ({id: cleanId(t?.id), created: cleanNum(t?.created), kind: t?.kind === 'purchase' ? 'purchase' : 'sale',
      date: cleanDate(t?.date), ref: cleanStr(t?.ref, 40), vendorId: t?.vendorId ? cleanId(t.vendorId) : null, party: cleanStr(t?.party, 120),
      lines: list(t?.lines).map(cleanLine).filter(l => l.itemId && l.qty > 0), discount: Math.abs(cleanNum(t?.discount)), extra: Math.abs(cleanNum(t?.extra)),
      pay: t?.pay === 'credit' ? 'credit' : 'cash', accountId: t?.accountId ? cleanId(t.accountId) : null, due: cleanDate(t?.due), desc: cleanStr(t?.desc),
      ppn: Math.abs(cleanNum(t?.ppn)), pph: Math.abs(cleanNum(t?.pph)), wapu: t?.wapu === true, wapuKind: t?.wapuKind === 'gov' ? 'gov' : 'other', cut: t?.cut === true, ppnCredit: t?.ppnCredit === true,
      pphParts: list(t?.pphParts).map(x => ({code: Object.hasOwn(PPH_LABEL, x?.code) ? x.code : '23', base: Math.abs(cleanNum(x?.base)), rate: cleanPct(x?.rate, 0), amt: Math.abs(cleanNum(x?.amt))})),
      srcId: t?.srcId ? cleanId(t.srcId) : null, whId: t?.whId ? cleanId(t.whId) : null, salesId: t?.salesId ? cleanId(t.salesId) : null,
      fpNo: cleanStr(t?.fpNo, 40), fpDate: cleanDate(t?.fpDate), poNo: cleanStr(t?.poNo, 60), custAddr: cleanStr(t?.custAddr, 300), custNpwp: cleanStr(t?.custNpwp, 30)}))
      .filter(t => t.id && t.date && t.lines.length),
    returns: list(d.returns).map(r => ({id: cleanId(r?.id), created: cleanNum(r?.created), kind: r?.kind === 'purchase' ? 'purchase' : 'sale', origId: cleanId(r?.origId),
      date: cleanDate(r?.date), ref: cleanStr(r?.ref, 40), lines: list(r?.lines).map(l => ({idx: Math.abs(cleanNum(l?.idx)), itemId: cleanId(l?.itemId), qty: cleanQty(l?.qty)})).filter(l => l.itemId && l.qty > 0),
      settle: r?.settle === 'debt' ? 'debt' : 'cash', accountId: r?.accountId ? cleanId(r.accountId) : null, debtId: r?.debtId ? cleanId(r.debtId) : null, desc: cleanStr(r?.desc),
      dpp: Math.abs(cleanNum(r?.dpp)), ppn: Math.abs(cleanNum(r?.ppn)), pph: Math.abs(cleanNum(r?.pph)), wapu: r?.wapu === true, ppnCredit: r?.ppnCredit === true}))
      .filter(r => r.id && r.origId && r.date && r.lines.length),
    adjusts: list(d.adjusts).map(a => ({id: cleanId(a?.id), created: cleanNum(a?.created), date: cleanDate(a?.date), ref: cleanStr(a?.ref, 40), desc: cleanStr(a?.desc), whId: a?.whId ? cleanId(a.whId) : null,
      lines: list(a?.lines).map(l => ({itemId: cleanId(l?.itemId), counted: cleanQty(l?.counted), diff: Number.isFinite(+l?.diff) ? Math.round(+l.diff * 1000) / 1000 : 0})).filter(l => l.itemId)}))
      .filter(a => a.id && a.date && a.lines.length),
    employees: list(d.employees).map(e => ({id: cleanId(e?.id), created: cleanNum(e?.created), name: cleanStr(e?.name, 120), nik: cleanStr(e?.nik, 20),
      npwp: cleanStr(e?.npwp, 30), title: cleanStr(e?.title, 120), gender: e?.gender === 'P' ? 'P' : 'L',
      status: Object.hasOwn(EMP_STATUS, e?.status) ? e.status : 'pkwtt', joinDate: cleanDate(e?.joinDate), endDate: cleanDate(e?.endDate), exitDate: cleanDate(e?.exitDate),
      ptkp: Object.hasOwn(PTKP, e?.ptkp) ? e.ptkp : 'TK/0', wage: Math.abs(cleanNum(e?.wage)), allow: Math.abs(cleanNum(e?.allow)),
      taxBy: e?.taxBy === 'perusahaan' ? 'perusahaan' : 'karyawan', bpjsTk: e?.bpjsTk !== false, bpjsKes: e?.bpjsKes !== false,
      bpjsTkNo: cleanStr(e?.bpjsTkNo, 30), bpjsKesNo: cleanStr(e?.bpjsKesNo, 30), bank: cleanStr(e?.bank, 120)})).filter(e => e.id && e.name),
    payrolls: list(d.payrolls).map(p => ({id: cleanId(p?.id), created: cleanNum(p?.created), period: /^\d{4}-(0[1-9]|1[0-2])$/.test(String(p?.period ?? '')) ? p.period : '',
      date: cleanDate(p?.date), ref: cleanStr(p?.ref, 40), accountId: cleanId(p?.accountId), lines: list(p?.lines).map(cleanPayLine).filter(l => l.empId)}))
      .filter(p => p.id && p.period && p.date && p.lines.length),
    hr: sanitizeHr(d.hr), tax: sanitizeTax(d.tax), ...sanitizeErp(d),
  };
}

const fillLr = s => s.categories.forEach(c => {
  if (c.lr === undefined) c.lr = !/modal|setoran pemilik|pinjaman|prive/i.test(c.name);
});

// Melengkapi data versi lama
function migrate() {
  // Data versi pertama tanpa transaksi diganti daftar akun & kategori bawaan terbaru
  if (!state.version && !state.tx.length && !state.debts.length) {
    const d = defaultState();
    state.accounts = d.accounts; state.categories = d.categories;
  }
  state.version = DATA_VERSION;
  fillLr(state);
  ensureCats(state);
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
  for (const r of state.returns) if (r.debtId) paid.set(r.debtId, (paid.get(r.debtId) || 0) + retPay(r));
  memo = {paid, bal, _journal: null, get journal() { return this._journal ||= buildJournal(); },
    _stock: null, get stock() { return this._stock ||= stockCalc(); }};
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
let cloudReachable = false, localMergePending = false, mergeBusy = false, mergeAgain = false, mergeNote = '';
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
    if (localMergePending && !dirty) finishLocalMerge();
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
  // Penggabungan data tanpa akun yang tertolak diulang di atas versi server terbaru
  if (localMergePending) {
    localMergePending = false; mergeAgain = true;
    if (!mergeBusy) mergeLocalData();
    return;
  }
  toast('Data diubah di perangkat lain. Versi server dipakai; perubahan Anda disimpan sebagai salinan (Atur → Akun).');
}

/* ---------- Penggabungan data mode tanpa akun ke akun ----------
   Data tanpa akun otomatis masuk ke akun saat pengguna masuk. Data di perangkat baru dihapus setelah server
   mengonfirmasi tersimpan, dan penggabungan aman diulang: yang sudah masuk tidak akan tergandakan. */
const hasBooks = s => !!(s.tx.length || s.debts.length || s.accounts.some(a => a.opening) || s.items.length || s.vendors.length || s.employees.length);
const hasData = s => !!(hasBooks(s) || s.audit.length || s.company.name || s.company.logo);

function mergeStates(A, L) {
  const stats = {tx: 0, debts: 0, accounts: 0, categories: 0, renumbered: 0, closed: 0, items: 0, vendors: 0, employees: 0, trades: 0, payrolls: 0};
  // Akun server belum berisi pembukuan: seluruh data perangkat dipakai apa adanya
  if (!hasBooks(A)) {
    const S = structuredClone(L);
    S.security = A.security;
    for (const k of Object.keys(PROFILE)) if (A.company[k] && !S.company[k]) S.company[k] = A.company[k];
    const seen = new Set(S.audit.map(auditKey));
    A.audit.forEach(a => { if (!seen.has(auditKey(a))) S.audit.push(a); });
    S.audit.sort((a, b) => a.ts.localeCompare(b.ts));
    stats.tx = L.tx.length; stats.debts = L.debts.length;
    return {merged: S, stats};
  }
  const S = structuredClone(A), norm = s => String(s).trim().toLowerCase();
  const closed = date => !!S.lockedUntil && date <= S.lockedUntil;
  const usedCats = new Set([...L.tx.map(t => t.categoryId), ...L.debts.map(d => d.categoryId)]);
  const catMap = new Map(), accMap = new Map();

  for (const c of L.categories) {
    const same = S.categories.find(x => x.id === c.id)
      || S.categories.find(x => x.type === c.type && x.code === c.code && norm(x.name) === norm(c.name));
    if (same) catMap.set(c.id, same.id);
    else if (usedCats.has(c.id)) { S.categories.push({...c}); catMap.set(c.id, c.id); stats.categories++; }
  }
  for (const a of L.accounts) {
    const used = a.opening || L.tx.some(t => t.accountId === a.id || t.toAccountId === a.id);
    if (!used) continue;
    const copyId = ('lokal-' + a.id).slice(0, 40);
    const copy = S.accounts.find(x => x.id === copyId);
    if (copy) { accMap.set(a.id, copy.id); continue; }
    const same = S.accounts.find(x => x.code === a.code && norm(x.name) === norm(a.name));
    if (same && (same.opening === a.opening || !a.opening || !same.opening)) {
      if (!same.opening && a.opening) { same.opening = a.opening; if (S.lockedUntil) stats.closed++; }
      accMap.set(a.id, same.id);
    } else {
      // Saldo awal berbeda: dibuat akun terpisah agar tidak ada saldo yang hilang atau tertimpa
      S.accounts.push({...a, id: copyId, name: `${a.name} (dari perangkat)`.slice(0, 120)});
      accMap.set(a.id, copyId); stats.accounts++;
    }
  }
  const ids = new Set(S.tx.map(t => t.id)), refs = new Set(S.tx.map(t => t.ref).filter(Boolean));
  for (const t of L.tx) {
    if (ids.has(t.id)) continue;
    const x = {...t, accountId: accMap.get(t.accountId) ?? t.accountId,
      toAccountId: t.toAccountId ? accMap.get(t.toAccountId) ?? t.toAccountId : null,
      categoryId: t.categoryId ? catMap.get(t.categoryId) ?? t.categoryId : null};
    if (x.ref && refs.has(x.ref)) {
      let n = 1; const base = x.ref.slice(0, 35);
      while (refs.has(`${base}-P${n}`)) n++;
      x.ref = `${base}-P${n}`; stats.renumbered++;
    }
    if (x.ref) refs.add(x.ref);
    if (closed(x.date)) stats.closed++;
    S.tx.push(x); stats.tx++;
  }
  const debtIds = new Set(S.debts.map(d => d.id));
  for (const d of L.debts) {
    if (debtIds.has(d.id)) continue;
    if (closed(d.date)) stats.closed++;
    S.debts.push({...d, categoryId: catMap.get(d.categoryId) ?? d.categoryId}); stats.debts++;
  }
  // Barang, vendor, dan karyawan yang sama dipersatukan; stok awal yang berbeda dibuat terpisah agar tidak tertimpa
  const itemMap = new Map(), venMap = new Map(), empMap = new Map();
  const noEmployees = !S.employees.length, noTrades = !S.trades.length;
  for (const i of L.items) {
    const copyId = ('lokal-' + i.id).slice(0, 40), copy = S.items.find(x => x.id === copyId);
    if (copy) { itemMap.set(i.id, copy.id); continue; }
    const same = S.items.find(x => x.id === i.id) || S.items.find(x => x.kind === i.kind && norm(x.name) === norm(i.name));
    if (same && (!i.openQty || !same.openQty || (same.openQty === i.openQty && same.openCost === i.openCost))) {
      if (!same.openQty && i.openQty) { same.openQty = i.openQty; same.openCost = i.openCost; if (S.lockedUntil) stats.closed++; }
      itemMap.set(i.id, same.id);
    } else if (same) {
      S.items.push({...i, id: copyId, name: `${i.name} (dari perangkat)`.slice(0, 120)});
      itemMap.set(i.id, copyId); stats.items++;
    } else { S.items.push({...i}); stats.items++; }
  }
  for (const v of L.vendors) {
    const same = S.vendors.find(x => x.id === v.id) || S.vendors.find(x => norm(x.name) === norm(v.name));
    if (same) venMap.set(v.id, same.id); else { S.vendors.push({...v}); stats.vendors++; }
  }
  for (const e of L.employees) {
    const same = S.employees.find(x => x.id === e.id) || S.employees.find(x => e.nik ? x.nik === e.nik : norm(x.name) === norm(e.name));
    if (same) empMap.set(e.id, same.id); else { S.employees.push({...e}); stats.employees++; }
  }
  if (noEmployees && L.employees.length) S.hr = {...L.hr};
  if (noTrades && L.trades.length) S.tax = {...L.tax};
  const tradeIds = new Set(S.trades.map(t => t.id));
  for (const t of L.trades) {
    if (tradeIds.has(t.id)) continue;
    const linked = L.tx.find(x => x.tradeId === t.id);
    let ref = (linked ? S.tx.find(x => x.id === linked.id)?.ref : null) || t.ref;
    if (S.trades.some(x => x.ref === ref)) {
      let n = 1; const base = ref.slice(0, 35);
      while (S.trades.some(x => x.ref === `${base}-P${n}`)) n++;
      ref = `${base}-P${n}`; stats.renumbered++;
      S.debts.forEach(d => { if (d.tradeId === t.id) d.ref = ref; });
    }
    if (closed(t.date)) stats.closed++;
    S.trades.push({...t, ref, vendorId: t.vendorId ? venMap.get(t.vendorId) ?? t.vendorId : null,
      accountId: t.accountId ? accMap.get(t.accountId) ?? t.accountId : null,
      lines: t.lines.map(l => ({...l, itemId: itemMap.get(l.itemId) ?? l.itemId}))});
    stats.trades++;
  }
  const retIds = new Set(S.returns.map(r => r.id)), adjIds = new Set(S.adjusts.map(x => x.id));
  for (const r of L.returns) {
    if (retIds.has(r.id)) continue;
    if (closed(r.date)) stats.closed++;
    S.returns.push({...r, accountId: r.accountId ? accMap.get(r.accountId) ?? r.accountId : null, lines: r.lines.map(l => ({...l, itemId: itemMap.get(l.itemId) ?? l.itemId}))});
    stats.trades++;
  }
  for (const x of L.adjusts) {
    if (adjIds.has(x.id)) continue;
    if (closed(x.date)) stats.closed++;
    S.adjusts.push({...x, lines: x.lines.map(l => ({...l, itemId: itemMap.get(l.itemId) ?? l.itemId}))});
    stats.trades++;
  }
  const payIds = new Set(S.payrolls.map(p => p.id));
  for (const p of L.payrolls) {
    if (payIds.has(p.id)) continue;
    const linked = L.tx.find(x => x.payrollId === p.id), ref = linked ? S.tx.find(x => x.id === linked.id)?.ref : null;
    if (closed(p.date)) stats.closed++;
    S.payrolls.push({...p, ref: ref || p.ref, accountId: accMap.get(p.accountId) ?? p.accountId,
      lines: p.lines.map(l => ({...l, empId: empMap.get(l.empId) ?? l.empId}))});
    stats.payrolls++;
  }
  mergeErp(S, L, {itemMap, venMap, empMap, accMap, catMap});
  for (const k of ['name', 'tagline', 'logo', 'address', 'npwp', 'nib', 'phone', 'email', 'preparedName', 'checkedName', 'taxYear', 'bankInfo', 'invoiceNote'])
    if (!S.company[k] && L.company[k]) S.company[k] = L.company[k];
  const seen = new Set(S.audit.map(auditKey));
  L.audit.forEach(a => { if (!seen.has(auditKey(a))) S.audit.push(a); });
  S.audit.sort((a, b) => a.ts.localeCompare(b.ts));
  return {merged: S, stats};
}
const auditKey = a => [a.ts, a.id, a.act, a.info].join('|');

function clearLocalStore() { localStorage.removeItem(KEY); localStorage.removeItem(KEY + '-meta'); }
function finishLocalMerge() {
  localMergePending = false;
  clearLocalStore();
  toast('Data dari perangkat ini sudah tersimpan di akun Anda. ' + mergeNote);
  mergeNote = '';
  renderAll();
}
async function mergeLocalData() {
  if (mergeBusy || !cloudUser || !cloudReachable || !state || company) return;
  const raw = localStorage.getItem(KEY);
  if (!raw) return;
  mergeBusy = true; mergeAgain = false;
  try {
    let d = JSON.parse(raw), localVault = null;
    if (isEnvelope(d)) {
      const env = d, salt = fromB64(env.salt), iter = envIter(env);
      for (;;) {
        const pw = await askPassword({title: 'Kata sandi data di perangkat ini',
          hint: 'Data tanpa akun di perangkat ini terenkripsi. Masukkan kata sandinya agar bisa digabung ke akun Anda. Bila dibatalkan, data tetap aman dan bisa digabung nanti.'});
        if (pw === null) return;
        try { const key = await deriveKey(pw, salt, iter); d = await unseal(key, env); localVault = {key, salt, iter}; break; }
        catch { toast('Kata sandi salah'); }
      }
    }
    const L = sanitizeState(d);
    fillLr(L);
    if (!hasData(L)) return clearLocalStore();
    const {merged, stats} = mergeStates(state, L);
    state = merged; state.version = DATA_VERSION; ensureCats(state);
    // Data yang tadinya terenkripsi tidak boleh terkirim ke server tanpa enkripsi
    if (localVault && !vault) { vault = localVault; resetIdle(); }
    const added = stats.tx + stats.debts + stats.accounts + stats.categories + stats.items + stats.vendors + stats.employees + stats.trades + stats.payrolls;
    if (added) log('gabung', 'data', '', `Data tanpa akun digabung ke akun: ${stats.tx} transaksi, ${stats.debts} piutang/utang, ${stats.trades} jual/beli, ${stats.items} barang, ${stats.vendors} vendor, ${stats.employees} karyawan, ${stats.payrolls} penggajian, ${stats.accounts} akun kas/bank baru, ${stats.categories} kategori baru, ${stats.renumbered} no. bukti diberi akhiran -P, ${stats.closed} data masuk periode yang sudah ditutup`);
    localMergePending = true;
    renderAll();
    mergeNote = stats.renumbered || stats.closed || stats.accounts
      ? `Periksa: ${stats.renumbered} no. bukti diberi akhiran -P, ${stats.accounts} akun kas/bank terpisah, ${stats.closed} data masuk periode tertutup (lihat Jejak Audit).` : '';
    await persist();
    await pushNow();
  } catch {
    localMergePending = false;
    toast('Data perangkat belum bisa digabung, tetapi tetap aman di perangkat ini.');
  } finally {
    mergeBusy = false;
    if (currentView === 'dashboard') renderDashboard();
  }
  if (mergeAgain) await mergeLocalData();
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
  if (+d?.version > DATA_VERSION) return location.reload(); // perangkat lain memakai versi aplikasi lebih baru
  try { state = sanitizeState(d); } catch { return; }
  migrate();
  document.querySelectorAll('dialog[open]').forEach(x => x.close());
  renderAll(); setSync('Tersinkron dengan perangkat lain'); if (!force) toast('Data diperbarui dari perangkat lain');
}

function persist() {
  if (company) return companyPersist();
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

/* ---------- Keluar otomatis ----------
   Akun keluar sendiri setelah 1 jam tidak dipakai, termasuk bila aplikasi ditutup selama itu. Perubahan yang belum sampai
   ke server tidak boleh hilang, jadi keluar ditunda sampai semuanya terkirim. */
let lastMark = 0, idleBusy = false, idleWarned = false;
const lastActive = () => { try { return +localStorage.getItem(ACTIVE_KEY) || 0; } catch { return 0; } };
const idleExpired = () => lastActive() > 0 && Date.now() - lastActive() >= IDLE_LOGOUT_MS;
function markActive(force) {
  const now = Date.now();
  idleWarned = false;
  if (!force && now - lastMark < 30000) return;
  lastMark = now;
  try { localStorage.setItem(ACTIVE_KEY, String(now)); } catch {}
}
const companyCopies = () => Object.keys(localStorage).filter(k => k.startsWith(KEY + ':co:'));
function leaveDevice() {
  [storeKey, metaKey(), LAST_UID_KEY, ACTIVE_KEY, ...conflictKeys(), ...companyCopies()].forEach(k => localStorage.removeItem(k));
  try { sessionStorage.setItem(IDLE_NOTE_KEY, '1'); } catch {}
  location.reload();
}
async function idleLogout() {
  if (idleBusy || !cloudUser || !navigator.onLine) return;
  idleBusy = true;
  try {
    if (dirty) await pushNow();
    if (dirty || !await Cloud.flush()) return; // dicoba lagi pada pemeriksaan berikutnya
    await Cloud.signOut();
    leaveDevice();
  } catch {} finally { idleBusy = false; }
}
function idleTick() {
  if (!cloudUser) return;
  const idle = Date.now() - lastActive();
  if (idle >= IDLE_LOGOUT_MS) idleLogout();
  else if (idle >= IDLE_LOGOUT_MS - IDLE_WARN_MS && !idleWarned) { idleWarned = true; toast('Tidak ada aktivitas. Akun keluar otomatis dalam 2 menit.'); }
}
function armIdleLogout() {
  markActive(true);
  if (armIdleLogout.done) return;
  armIdleLogout.done = true;
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(ev => addEventListener(ev, () => markActive(), {passive: true}));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) idleTick(); });
  // Keluar di satu tab ikut mengeluarkan tab lain
  addEventListener('storage', e => { if (e.key === ACTIVE_KEY && e.newValue === null && cloudUser) location.reload(); });
  setInterval(idleTick, 30000);
}
// Aplikasi dibuka lagi setelah lebih dari 1 jam; true bila akun berhasil dikeluarkan
async function idleLogoutAtStart(user) {
  if (!idleExpired() || !navigator.onLine) return false;
  storeKey = KEY + ':' + user.uid;
  try {
    const r = await Cloud.pull(), local = localStorage.getItem(storeKey);
    if (local && (!r || readMeta().updatedAt > r.updatedAt)) return false; // ada perubahan belum terkirim: buka dulu agar tersimpan
    if (!await Cloud.flush()) return false;
    await Cloud.signOut();
    leaveDevice();
    return true;
  } catch { return false; }
}

/* ---------- Pengaturan keamanan ---------- */
function renderSecurity() {
  if (company) { $('secStatus').innerHTML = '<div class="notice">Data perusahaan dipakai bersama sehingga tidak memakai kata sandi enkripsi perangkat. Aksesnya dijaga peran anggota di server.</div>'; ['btnSetPw', 'btnRemovePw', 'btnLockNow'].forEach(id => $(id).style.display = 'none'); $('secAuto').disabled = true; return; }
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
  state.items.forEach(i => { if (i.kind === 'barang') add('', 'SA', 'Stok awal ' + i.name, ACC_PERSEDIAAN, ACC_OPENING, Math.round(i.openQty * i.openCost), 'saldo'); });
  // Harga pokok diakui saat barang terjual: persediaan berkurang, beban HPP bertambah
  const {cogs, svc, rcost, rsvc, rdiff, adj} = M().stock;
  state.returns.forEach(r => {
    const o = state.trades.find(t => t.id === r.origId); if (!o) return;
    const pay = retPay(r), d = 'Retur ' + o.ref;
    if (r.kind === 'sale') {
      const rev = catAcc(tradeCat(o)?.id);
      add(r.date, r.ref, d, rev, r.settle === 'cash' ? cashAcc(r.accountId) : ACC_PIUTANG, pay, 'retur');
      if (!r.wapu) add(r.date, r.ref, 'PPN retur ' + o.ref, ACC_PPN, rev, r.ppn, 'retur');
      add(r.date, r.ref, 'PPh retur ' + o.ref, rev, ACC_KREDIT_PPH, r.pph, 'retur');
      add(r.date, r.ref, 'Harga pokok retur ' + o.ref, ACC_PERSEDIAAN, ACC_HPP, rcost.get(r.id) || 0, 'retur');
    } else {
      add(r.date, r.ref, d, r.settle === 'cash' ? cashAcc(r.accountId) : ACC_UTANG, ACC_PERSEDIAAN, pay, 'retur');
      if (r.wapu) add(r.date, r.ref, 'PPN retur ' + o.ref, ACC_PPN_WAPU, ACC_PERSEDIAAN, r.ppn, 'retur');
      add(r.date, r.ref, 'PPh retur ' + o.ref, ACC_PPH_POT, ACC_PERSEDIAAN, r.pph, 'retur');
      if (r.ppnCredit) add(r.date, r.ref, 'PPN masukan retur ' + o.ref, ACC_PERSEDIAAN, ACC_PPN_IN, r.ppn, 'retur');
      add(r.date, r.ref, 'Beban jasa retur ' + o.ref, ACC_PERSEDIAAN, ACC_BEBAN_JASA, rsvc.get(r.id) || 0, 'retur');
      const v = rdiff.get(r.id) || 0;
      if (v > 0) add(r.date, r.ref, 'Selisih retur ' + o.ref, ACC_HPP, ACC_PERSEDIAAN, v, 'retur');
      else add(r.date, r.ref, 'Selisih retur ' + o.ref, ACC_PERSEDIAAN, ACC_HPP, -v, 'retur');
    }
  });
  erpJournal(add);
  state.adjusts.forEach(a => {
    const v = adj.get(a.id) || 0;
    if (v < 0) add(a.date, a.ref, 'Stok opname: kekurangan', ACC_SELISIH, ACC_PERSEDIAAN, -v, 'opname');
    else add(a.date, a.ref, 'Stok opname: kelebihan', ACC_PERSEDIAAN, ACC_SELISIH, v, 'opname');
  });
  for (const m of ppnMasa()) add(lastDayOf(m.ym), 'PPN-' + m.ym.slice(2, 4) + m.ym.slice(5), 'Kompensasi PPN masa ' + ymLabel(m.ym), ACC_PPN, ACC_PPN_IN, m.offset, 'pajak');
  state.trades.forEach(t => {
    if (t.kind === 'sale') {
      add(t.date, t.ref, 'Harga pokok ' + t.ref, ACC_HPP, ACC_PERSEDIAAN, cogs.get(t.id) || 0, 'hpp');
      // Kas/piutang tercatat sebesar yang benar-benar diterima; pendapatan dikoreksi menjadi DPP
      const rev = catAcc(tradeCat(t)?.id);
      if (!t.wapu) add(t.date, t.ref, 'PPN keluaran ' + t.ref, rev, ACC_PPN, t.ppn, 'pajak');
      add(t.date, t.ref, 'PPh dipotong pembeli ' + t.ref, ACC_KREDIT_PPH, rev, t.pph, 'pajak');
    } else {
      if (t.wapu) add(t.date, t.ref, 'PPN dipungut (WAPU) ' + t.ref, ACC_PERSEDIAAN, ACC_PPN_WAPU, t.ppn, 'pajak');
      add(t.date, t.ref, 'PPh dipotong/dipungut ' + t.ref, ACC_PERSEDIAAN, ACC_PPH_POT, t.pph, 'pajak');
      if (t.ppnCredit) add(t.date, t.ref, 'PPN masukan ' + t.ref, ACC_PPN_IN, ACC_PERSEDIAAN, t.ppn, 'pajak');
      add(t.date, t.ref, 'Beban jasa ' + t.ref, ACC_BEBAN_JASA, ACC_PERSEDIAAN, svc.get(t.id) || 0, 'hpp');
    }
  });
  state.payrolls.forEach(p => {
    const s = paySum(p), gaji = catAcc(sysCat('5-201')?.id), cash = cashAcc(p.accountId), desc = 'Gaji ' + ymLabel(p.period);
    add(p.date, p.ref, desc, gaji, cash, s.net, 'gaji');
    if (s.pph >= 0) add(p.date, p.ref, 'PPh 21 ' + ymLabel(p.period), gaji, ACC_PPH21, s.pph, 'gaji');
    else add(p.date, p.ref, 'Kelebihan PPh 21 ' + ymLabel(p.period), ACC_PPH21, gaji, -s.pph, 'gaji');
    add(p.date, p.ref, 'Iuran BPJS bagian karyawan ' + ymLabel(p.period), gaji, ACC_BPJS, s.ee, 'gaji');
    add(p.date, p.ref, 'Iuran BPJS bagian perusahaan ' + ymLabel(p.period), ACC_BEBAN_BPJS, ACC_BPJS, s.co, 'gaji');
    add(p.date, p.ref, 'Potongan kasbon ' + ymLabel(p.period), gaji, ACC_KASBON, s.deduct, 'gaji');
  });
  const debtById = new Map(state.debts.map(d => [d.id, d]));
  state.debts.forEach(d => {
    const c = catAcc(d.categoryId), desc = `${d.kind === 'piutang' ? 'Faktur kepada' : 'Tagihan dari'} ${d.party}${d.desc ? ' · ' + d.desc : ''}`;
    if (d.kind === 'piutang') add(d.date, d.ref, desc, ACC_PIUTANG, c, d.amount, 'faktur');
    else add(d.date, d.ref, desc, c, ACC_UTANG, d.amount, 'faktur');
  });
  state.tx.forEach(t => {
    if (t.payrollId || t.returnId) return; // sudah dijurnal lengkap dari data penggajian/retur
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
    for (const t of state.tx) if (inRange(t.date, from, to) && inLR(t) && !t.payrollId && !t.returnId)
      put(t.type === 'in' ? ins : outs, t.categoryId, catLabel(t.categoryId), t.amount);
    for (const t of state.trades) if (inRange(t.date, from, to)) {
      if (t.kind === 'purchase') { put(outs, accKey(ACC_BEBAN_JASA), accHTML(ACC_BEBAN_JASA), M().stock.svc.get(t.id) || 0); continue; }
      put(outs, accKey(ACC_HPP), accHTML(ACC_HPP), M().stock.cogs.get(t.id) || 0);
      const c = tradeCat(t);
      put(ins, c?.id, catLabel(c?.id), t.pph - (t.wapu ? 0 : t.ppn));
    }
    const st = M().stock;
    for (const r of state.returns) if (inRange(r.date, from, to)) {
      const o = state.trades.find(t => t.id === r.origId), c = o && tradeCat(o);
      if (r.kind === 'sale') { put(ins, c?.id, catLabel(c?.id), -r.dpp); put(outs, accKey(ACC_HPP), accHTML(ACC_HPP), -(st.rcost.get(r.id) || 0)); }
      else { put(outs, accKey(ACC_BEBAN_JASA), accHTML(ACC_BEBAN_JASA), -(st.rsvc.get(r.id) || 0)); put(outs, accKey(ACC_HPP), accHTML(ACC_HPP), st.rdiff.get(r.id) || 0); }
    }
    for (const a of state.adjusts) if (inRange(a.date, from, to)) put(outs, accKey(ACC_SELISIH), accHTML(ACC_SELISIH), -(st.adj.get(a.id) || 0));
    for (const p of state.payrolls) if (inRange(p.date, from, to)) {
      const s = paySum(p), g = sysCat('5-201');
      put(outs, g?.id, catLabel(g?.id), s.net + s.pph + s.ee + s.deduct);
      put(outs, accKey(ACC_BEBAN_BPJS), accHTML(ACC_BEBAN_BPJS), s.co);
    }
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
  const hpp = outs.get(accKey(ACC_HPP))?.v || 0;
  const I = list(ins), O = list(outs);
  const ti = I.reduce((s, r) => s + r.v, 0), to_ = O.reduce((s, r) => s + r.v, 0);
  return {ins: I, outs: O, opex: O.filter(r => r !== outs.get(accKey(ACC_HPP))), hpp, ti, to: to_, net: ti - to_};
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
function showView(view) {
  currentView = view;
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  // Tombol tambah transaksi hanya di halaman yang memakainya
  const tx = !['hr', 'viewer'].includes(company?.role);
  $('btnAdd').style.display = tx && view === 'transaksi' ? '' : 'none';
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  showView(b.dataset.view);
  renderView(currentView);
  rememberView();
  window.scrollTo(0, 0);
});
// Halaman dan tab yang terbuka diingat selama sesi, sehingga refresh kembali ke tempat yang sama
function rememberView() {
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify({view: currentView, trade: tradeTab, hr: hrTab, report: $('rType').value})); } catch {}
}
function restoreView() {
  let s = null;
  try { s = JSON.parse(sessionStorage.getItem(VIEW_KEY)); } catch {}
  if (['trades', 'items', 'vendors', 'tax'].includes(s?.trade)) tradeTab = s.trade;
  if (['emp', 'pay', 'rules', 'att', 'leave', 'kas', 'doc', 'rev', 'shift'].includes(s?.hr)) hrTab = s.hr;
  if ([...$('rType').options].some(o => o.value === s?.report)) $('rType').value = s.report;
  showView(Object.hasOwn(VIEWS, s?.view) ? s.view : currentView);
}
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
  out.push(...bizObligations());
  const suggestedLock = lastDayOf(addMonths(ym, -2));
  if (state.tx.length && (!state.lockedUntil || state.lockedUntil < suggestedLock))
    out.push(['warn', `Belum tutup buku s.d. ${fmtDate(suggestedLock)}. Tutup buku mencegah data periode lalu berubah setelah dilaporkan. <button class="btn sm" data-act="goLock">Tutup buku</button>`]);
  return out;
}

/* ---------- Dasbor ---------- */
function renderDashboard() {
  const notices = [];
  const manager = !company || canApprove(); // pengingat pengaturan hanya untuk pimpinan dan keuangan
  if (manager && !state.company.name) notices.push('<div class="notice">Lengkapi nama, slogan, dan logo perusahaan untuk kop laporan. <button class="btn sm" data-act="goProfile">Isi profil</button></div>');
  if (!company && hasCrypto && !vault) notices.push('<div class="notice">Data belum dilindungi kata sandi. <button class="btn sm" data-act="goSecurity">Pasang sekarang</button></div>');
  if (manager && state.tx.length && (!state.lastBackup || daysBetween(state.lastBackup, today()) > 7))
    notices.push(`<div class="notice">${state.lastBackup ? 'Backup terakhir ' + fmtDate(state.lastBackup) + '.' : 'Data belum pernah di-backup.'} <button class="btn sm" data-act="backup">Backup sekarang</button></div>`);
  if (cloudUser && !localMergePending && !mergeBusy && localStorage.getItem(KEY))
    notices.push(`<div class="notice">Ada data dari mode tanpa akun yang belum masuk ke akun ini. Data tetap aman di perangkat. <button class="btn sm" data-act="mergeLocal">Gabungkan sekarang</button></div>`);
  const used = (localStorage.getItem(storeKey) || '').length;
  if (used > STORE_WARN) notices.push(`<div class="notice">Penyimpanan perangkat hampir penuh (${Math.round(used / 50000)}%). Unduh backup, lalu arsipkan data tahun lama agar penyimpanan tidak gagal. <button class="btn sm" data-act="backup">Backup sekarang</button></div>`);
  if (cloudUser && conflictKeys().length) notices.push(`<div class="notice">Ada ${conflictKeys().length} salinan data dari konflik sinkron. Periksa di Atur → Akun.</div>`);
  $('dashNotices').innerHTML = notices.join('');
  if (renderRoleDash()) return;

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
    ...(state.trades.length || state.items.length ? [
      [`Laba Kotor ${esc(year)}`, rp(lr.ti - lr.hpp), lr.ti - lr.hpp >= 0 ? 'in' : 'out', `HPP ${rp(lr.hpp)}`],
      ['Nilai Persediaan', rp(stockValue()), '', `${state.items.filter(i => i.kind === 'barang').length} jenis barang`],
    ] : []),
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
  fillSelect($('txCat'), state.categories.filter(c => c.type === t && manualCat(c, editing?.categoryId)));
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
  const linked = editing && (editing.tradeId || editing.payrollId || editing.returnId || editing.kasbonId);
  const locked = editing && (isLocked(editing.date) || !!linked);
  $('txLink').style.display = debt || locked ? '' : 'none';
  $('txLink').textContent = [linked ? `Transaksi ini dibuat otomatis dari menu ${editing.payrollId || editing.kasbonId ? 'Karyawan' : 'Jual/Beli'}; ubah atau hapus dari sana.` : locked ? lockMsg() : '', debt ? `Pembayaran ${KIND_LABEL[debt.kind].toLowerCase()} — ${debt.party}${debt.ref ? ' · ' + debt.ref : ''}` : ''].filter(Boolean).join(' ');
  document.querySelectorAll('#txTypeSeg button').forEach(b => b.disabled = !!debt || locked);
  $('txDialogTitle').textContent = editing ? (locked ? 'Detail Transaksi' : 'Ubah Transaksi') : 'Transaksi Baru';
  $('txAmount').value = t.amount ? t.amount.toLocaleString('id-ID') : '';
  $('txDesc').value = t.desc || '';
  fillSelect($('txCenter'), state.centers, 'Tanpa pusat biaya');
  $('txCenterWrap').style.display = state.centers.length ? '' : 'none';
  $('txCenter').value = t.centerId || '';
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
  if (!editing || isLocked(editing.date) || editing.tradeId || editing.payrollId || editing.returnId || editing.kasbonId) return toast(lockMsg());
  const reason = askReason('menghapus transaksi'); if (!reason) return;
  log('hapus', 'transaksi', editing.id, `${txSummary(editing)} · alasan: ${reason}`);
  state.tx = state.tx.filter(t => t !== editing);
  $('txDialog').close(); save(); toast('Transaksi dihapus (tercatat di jejak audit)');
};
$('txForm').onsubmit = e => {
  const amount = parseNum($('txAmount').value), date = $('txDate').value;
  const fail = msg => { e.preventDefault(); toast(msg); };
  if (editing && (isLocked(editing.date) || editing.tradeId || editing.payrollId || editing.returnId || editing.kasbonId)) return fail(lockMsg());
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
    centerId: $('txCenter').value || undefined,
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
const paidOf = (d, upTo) => upTo ? debtTx(d, upTo).reduce((s, t) => s + t.amount, 0) + state.returns.reduce((s, r) => r.debtId === d.id && r.date <= upTo ? s + retPay(r) : s, 0) : (M().paid.get(d.id) || 0);
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
  fillSelect($('dCat'), state.categories.filter(c => c.type === (k === 'piutang' ? 'in' : 'out') && manualCat(c, editingDebt?.categoryId)));
}
document.querySelectorAll('#debtKindSeg button').forEach(b => b.onclick = () => setDebtKind(b.dataset.k));
moneyInput($('dAmount'));

function openDebt(id) {
  editingDebt = id ? state.debts.find(d => d.id === id) : null;
  const d = editingDebt || {kind: debtKind, date: today()};
  setDebtKind(d.kind);
  const pays = editingDebt ? debtTx(editingDebt).sort((a, b) => a.date.localeCompare(b.date)) : [];
  const fromTrade = !!editingDebt?.tradeId;
  const locked = editingDebt && (isLocked(editingDebt.date) || fromTrade);
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
  $('debtPayments').innerHTML = (locked ? `<div class="notice">${esc(fromTrade ? 'Data ini dibuat otomatis dari menu Jual/Beli; ubah atau hapus dari sana.' : lockMsg())}</div>` : '') + (!editingDebt ? '' : `<h3 style="font-size:13px;margin:0 0 6px">Riwayat pembayaran</h3>` + (pays.length
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
  if (editingDebt && (isLocked(editingDebt.date) || editingDebt.tradeId)) return fail(lockMsg());
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
  if (!editingDebt || isLocked(editingDebt.date) || editingDebt.tradeId) return toast(lockMsg());
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
    ${L.hpp ? `<tr><td style="padding-left:24px">${accHTML(ACC_HPP)}</td><td class="num">(${rp(L.hpp)})</td></tr>
    <tr><td><b>Laba Kotor</b></td><td class="num"><b>${rp(L.ti - L.hpp)}</b></td></tr>` : ''}
    <tr class="sect"><td colspan="2">Beban</td></tr>${rows(L.opex)}
    <tr><td><b>Total Beban</b></td><td class="num"><b>(${rp(L.to - L.hpp)})</b></td></tr>
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
    ${state.items.some(i => i.kind === 'barang') ? `<li><b>Persediaan</b> dicatat sebesar biaya perolehan dengan metode rata-rata tertimbang (moving average). Nilai per ${fmtDate(N.asOf)}: ${rp(stockValue(N.asOf))}.</li>` : ''}
    <li><b>Aset tetap</b> dicatat sebesar biaya perolehan. Aset yang didaftarkan di menu ERP → Aset disusutkan otomatis dengan metode garis lurus.</li>
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
  $('rFromWrap').style.display = ['umur', 'neraca', 'ns', 'stok', 'sdm'].includes(type) ? 'none' : '';
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
  html ||= bizReport(type, from, to, period) || erpReport(type, from, to, period) || moreReport(type, from, to, period);
  $('reportOut').innerHTML = html + (type !== 'audit' ? footerNote() : '');
}
['rType', 'rFrom', 'rTo', 'rAcc'].forEach(id => $(id).oninput = renderReport);
$('rType').addEventListener('input', () => rememberView());
$('rType').addEventListener('change', () => { if (['umur', 'neraca', 'ns', 'stok', 'sdm'].includes($('rType').value) && $('rTo').value > today()) { $('rTo').value = today(); renderReport(); } });
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
  pPph: 'pphRate', pEntity: 'entity', pTaxYear: 'taxYear', pBasis: 'basis', pBank: 'bankInfo', pInvNote: 'invoiceNote', pNitku: 'nitku'};
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
    box.innerHTML = `<div class="notice">Anda memakai aplikasi <b>tanpa akun</b>; data hanya ada di perangkat ini. Saat masuk ke akun, semua data ini otomatis tersimpan dan tersinkron ke akun tersebut.</div>
      <button class="btn primary" data-act="goLogin">Masuk / Daftar akun</button>`;
    return;
  }
  const conflicts = conflictKeys();
  box.innerHTML = `<div>Masuk sebagai <b>@${esc(cloudInfo.username || '—')}</b></div>
    <div class="muted" style="font-size:12px">${cloudInfo.google ? 'Akun Google · ' + esc(cloudInfo.email || '') : 'Akun username & kata sandi'}</div>
    <div class="muted" id="syncStatus" style="margin:8px 0">${esc(syncMsg)}</div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Akun keluar otomatis setelah 1 jam tidak dipakai.</div>
    <div class="muted" style="font-size:12px;margin-bottom:10px">${vault
      ? 'Data dienkripsi di perangkat sebelum dikirim, sehingga server pun tidak bisa membacanya.'
      : 'Tips: pasang kata sandi di kartu Keamanan agar data dienkripsi sebelum dikirim ke server.'}</div>
    ${conflicts.length ? `<div class="notice">Salinan dari konflik sinkron (data perangkat ini yang tidak terkirim): ${conflicts.map(k => `<button class="btn sm" data-act="dlConflict" data-id="${esc(k.split('-konflik-')[1])}">${esc(new Date(+k.split('-konflik-')[1]).toLocaleString('id-ID'))}</button>`).join(' ')} <button class="btn sm danger" data-act="clearConflicts">Hapus salinan</button></div>` : ''}
    ${companyBoxHTML()}
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
    const code = isSysCat(c) ? c.code : prompt('Kode akun (1 aset, 2 liabilitas, 3 ekuitas, 4 pendapatan, 5 beban):', c.code); if (code === null) return;
    const name = prompt('Nama kategori:', c.name); if (name === null) return;
    const before = `${c.code} ${c.name}`;
    c.code = code.trim().slice(0, 20); c.name = name.trim().slice(0, 120) || c.name;
    log('ubah', 'kategori', c.id, `${before} ⇒ ${c.code} ${c.name}`); save();
  },
  delCat: id => {
    if (state.tx.some(t => t.categoryId === id) || state.debts.some(d => d.categoryId === id)) return toast('Kategori masih dipakai, tidak bisa dihapus');
    const c = catOf(id);
    if (isSysCat(c)) return toast('Kategori ini dipakai sistem jual beli dan penggajian, tidak bisa dihapus');
    if (confirm('Hapus kategori ini?')) { log('hapus', 'kategori', id, `${c?.code} ${c?.name}`); state.categories = state.categories.filter(x => x.id !== id); save(); }
  },
  print: () => window.print(),
  reportCsv,
  backup: () => $('btnBackup').click(),
  goLogin: () => { localStorage.removeItem(MODE_KEY); location.reload(); },
  mergeLocal: () => mergeLocalData(),
  goLock: () => { goView('pengaturan'); $('lockDate').focus(); $('lockDate').scrollIntoView({block: 'center'}); },
  syncNow: async () => { if (!cloudUser) return; if (company) return companyPersist(); dirty = true; await pushNow(); },
  dlConflict: ts => { const raw = localStorage.getItem(`${storeKey}-konflik-${ts}`); if (raw) download(raw, `salinan-konflik-${ts}.json`, 'application/json'); },
  clearConflicts: () => { if (confirm('Hapus semua salinan konflik di perangkat ini?')) { conflictKeys().forEach(k => localStorage.removeItem(k)); renderAll(); } },
  logout: async () => {
    if (!confirm('Keluar dari akun? Salinan data di perangkat ini dihapus; data tetap aman di server dan muncul lagi saat Anda masuk.')) return;
    if (dirty) await pushNow();
    const unsent = dirty || (company && !await Cloud.flush());
    if (unsent && !confirm('Ada perubahan yang BELUM tersimpan ke server (offline?). Tetap keluar dan buang perubahan itu?')) return;
    await Cloud.signOut().catch(() => {});
    [storeKey, metaKey(), LAST_UID_KEY, ACTIVE_KEY, ...conflictKeys()].forEach(k => localStorage.removeItem(k));
    location.reload();
  },
  // Hak penghapusan data pribadi (UU 27/2022 tentang Pelindungan Data Pribadi)
  deleteAccount: async () => {
    if (company) return toast(company.role === 'owner' ? 'Akun pimpinan tidak bisa dihapus selama perusahaan masih aktif.' : 'Keluar dari perusahaan dulu sebelum menghapus akun.');
    if (!confirm('Hapus akun beserta SELURUH data keuangan di server? Tindakan ini tidak bisa dibatalkan. Unduh backup lebih dulu bila masih diperlukan (dokumen pembukuan wajib disimpan 10 tahun).')) return;
    if (prompt(`Ketik username Anda (${cloudInfo.username}) untuk konfirmasi`) !== cloudInfo.username) return toast('Konfirmasi tidak cocok');
    try {
      await Cloud.deleteAccount(cloudInfo.username);
      [storeKey, metaKey(), LAST_UID_KEY, ACTIVE_KEY, ...conflictKeys()].forEach(k => localStorage.removeItem(k));
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
  if (isSysCat(c)) { el.checked = c.lr !== false; return toast('Kategori sistem tidak bisa diubah'); }
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
  // Backup perusahaan memuat data karyawan, jadi wajib dikunci dengan kata sandi
  let lock = vault;
  if (company) {
    const pw = await askPassword({title: 'Kata sandi file backup', confirm: true, hint: `Minimal ${MIN_PW} karakter. Simpan baik-baik: file ini tidak bisa dibuka tanpa kata sandi ini.`});
    if (pw === null) return;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    lock = {key: await deriveKey(pw, salt, PBKDF2_ITER), salt, iter: PBKDF2_ITER};
  } else if (!vault && !confirm('Kata sandi belum dipasang, sehingga file backup TIDAK terenkripsi dan bisa dibaca siapa pun yang memegang filenya. Lanjutkan?')) return;
  state.lastBackup = today();
  const json = JSON.stringify(state);
  const content = lock ? JSON.stringify(await seal(lock, json)) : JSON.stringify(state, null, 2);
  if (await download(content, `backup-keuangan-${today()}${lock ? '-terenkripsi' : ''}.json`, 'application/json')) save();
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
    if (+d?.version > DATA_VERSION) return toast('Backup ini dari versi aplikasi yang lebih baru. Muat ulang aplikasi dulu.');
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

/* ---------- Jual beli, HPP & persediaan ----------
   HPP memakai rata-rata tertimbang (moving average) dan dihitung ulang dari riwayat, sehingga selalu cocok dengan stok.
   Penjualan/pembelian otomatis membentuk transaksi kas atau piutang/utang, jadi laporan dan sinkron server ikut terbarui. */
const itemOf = id => state.items.find(i => i.id === id);
const vendorOf = id => state.vendors.find(v => v.id === id);
const sysCat = code => state.categories.find(c => c.code === code);
const ymLabel = ym => `${MONTHS_FULL[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const fmtQty = n => (+n).toLocaleString('id-ID', {maximumFractionDigits: 3});
const pct = n => String(Math.round(n * 10) / 10).replace('.', ',') + '%';
// tradeTotal = DPP (harga setelah diskon, sebelum PPN); tradePay = yang benar-benar berpindah tangan setelah PPN, pungutan WAPU, dan potongan PPh
const tradeTotal = t => Math.max(0, Math.round(t.lines.reduce((s, l) => s + l.qty * l.price, 0)) - t.discount + t.extra);
const tradePay = t => tradeTotal(t) + (t.wapu ? 0 : t.ppn) - t.pph;
const retPay = r => r.dpp + (r.wapu ? 0 : r.ppn) - r.pph;
const tradeCat = t => sysCat(t.kind === 'purchase' ? ACC_PERSEDIAAN.code : t.lines.every(l => itemOf(l.itemId)?.kind === 'jasa') ? '4-102' : '4-101');
const pphRateOf = code => state.tax[{22: 'pph22', 23: 'pph23', '23r': 'pph23r', '42k': 'pph42k', '42s': 'pph42s'}[code]];
function taxCalc(d) {
  const T = state.tax, buy = d.kind === 'purchase', v = buy ? vendorOf(d.vendorId) : null, dpp = tradeTotal(d);
  const sub = d.lines.reduce((s, l) => s + l.qty * l.price, 0) || 1;
  const wapu = buy ? !!v?.wapu : !!d.wapu, charge = buy ? !!v?.pkp : T.pkp, cut = buy ? !v?.noPph && state.company.entity !== 'op' : !!d.cut && !T.skb;
  let ppnBase = 0; const bases = {};
  for (const l of d.lines) {
    const ty = TAX_TYPES[itemOf(l.itemId)?.taxType] || TAX_TYPES.bkp, share = l.qty * l.price * dpp / sub;
    if (ty.ppn) ppnBase += ty.lux ? share : share * T.dppNum / T.dppDen;
    bases[ty.pph] = (bases[ty.pph] || 0) + share;
  }
  const ppn = charge ? Math.floor(Math.round(ppnBase * T.ppnRate) / 100) : 0;
  const pphParts = Object.entries(bases).filter(([code]) => cut && (code !== '22' || wapu))
    .map(([code, b]) => ({code, base: Math.round(b), rate: pphRateOf(code), amt: Math.floor(Math.round(b * pphRateOf(code)) / 100)})).filter(x => x.amt > 0);
  return {ppn, wapu, pph: pphParts.reduce((s, x) => s + x.amt, 0), pphParts, ppnCredit: buy && T.pkp};
}
const partyOf = t => t.kind === 'purchase' ? vendorOf(t.vendorId)?.name || t.party || '—' : t.party || 'Umum';
const tradeSummary = t => `${t.ref} · ${t.date} · ${t.kind === 'sale' ? 'Penjualan' : 'Pembelian'} · ${partyOf(t)} · ${rp(tradeTotal(t))} · ${t.pay === 'cash' ? 'tunai' : 'kredit'}`;
function nextCode(prefix, date, used) {
  const p = `${prefix}-${date.slice(2, 4)}${date.slice(5, 7)}-`;
  let max = 0;
  for (const r of used) if ((r || '').startsWith(p)) max = Math.max(max, parseInt(r.slice(p.length)) || 0);
  return p + String(max + 1).padStart(3, '0');
}

function stockCalc(trades = state.trades, items = state.items, returns = state.returns, adjusts = state.adjusts) {
  const stock = new Map(), cogs = new Map(), svc = new Map(), rcost = new Map(), rsvc = new Map(), rdiff = new Map(), adj = new Map(), lineV = new Map(), neg = new Set();
  items.forEach(i => { if (i.kind === 'barang') stock.set(i.id, {qty: i.openQty, value: Math.round(i.openQty * i.openCost)}); });
  const byId = new Map(trades.map(t => [t.id, t]));
  // Urutan satu hari: pembelian, penjualan, retur jual, retur beli, opname
  const events = [...trades.map(e => ({e, k: e.kind === 'purchase' ? 0 : 1})), ...returns.map(e => ({e, k: e.kind === 'purchase' ? 3 : 2})), ...adjusts.map(e => ({e, k: 4}))]
    .sort((a, b) => a.e.date.localeCompare(b.e.date) || a.k - b.k || a.e.created - b.e.created);
  const r3 = n => Math.round(n * 1000) / 1000;
  const take = (s, id, q) => {
    if (q > s.qty + 1e-9) neg.add(id);
    const v = s.qty > 0 ? Math.round(s.value * Math.min(q, s.qty) / s.qty) : 0;
    s.qty = r3(s.qty - q); s.value -= v;
    return v;
  };
  for (const {e: t, k} of events) {
    if (k === 0) {
      // Diskon, ongkos, dan PPN yang tidak bisa dikreditkan dibagi ke tiap barang sesuai nilainya; sisa pembulatan masuk ke baris terakhir
      const sub = t.lines.reduce((s, l) => s + l.qty * l.price, 0), total = tradeTotal(t) + (t.ppnCredit ? 0 : t.ppn || 0);
      let left = total; const vals = [];
      t.lines.forEach((l, n) => {
        const v = n === t.lines.length - 1 ? left : Math.round(l.qty * l.price * total / (sub || 1));
        left -= v; vals.push(v);
        const s = stock.get(l.itemId);
        if (s) { s.qty = r3(s.qty + l.qty); s.value += v; } else svc.set(t.id, (svc.get(t.id) || 0) + v);
      });
      lineV.set(t.id, vals);
    } else if (k === 1) {
      const vals = [];
      for (const l of t.lines) { const s = stock.get(l.itemId); vals.push(s ? take(s, l.itemId, l.qty) : 0); }
      lineV.set(t.id, vals); cogs.set(t.id, vals.reduce((a, b) => a + b, 0));
    } else if (k === 2) {
      // Barang kembali masuk stok dengan harga pokok saat dijual
      const o = byId.get(t.origId), vals = o && lineV.get(o.id); if (!vals) continue;
      let c = 0;
      for (const l of t.lines) {
        const s = stock.get(l.itemId), ol = o.lines[l.idx]; if (!s || !ol) continue;
        const v = Math.round((vals[l.idx] || 0) * l.qty / ol.qty);
        s.qty = r3(s.qty + l.qty); s.value += v; c += v;
      }
      rcost.set(t.id, c);
    } else if (k === 3) {
      // Barang keluar sebesar nilai belinya; total keluar sama persis dengan yang dijurnal
      const o = byId.get(t.origId), vals = o && lineV.get(o.id); if (!vals) continue;
      const w = t.lines.map(l => o.lines[l.idx] ? (vals[l.idx] || 0) * l.qty / o.lines[l.idx].qty : 0), sum = w.reduce((a, b) => a + b, 0) || 1;
      let left = t.dpp + (t.ppnCredit ? 0 : t.ppn);
      t.lines.forEach((l, n) => {
        const v = n === t.lines.length - 1 ? left : Math.round((t.dpp + (t.ppnCredit ? 0 : t.ppn)) * w[n] / sum);
        left -= v;
        const s = stock.get(l.itemId);
        if (!s) { rsvc.set(t.id, (rsvc.get(t.id) || 0) + v); return; }
        if (l.qty > s.qty + 1e-9) neg.add(l.itemId);
        s.qty = r3(s.qty - l.qty); s.value -= v;
        if ((s.qty <= 0 && s.value) || s.value < 0) { rdiff.set(t.id, (rdiff.get(t.id) || 0) + s.value); s.value = 0; }
      });
    } else {
      let v = 0;
      for (const l of t.lines) {
        const s = stock.get(l.itemId); if (!s) continue;
        if (l.diff < 0) { v -= take(s, l.itemId, -l.diff); continue; }
        const avg = s.qty > 0 ? s.value / s.qty : items.find(i => i.id === l.itemId)?.openCost || 0, add = Math.round(avg * l.diff);
        s.qty = r3(s.qty + l.diff); s.value += add; v += add;
      }
      adj.set(t.id, v);
    }
  }
  return {stock, cogs, svc, rcost, rsvc, rdiff, adj, neg};
}
const stockAsOf = upTo => upTo ? stockCalc(state.trades.filter(t => t.date <= upTo), state.items, state.returns.filter(r => r.date <= upTo), state.adjusts.filter(a => a.date <= upTo)).stock : M().stock.stock;
const stockValue = upTo => [...stockAsOf(upTo).values()].reduce((s, x) => s + x.value, 0);

let tradeTab = 'trades', tradeKind = 'sale', editingTrade = null, tradeLines = [], tradeLimit = TX_PAGE, tradeSrc = null;
function renderTrade() {
  document.querySelectorAll('#tradeTabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === tradeTab); b.setAttribute('aria-pressed', b.dataset.tab === tradeTab); });
  ['trades', 'items', 'vendors', 'tax'].forEach(k => $('trade-' + k).style.display = k === tradeTab ? '' : 'none');
  const from = $('tFrom').value, to = $('tTo').value, kind = $('tKind').value, q = $('tSearch').value.toLowerCase();
  const inPeriod = state.trades.filter(t => inRange(t.date, from, to));
  const cogs = M().stock.cogs;
  const sales = inPeriod.filter(t => t.kind === 'sale'), rets = state.returns.filter(r => r.kind === 'sale' && inRange(r.date, from, to));
  const rev = sales.reduce((s, t) => s + tradeTotal(t), 0) - rets.reduce((s, r) => s + r.dpp, 0);
  const hpp = sales.reduce((s, t) => s + (cogs.get(t.id) || 0), 0) - rets.reduce((s, r) => s + (M().stock.rcost.get(r.id) || 0), 0);
  $('tradeCards').innerHTML = [
    ['Penjualan', rp(rev), 'in', `${sales.length} transaksi`],
    ['Harga pokok (HPP)', rp(hpp), 'out'],
    ['Laba kotor', rp(rev - hpp), rev - hpp >= 0 ? 'in' : 'out', rev ? 'Margin ' + pct((rev - hpp) / rev * 100) : ''],
    ['Pembelian', rp(inPeriod.filter(t => t.kind === 'purchase').reduce((s, t) => s + tradeTotal(t), 0)), ''],
    ['Nilai persediaan', rp(stockValue()), ''],
  ].map(statCard).join('');
  if (tradeTab === 'items') return renderItems();
  if (tradeTab === 'vendors') return renderVendors();
  if (tradeTab === 'tax') return renderTaxRules();
  const rows = sorted(inPeriod).filter(t => (!kind || t.kind === kind) && (!q || (t.ref + ' ' + partyOf(t)).toLowerCase().includes(q)));
  $('tradeBody').innerHTML = rows.length ? rows.slice(0, tradeLimit).map(t => {
    const total = tradeTotal(t), sale = t.kind === 'sale', c = cogs.get(t.id) || 0;
    return `<tr>
      <td data-label="Tanggal">${fmtDate(t.date)}</td><td data-label="No. bukti">${esc(t.ref)}</td>
      <td data-label="Jenis"><span class="badge ${sale ? 'in' : 'out'}">${sale ? 'Jual' : 'Beli'}</span></td>
      <td data-label="Pihak">${esc(partyOf(t))}</td><td data-label="Bayar">${t.pay === 'cash' ? 'Tunai' : 'Kredit'}</td>
      <td data-label="Total" class="num"><b>${rp(total)}</b></td>
      <td data-label="HPP" class="num">${sale ? rp(c) : '—'}</td>
      <td data-label="Laba" class="num ${total - c >= 0 ? 'in' : 'out'}">${sale ? rp(total - c) : '—'}</td>
      <td data-label="" class="no-print num"><button class="btn sm" data-act="openTrade" data-id="${esc(t.id)}">Buka</button></td></tr>`;
  }).join('') + (rows.length > tradeLimit ? `<tr><td colspan="9" data-label="" style="text-align:center"><button class="btn" data-act="moreTrade">Tampilkan berikutnya (${rows.length - tradeLimit} lagi)</button></td></tr>` : '')
    : '<tr><td colspan="9" class="empty" data-label="">Belum ada penjualan atau pembelian.</td></tr>';
}
['tFrom', 'tTo', 'tKind'].forEach(id => $(id).oninput = () => { tradeLimit = TX_PAGE; renderTrade(); });
$('tSearch').oninput = debounce(() => { tradeLimit = TX_PAGE; renderTrade(); });
document.querySelectorAll('#tradeTabs button').forEach(b => b.onclick = () => { tradeTab = b.dataset.tab; renderTrade(); rememberView(); });

function renderItems() {
  const st = M().stock.stock;
  $('itemBody').innerHTML = state.items.length ? state.items.slice().sort((a, b) => a.name.localeCompare(b.name)).map(i => {
    const s = st.get(i.id), low = s && i.minQty && s.qty <= i.minQty;
    return `<tr><td data-label="Kode">${esc(i.code)}</td><td data-label="Nama"><b>${esc(i.name)}</b>${i.kind === 'jasa' ? ' <span class="badge tr">Jasa</span>' : ''}</td>
      <td data-label="Stok" class="num ${low ? 'out' : ''}">${s ? fmtQty(s.qty) + ' ' + esc(i.unit) : '—'}</td>
      <td data-label="HPP rata-rata" class="num">${s && s.qty ? rp(s.value / s.qty) : '—'}</td>
      <td data-label="Harga jual" class="num">${rp(i.price)}</td><td data-label="Nilai stok" class="num">${s ? rp(s.value) : '—'}</td>
      <td data-label="" class="no-print num" style="white-space:nowrap">${i.code ? `<button class="btn sm" data-act="printLabel" data-id="${esc(i.id)}">Label</button> ` : ''}<button class="btn sm" data-act="openItem" data-id="${esc(i.id)}">Ubah</button></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty" data-label="">Belum ada barang atau jasa.</td></tr>';
  const adj = M().stock.adj;
  $('opBody').innerHTML = state.adjusts.slice().sort((a, b) => b.date.localeCompare(a.date)).map(a => `<tr><td data-label="Tanggal">${fmtDate(a.date)}</td><td data-label="No. bukti">${esc(a.ref)}</td>
    <td data-label="Selisih">${a.lines.filter(l => l.diff).map(l => `${esc(itemOf(l.itemId)?.name)} ${l.diff > 0 ? '+' : ''}${fmtQty(l.diff)}`).join(', ') || 'Semua cocok'}</td><td data-label="Nilai" class="num">${rp(adj.get(a.id) || 0)}</td>
    <td data-label="" class="no-print num"><button class="btn sm danger" data-act="delAdjust" data-id="${esc(a.id)}">Hapus</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty" data-label="">Belum ada stok opname.</td></tr>';
}
function renderVendors() {
  const bought = new Map();
  state.trades.forEach(t => { if (t.kind === 'purchase') bought.set(t.vendorId, (bought.get(t.vendorId) || 0) + tradeTotal(t)); });
  const owed = new Map();
  state.debts.forEach(d => { if (d.kind === 'utang' && d.tradeId) { const v = state.trades.find(t => t.id === d.tradeId)?.vendorId; owed.set(v, (owed.get(v) || 0) + Math.max(0, remainOf(d))); } });
  $('vendorBody').innerHTML = state.vendors.length ? state.vendors.slice().sort((a, b) => a.name.localeCompare(b.name)).map(v => `<tr>
    <td data-label="Vendor"><b>${esc(v.name)}</b></td><td data-label="Kontak">${esc([v.pic, v.phone].filter(Boolean).join(' · '))}</td>
    <td data-label="Pajak">${v.pkp ? '<span class="badge in">PKP</span> ' : ''}${v.wapu ? '<span class="badge warn">WAPU</span>' : ''}</td>
    <td data-label="Tempo">${v.terms ? v.terms + ' hari' : 'Tunai'}</td>
    <td data-label="Total beli" class="num">${rp(bought.get(v.id) || 0)}</td><td data-label="Utang" class="num">${rp(owed.get(v.id) || 0)}</td>
    <td data-label="" class="no-print num"><button class="btn sm" data-act="openVendor" data-id="${esc(v.id)}">Ubah</button></td></tr>`).join('')
    : '<tr><td colspan="7" class="empty" data-label="">Belum ada vendor/supplier.</td></tr>';
}

/* Dialog barang */
let editingItem = null, afterItem = null;
function openItem(id) {
  editingItem = id ? itemOf(id) : null;
  const i = editingItem || {kind: 'barang', unit: 'pcs'};
  const used = editingItem && state.trades.some(t => t.lines.some(l => l.itemId === id));
  $('itemTitle').textContent = editingItem ? 'Ubah Barang / Jasa' : 'Barang / Jasa Baru';
  $('iName').value = i.name || ''; $('iCode').value = i.code || ''; $('iKind').value = i.kind; $('iUnit').value = i.unit || '';
  $('iTax').value = i.taxType || 'bkp';
  $('iPrice').value = i.price ? i.price.toLocaleString('id-ID') : ''; $('iMin').value = i.minQty || ''; $('iLead').value = i.leadDays || '';
  $('iOpenQty').value = i.openQty || ''; $('iOpenCost').value = i.openCost ? i.openCost.toLocaleString('id-ID') : '';
  $('iKind').disabled = !!used;
  const lockOpen = !!state.lockedUntil && !!editingItem;
  $('iOpenQty').disabled = $('iOpenCost').disabled = lockOpen;
  $('iHint').textContent = lockOpen ? 'Stok awal terkunci karena sudah tutup buku.' : 'Stok awal = sisa barang saat mulai memakai aplikasi, dengan harga pokok per satuan. Nilainya masuk Persediaan di neraca.';
  $('btnDeleteItem').style.display = editingItem ? '' : 'none';
  $('itemDialog').showModal();
}
moneyInput($('iPrice')); moneyInput($('iOpenCost'));
$('iTax').innerHTML = Object.entries(TAX_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('');
$('iTax').onchange = () => {
  const k = TAX_TYPES[$('iTax').value].kind;
  if (!$('iKind').disabled) $('iKind').value = k;
  else if (k !== $('iKind').value) { $('iTax').value = $('iKind').value === 'jasa' ? 'jasa' : 'bkp'; toast('Barang/jasa yang sudah dipakai tidak bisa berganti jenis'); }
};
$('iKind').onchange = () => { if (TAX_TYPES[$('iTax').value].kind !== $('iKind').value) $('iTax').value = $('iKind').value === 'jasa' ? 'jasa' : 'bkp'; };
$('btnCancelItem').onclick = () => $('itemDialog').close();
$('itemForm').onsubmit = e => {
  const fail = msg => { e.preventDefault(); toast(msg); };
  const name = $('iName').value.trim().slice(0, 120);
  if (!name) return fail('Isi nama barang/jasa');
  if (state.items.some(x => x !== editingItem && x.name.toLowerCase() === name.toLowerCase())) return fail('Nama ini sudah ada');
  const data = {name, code: $('iCode').value.trim().slice(0, 30), kind: $('iKind').value === 'jasa' ? 'jasa' : 'barang', taxType: Object.hasOwn(TAX_TYPES, $('iTax').value) ? $('iTax').value : 'bkp', unit: $('iUnit').value.trim().slice(0, 20),
    price: parseMoney($('iPrice').value), minQty: parseQty($('iMin').value), leadDays: Math.abs(parseInt($('iLead').value) || 0),
    openQty: parseQty($('iOpenQty').value), openCost: parseMoney($('iOpenCost').value)};
  if (TAX_TYPES[data.taxType].kind !== data.kind) return fail('Jenis pajak tidak sesuai dengan jenis barang/jasa');
  if (data.kind === 'jasa') data.openQty = data.openCost = 0;
  if (state.lockedUntil && !editingItem && data.openQty) return fail('Stok awal tidak bisa diisi setelah tutup buku; catat sebagai pembelian.');
  if (editingItem) {
    const cand = state.items.map(x => x === editingItem ? {...x, ...data} : x);
    if (stockCalc(state.trades, cand).neg.size) return fail('Stok awal terlalu kecil untuk penjualan yang sudah tercatat');
    const before = `${editingItem.name} stok awal ${editingItem.openQty} @ ${rp(editingItem.openCost)}`;
    Object.assign(editingItem, data);
    log('ubah', 'barang', editingItem.id, `${before} ⇒ ${data.name} stok awal ${data.openQty} @ ${rp(data.openCost)}`);
  } else {
    const it = {id: uid(), ...data};
    state.items.push(it); editingItem = it;
    log('tambah', 'barang', it.id, `${it.name} · stok awal ${it.openQty} @ ${rp(it.openCost)}`);
  }
  save(); toast('Barang tersimpan');
  if (afterItem) { afterItem(editingItem); afterItem = null; }
};
$('btnDeleteItem').onclick = () => {
  if (!editingItem) return;
  if (state.trades.some(t => t.lines.some(l => l.itemId === editingItem.id)) || state.adjusts.some(a => a.lines.some(l => l.itemId === editingItem.id))) return toast('Barang sudah dipakai di jual/beli atau opname, tidak bisa dihapus');
  if (editingItem.openQty && state.lockedUntil) return toast('Barang berstok awal tidak bisa dihapus setelah tutup buku');
  if (!confirm('Hapus barang ini?')) return;
  log('hapus', 'barang', editingItem.id, editingItem.name);
  state.items = state.items.filter(x => x !== editingItem);
  $('itemDialog').close(); save();
};

/* Dialog vendor */
let editingVendor = null, afterVendor = null;
const VENDOR_FIELDS = {vName: 'name', vPic: 'pic', vPhone: 'phone', vEmail: 'email', vAddress: 'address', vNpwp: 'npwp', vBank: 'bank', vNote: 'note'};
function openVendor(id) {
  editingVendor = id ? vendorOf(id) : null;
  const v = editingVendor || {};
  $('vendorTitle').textContent = editingVendor ? 'Ubah Vendor / Supplier' : 'Vendor / Supplier Baru';
  Object.entries(VENDOR_FIELDS).forEach(([el, k]) => $(el).value = v[k] || '');
  $('vTerms').value = v.terms || '';
  $('vPkp').checked = !!v.pkp; $('vWapu').checked = !!v.wapu; $('vNoPph').checked = !!v.noPph;
  $('btnDeleteVendor').style.display = editingVendor ? '' : 'none';
  $('vendorDialog').showModal();
}
$('btnCancelVendor').onclick = () => $('vendorDialog').close();
$('vendorForm').onsubmit = e => {
  const fail = msg => { e.preventDefault(); toast(msg); };
  const name = $('vName').value.trim();
  if (!name) return fail('Isi nama vendor');
  if (state.vendors.some(x => x !== editingVendor && x.name.toLowerCase() === name.toLowerCase())) return fail('Vendor ini sudah ada');
  const data = {terms: Math.abs(parseInt($('vTerms').value) || 0), pkp: $('vPkp').checked, wapu: $('vWapu').checked, noPph: $('vNoPph').checked};
  Object.entries(VENDOR_FIELDS).forEach(([el, k]) => data[k] = $(el).value.trim().slice(0, k === 'address' || k === 'note' ? 300 : 120));
  const flags = `PKP ${data.pkp ? 'ya' : 'tidak'} · WAPU ${data.wapu ? 'ya' : 'tidak'} · bebas potong ${data.noPph ? 'ya' : 'tidak'}`;
  if (editingVendor) { Object.assign(editingVendor, data); log('ubah', 'vendor', editingVendor.id, data.name + ' · ' + flags); }
  else { editingVendor = {id: uid(), ...data}; state.vendors.push(editingVendor); log('tambah', 'vendor', editingVendor.id, data.name + ' · ' + flags); }
  save(); toast('Vendor tersimpan');
  if (afterVendor) { afterVendor(editingVendor); afterVendor = null; }
};
$('btnDeleteVendor').onclick = () => {
  if (!editingVendor) return;
  if (state.trades.some(t => t.vendorId === editingVendor.id)) return toast('Vendor sudah dipakai di pembelian, tidak bisa dihapus');
  if (!confirm('Hapus vendor ini?')) return;
  log('hapus', 'vendor', editingVendor.id, editingVendor.name);
  state.vendors = state.vendors.filter(x => x !== editingVendor);
  $('vendorDialog').close(); save();
};

/* Dialog jual/beli */
const tradeDebt = t => state.debts.find(d => d.tradeId === t.id);
const tradeReadOnly = t => {
  if (!t) return '';
  if (isLocked(t.date)) return lockMsg();
  if (retOf(t).length) return 'Sudah ada retur untuk transaksi ini. Hapus returnya dulu bila data ini perlu diubah.';
  const d = tradeDebt(t);
  return d && paidOf(d) > 0 ? 'Sudah ada pelunasan di Piutang/Utang. Hapus pelunasannya dulu bila data ini perlu diubah.' : '';
};
function tradeItems() { return state.items; }
function setTradeKind(k) {
  tradeKind = k;
  document.querySelectorAll('#tradeKindSeg button').forEach(b => b.classList.toggle('on', b.dataset.k === k));
  $('tCustWrap').style.display = k === 'sale' ? '' : 'none';
  $('tVendorWrap').style.display = k === 'sale' ? 'none' : '';
  $('tExtraWrap').style.display = k === 'sale' ? 'none' : '';
  ['tAddrWrap', 'tCustNpwpWrap', 'tPoWrap'].forEach(id => $(id).style.display = k === 'sale' ? '' : 'none');
  $('tSaleTax').style.display = k === 'sale' ? 'flex' : 'none';
  $('tAccLabel').textContent = k === 'sale' ? 'Masuk ke akun' : 'Dibayar dari akun';
  if ($('tRef').dataset.auto === '1') refreshTradeRef();
  renderTradeLines();
}
const refreshTradeRef = () => { if ($('tDate').value) $('tRef').value = nextCode(tradeKind === 'sale' ? 'INV' : 'BL', $('tDate').value, state.trades.map(t => t.ref)); };
function setTradePay() {
  const credit = $('tPay').value === 'credit';
  $('tAccWrap').style.display = credit ? 'none' : '';
  $('tDueWrap').style.display = credit ? '' : 'none';
}
function renderTradeLines() {
  const opts = tradeItems().map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  $('tLines').innerHTML = tradeLines.map((l, n) => `<div class="tline" data-n="${n}">
    <select class="tl-item" aria-label="Barang"><option value="">Pilih…</option>${opts}</select>
    <input class="tl-qty" inputmode="decimal" placeholder="Jumlah" aria-label="Jumlah" value="${l.qty ? String(l.qty).replace('.', ',') : ''}">
    <input class="tl-price" inputmode="numeric" placeholder="${tradeKind === 'sale' ? 'Harga jual' : 'Harga beli'}" aria-label="Harga" value="${l.price ? l.price.toLocaleString('id-ID') : ''}">
    <button type="button" class="btn sm danger" data-act="delLine" data-id="${n}" aria-label="Hapus baris">✕</button></div>`).join('');
  $('tLines').querySelectorAll('.tline').forEach((row, n) => { row.querySelector('.tl-item').value = tradeLines[n].itemId || ''; });
  tradeSummaryBox();
}
function tradeDraft() {
  const d = {...(editingTrade || {id: 'draft', created: Date.now()}), kind: tradeKind, date: $('tDate').value, ref: $('tRef').value.trim().slice(0, 40),
    lines: tradeLines.filter(l => l.itemId && l.qty > 0).map(l => ({...l})), discount: parseMoney($('tDiscount').value),
    extra: tradeKind === 'purchase' ? parseMoney($('tExtra').value) : 0, pay: $('tPay').value === 'credit' ? 'credit' : 'cash',
    vendorId: tradeKind === 'purchase' ? $('tVendor').value || null : null, party: tradeKind === 'sale' ? $('tCust').value.trim().slice(0, 120) : '',
    accountId: $('tPay').value === 'credit' ? null : $('tAcc').value, due: $('tPay').value === 'credit' ? $('tDue').value : '', desc: $('tDesc').value.trim().slice(0, 500),
    srcId: editingTrade?.srcId || tradeSrc?.srcId || null, whId: $('tWh').value || null, salesId: tradeKind === 'sale' ? $('tSales').value || null : null,
    wapu: tradeKind === 'sale' && $('tWapu').checked, wapuKind: $('tWapuKind').value === 'gov' ? 'gov' : 'other', cut: tradeKind === 'sale' && $('tCut').checked, fpNo: $('tFpNo').value.trim().slice(0, 40), fpDate: $('tFpDate').value,
    poNo: tradeKind === 'sale' ? $('tPo').value.trim().slice(0, 60) : '', custAddr: tradeKind === 'sale' ? $('tCustAddr').value.trim().slice(0, 300) : '', custNpwp: tradeKind === 'sale' ? $('tCustNpwp').value.trim().slice(0, 30) : ''};
  return Object.assign(d, taxCalc(d));
}
function tradeSummaryBox() {
  const d = tradeDraft(), total = tradeTotal(d), sale = d.kind === 'sale';
  const tax = `<div>DPP ${rp(total)} · PPN ${rp(d.ppn)}${d.wapu && d.ppn ? ' (dipungut WAPU, tidak ' + (sale ? 'diterima' : 'dibayar ke vendor') + ')' : ''}${d.pphParts.map(x => ` · ${PPH_LABEL[x.code]} ${String(x.rate).replace('.', ',')}% ${rp(x.amt)}`).join('')}</div>
    <div>${sale ? 'Diterima' : 'Dibayar ke vendor'}: <b>${rp(tradePay(d))}</b></div>
    ${!sale && d.pph && !vendorOf(d.vendorId)?.npwp ? '<div class="out">Vendor belum punya NPWP di data: tarif pemotongan bisa lebih tinggi, periksa sebelum menyimpan.</div>' : ''}`;
  if (!sale || !DATE_RE.test(d.date)) { $('tSummary').innerHTML = tax; return; }
  const r = stockCalc([...state.trades.filter(t => t !== editingTrade), d]), c = r.cogs.get(d.id) || 0, short = d.lines.filter(l => r.neg.has(l.itemId));
  $('tSummary').innerHTML = `${tax}HPP <b>${rp(c)}</b> · Laba <b class="${total - c >= 0 ? 'in' : 'out'}">${rp(total - c)}</b>${total ? ' (' + pct((total - c) / total * 100) + ')' : ''}
    ${short.length ? `<div class="out">Stok tidak cukup: ${short.map(l => esc(itemOf(l.itemId)?.name)).join(', ')}</div>` : ''}`;
}
$('tLines').addEventListener('input', e => {
  const row = e.target.closest('.tline'); if (!row) return;
  const l = tradeLines[+row.dataset.n];
  if (e.target.classList.contains('tl-item')) {
    l.itemId = e.target.value;
    const it = itemOf(l.itemId), s = M().stock.stock.get(l.itemId);
    const price = tradeKind === 'sale' ? custPrice(it?.price || 0, $('tCust').value) : s && s.qty ? Math.round(s.value / s.qty) : it?.openCost;
    if (price && !l.price) { l.price = price; row.querySelector('.tl-price').value = price.toLocaleString('id-ID'); }
  } else if (e.target.classList.contains('tl-qty')) l.qty = parseQty(e.target.value);
  else if (e.target.classList.contains('tl-price')) { l.price = parseMoney(e.target.value); e.target.value = l.price ? l.price.toLocaleString('id-ID') : ''; }
  tradeSummaryBox();
});
['tDiscount', 'tExtra'].forEach(id => { moneyInput($(id)); $(id).addEventListener('input', tradeSummaryBox); });
$('tWapu').onchange = () => { $('tCut').checked = $('tWapu').checked && !state.tax.skb; $('tWapuKind').style.display = $('tWapu').checked ? '' : 'none'; tradeSummaryBox(); };
$('tCut').onchange = tradeSummaryBox;
$('tDate').onchange = () => { if ($('tRef').dataset.auto === '1') refreshTradeRef(); tradeSummaryBox(); };
$('tRef').oninput = () => { $('tRef').dataset.auto = ''; };
$('tPay').onchange = setTradePay;
$('tVendor').onchange = () => {
  const v = vendorOf($('tVendor').value);
  tradeSummaryBox();
  if (v?.terms) { $('tPay').value = 'credit'; setTradePay(); if ($('tDate').value) $('tDue').value = new Date(new Date($('tDate').value).getTime() + v.terms * 864e5).toISOString().slice(0, 10); }
};
document.querySelectorAll('#tradeKindSeg button').forEach(b => b.onclick = () => setTradeKind(b.dataset.k));
// Pemindai barcode mengetik kode lalu Enter; kode yang sama menambah jumlah
$('tScan').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const code = $('tScan').value.trim().toUpperCase(), it = state.items.find(i => i.code && i.code.toUpperCase() === code);
  $('tScan').value = '';
  if (!it) return toast('Kode barang tidak ditemukan');
  const same = tradeLines.find(l => l.itemId === it.id), blank = tradeLines.find(l => !l.itemId);
  if (same) same.qty = Math.round((same.qty + 1) * 1000) / 1000;
  else { const price = tradeKind === 'sale' ? custPrice(it.price, $('tCust').value) : it.openCost; if (blank) Object.assign(blank, {itemId: it.id, qty: 1, price}); else tradeLines.push({itemId: it.id, qty: 1, price}); }
  renderTradeLines();
});
$('btnAddLine').onclick = () => { tradeLines.push({itemId: '', qty: 1, price: 0}); renderTradeLines(); };
$('btnNewItem').onclick = () => {
  afterItem = it => { const empty = tradeLines.find(l => !l.itemId); const price = tradeKind === 'sale' ? it.price : it.openCost;
    if (empty) { empty.itemId = it.id; empty.price ||= price; } else tradeLines.push({itemId: it.id, qty: 1, price}); renderTradeLines(); };
  openItem();
};
$('btnNewVendor').onclick = () => {
  afterVendor = v => { fillSelect($('tVendor'), state.vendors, 'Pilih vendor', x => x.name); $('tVendor').value = v.id; $('tVendor').onchange(); };
  openVendor();
};
function openTrade(id, kind) {
  if (!state.accounts.length) return toast('Tambahkan akun dulu di menu Atur');
  editingTrade = id ? state.trades.find(t => t.id === id) : null;
  const t = editingTrade || {kind: kind || 'sale', date: today(), pay: 'cash', lines: [], discount: 0, extra: 0};
  $('tDate').value = t.date; $('tDesc').value = t.desc || ''; $('tCust').value = t.party || '';
  $('tRef').dataset.auto = editingTrade ? '' : '1'; $('tRef').value = t.ref || '';
  $('tPay').value = t.pay; $('tDue').value = t.due || '';
  fillSelect($('tAcc'), state.accounts);
  fillSelect($('tVendor'), state.vendors, 'Pilih vendor', x => x.name);
  $('tVendor').value = t.vendorId || '';
  if (t.accountId) $('tAcc').value = t.accountId;
  $('tWapu').checked = !!t.wapu && t.kind === 'sale'; $('tWapuKind').value = t.wapuKind || 'other'; $('tWapuKind').style.display = $('tWapu').checked ? '' : 'none'; $('tCut').checked = !!t.cut; $('tFpNo').value = t.fpNo || ''; $('tFpDate').value = t.fpDate || '';
  $('tPo').value = t.poNo || ''; $('tCustAddr').value = t.custAddr || ''; $('tCustNpwp').value = t.custNpwp || '';
  $('tDiscount').value = t.discount ? t.discount.toLocaleString('id-ID') : '';
  $('tExtra').value = t.extra ? t.extra.toLocaleString('id-ID') : '';
  $('custList').innerHTML = [...new Set([...state.customers.map(x => x.name), ...state.trades.filter(x => x.kind === 'sale' && x.party).map(x => x.party)])].map(p => `<option value="${esc(p)}">`).join('');
  tradeLines = t.lines.length ? t.lines.map(l => ({...l})) : [{itemId: '', qty: 1, price: 0}];
  if (editingTrade) tradeSrc = null;
  if (tradeSrc) { tradeLines = tradeSrc.lines.map(l => ({...l})); $('tCust').value = tradeSrc.party || ''; $('tCustAddr').value = tradeSrc.addr || ''; $('tCustNpwp').value = tradeSrc.npwp || ''; $('tVendor').value = tradeSrc.vendorId || ''; $('tPo').value = tradeSrc.ref || ''; }
  fillSelect($('tSales'), state.salespeople, 'Tanpa tenaga penjual', x => x.name);
  $('tSalesWrap').style.display = state.salespeople.length && t.kind === 'sale' ? '' : 'none';
  $('tSales').value = t.salesId || '';
  fillSelect($('tWh'), state.warehouses, 'Gudang utama');
  $('tWhWrap').style.display = state.warehouses.length ? '' : 'none';
  $('tWh').value = t.whId || '';
  setTradeKind(t.kind); setTradePay();
  const ro = tradeReadOnly(editingTrade);
  $('tradeTitle').textContent = editingTrade ? (t.kind === 'sale' ? 'Detail Penjualan' : 'Detail Pembelian') : 'Jual / Beli Baru';
  $('tradeNote').style.display = ro ? '' : 'none'; $('tradeNote').textContent = ro;
  $('tradeForm').querySelectorAll('.bd input, .bd select, .bd textarea, .bd button').forEach(x => x.disabled = !!ro);
  document.querySelectorAll('#tradeKindSeg button').forEach(b => b.disabled = !!editingTrade);
  $('btnSaveTrade').style.display = ro ? 'none' : '';
  $('btnDeleteTrade').style.display = editingTrade && !ro ? '' : 'none';
  $('btnPrintTrade').style.display = editingTrade && t.kind === 'sale' ? '' : 'none';
  $('btnReturnTrade').style.display = editingTrade ? '' : 'none';
  $('tReturns').innerHTML = editingTrade && retOf(t).length ? `<h3 style="font-size:13px;margin:14px 0 6px">Retur</h3><table><tbody>${retOf(t).map(r => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.ref)}</td><td class="num">${rp(r.dpp)}</td><td class="num"><button type="button" class="btn sm danger" data-act="delReturn" data-id="${esc(r.id)}">Hapus</button></td></tr>`).join('')}</tbody></table>` : '';
  $('tradeDialog').showModal();
}
// Membuat atau memperbarui transaksi kas / piutang-utang yang menyertai jual beli
function postTrade(t) {
  const sale = t.kind === 'sale', total = tradePay(t), categoryId = tradeCat(t)?.id;
  const desc = (t.desc || `${sale ? 'Penjualan kepada' : 'Pembelian dari'} ${partyOf(t)}`).slice(0, 500);
  const tx = state.tx.find(x => x.tradeId === t.id), debt = tradeDebt(t);
  if (t.pay === 'cash') {
    if (debt) state.debts = state.debts.filter(d => d !== debt);
    const data = {type: sale ? 'in' : 'out', date: t.date, ref: t.ref, amount: total, accountId: t.accountId, categoryId, toAccountId: null, desc, tradeId: t.id};
    if (tx) Object.assign(tx, data); else state.tx.push({id: uid(), created: Date.now(), ...data});
  } else {
    if (tx) state.tx = state.tx.filter(x => x !== tx);
    const data = {kind: sale ? 'piutang' : 'utang', party: partyOf(t), ref: t.ref, date: t.date, due: t.due, amount: total, categoryId, desc, tradeId: t.id};
    if (debt) Object.assign(debt, data); else state.debts.push({id: uid(), created: Date.now(), ...data});
  }
}
$('btnCancelTrade').onclick = () => $('tradeDialog').close();
$('tCust').addEventListener('change', () => { const c = state.customers.find(x => x.name === $('tCust').value.trim()); if (c) { $('tCustAddr').value ||= c.address; $('tCustNpwp').value ||= c.npwp; $('tWapu').checked = c.wapu; $('tWapu').onchange(); } });
$('tradeDialog').addEventListener('close', () => { tradeSrc = null; });
$('tradeForm').onsubmit = e => {
  const fail = msg => { e.preventDefault(); toast(msg); };
  if (tradeReadOnly(editingTrade)) return fail(tradeReadOnly(editingTrade));
  const d = tradeDraft();
  if (!DATE_RE.test(d.date)) return fail('Isi tanggal');
  if (isLocked(d.date)) return fail(lockMsg());
  if (!d.ref) return fail('No. bukti wajib diisi');
  if (state.trades.some(t => t !== editingTrade && t.ref === d.ref) || state.tx.some(t => t.ref === d.ref && t.tradeId !== d.id)) return fail(`No. bukti ${d.ref} sudah dipakai`);
  if (d.kind === 'purchase' && !d.vendorId) return fail('Pilih vendor/supplier');
  if (!d.lines.length) return fail('Tambahkan minimal satu barang');
  if (tradeTotal(d) <= 0 || tradePay(d) <= 0) return fail('Total harus lebih dari 0');
  if (d.pay === 'credit' && d.kind === 'sale' && !d.party) return fail('Isi nama pelanggan untuk penjualan kredit');
  if (d.pay === 'credit' && d.due && d.due < d.date) return fail('Jatuh tempo tidak boleh sebelum tanggal');
  if (d.pay === 'cash' && !d.accountId) return fail('Pilih akun kas/bank');
  const id = editingTrade?.id || uid(), cand = {...d, id};
  const r = stockCalc([...state.trades.filter(t => t !== editingTrade), cand]);
  if (r.neg.size) return fail('Stok tidak cukup: ' + [...r.neg].map(x => itemOf(x)?.name).join(', '));
  const credit = creditProblem(cand);
  if (credit) { if (!canApprove()) return fail(credit + '. Perlu persetujuan pimpinan atau keuangan.'); if (!confirm(credit + '. Tetap simpan?')) return fail('Dibatalkan'); }
  if (editingTrade) {
    const before = tradeSummary(editingTrade);
    Object.assign(editingTrade, cand);
    postTrade(editingTrade);
    log('ubah', 'jual beli', id, `${before} ⇒ ${tradeSummary(editingTrade)}`);
  } else {
    state.trades.push(cand);
    postTrade(cand);
    log('tambah', 'jual beli', id, tradeSummary(cand));
  }
  save(); toast(`${d.kind === 'sale' ? 'Penjualan' : 'Pembelian'} tersimpan · ${d.ref}`);
};
$('btnDeleteTrade').onclick = () => {
  const t = editingTrade;
  if (!t || tradeReadOnly(t)) return toast(tradeReadOnly(t) || 'Tidak bisa dihapus');
  if (stockCalc(state.trades.filter(x => x !== t)).neg.size) return toast('Pembelian ini sudah terjual; hapus penjualannya dulu.');
  const reason = askReason('menghapus jual/beli'); if (!reason) return;
  log('hapus', 'jual beli', t.id, `${tradeSummary(t)} · alasan: ${reason}`);
  state.tx = state.tx.filter(x => x.tradeId !== t.id);
  state.debts = state.debts.filter(x => x.tradeId !== t.id);
  state.trades = state.trades.filter(x => x !== t);
  $('tradeDialog').close(); save(); toast('Data dihapus (tercatat di jejak audit)');
};
$('btnPrintTrade').onclick = () => { if (editingTrade) printInvoice(editingTrade); };
$('btnNewSale').onclick = () => openTrade(null, 'sale');
$('btnNewBuy').onclick = () => openTrade(null, 'purchase');
$('btnAddItem').onclick = () => { afterItem = null; openItem(); };
$('btnAddVendor').onclick = () => { afterVendor = null; openVendor(); };

/* Retur: membalik penjualan/pembelian sebagian atau seluruhnya, dengan PPN dan PPh yang sebanding */
const retOf = t => state.returns.filter(r => r.origId === t.id);
const retQty = (t, idx) => retOf(t).reduce((s, r) => s + r.lines.filter(l => l.idx === idx).reduce((x, l) => x + l.qty, 0), 0);
function retCalc(t, lines) {
  const sub = t.lines.reduce((s, l) => s + l.qty * l.price, 0) || 1, total = tradeTotal(t);
  const dpp = Math.round(lines.reduce((s, l) => s + l.qty * t.lines[l.idx].price, 0) * total / sub), f = total ? dpp / total : 0;
  return {dpp, ppn: Math.round(t.ppn * f), pph: Math.round(t.pph * f), wapu: t.wapu, ppnCredit: t.ppnCredit};
}
let returningTrade = null;
function retDraftLines() {
  return [...$('retLines').querySelectorAll('input')].map(x => ({idx: +x.dataset.idx, itemId: returningTrade.lines[+x.dataset.idx].itemId, qty: parseQty(x.value)})).filter(l => l.qty > 0);
}
function retRefresh() {
  const t = returningTrade, lines = retDraftLines(), c = retCalc(t, lines), sale = t.kind === 'sale';
  $('retAccWrap').style.display = $('retSettle').value === 'cash' ? '' : 'none';
  $('retSummary').innerHTML = `DPP ${rp(c.dpp)} · PPN ${rp(c.ppn)}${c.pph ? ' · PPh ' + rp(c.pph) : ''}<br>${$('retSettle').value === 'cash' ? (sale ? 'Uang dikembalikan ke pembeli' : 'Uang diterima dari vendor') : (sale ? 'Mengurangi piutang' : 'Mengurangi utang')}: <b>${rp(retPay(c))}</b>`;
}
function openReturn(t) {
  returningTrade = t;
  const sale = t.kind === 'sale', debt = tradeDebt(t), open = debt && remainOf(debt) > 0;
  $('retTitle').textContent = `${sale ? 'Retur Penjualan' : 'Retur Pembelian'} · ${t.ref}`;
  $('retDate').value = today();
  $('retRef').value = nextCode(sale ? 'RJ' : 'RB', today(), state.returns.map(r => r.ref));
  fillSelect($('retAcc'), state.accounts);
  if (t.accountId) $('retAcc').value = t.accountId;
  $('retSettle').innerHTML = `${open ? `<option value="debt">Kurangi ${sale ? 'piutang' : 'utang'} (nota retur)</option>` : ''}<option value="cash">${sale ? 'Kembalikan uang' : 'Terima pengembalian uang'}</option>`;
  $('retDesc').value = '';
  $('retLines').innerHTML = t.lines.map((l, n) => { const left = Math.round((l.qty - retQty(t, n)) * 1000) / 1000; return `<label class="f">${esc(itemOf(l.itemId)?.name)}: sisa ${fmtQty(left)} ${esc(itemOf(l.itemId)?.unit)}<input data-idx="${n}" data-max="${left}" inputmode="decimal" placeholder="Jumlah diretur"${left <= 0 ? ' disabled' : ''}></label>`; }).join('');
  retRefresh();
  $('retDialog').showModal();
}
$('retLines').addEventListener('input', retRefresh);
$('retSettle').onchange = retRefresh;
$('retDate').onchange = () => { $('retRef').value = nextCode(returningTrade.kind === 'sale' ? 'RJ' : 'RB', $('retDate').value || today(), state.returns.map(r => r.ref)); };
$('btnCancelRet').onclick = () => $('retDialog').close();
$('btnReturnTrade').onclick = () => { if (editingTrade) { const t = editingTrade; $('tradeDialog').close(); openReturn(t); } };
$('retForm').onsubmit = e => {
  const fail = msg => { e.preventDefault(); toast(msg); };
  const t = returningTrade, date = $('retDate').value, ref = $('retRef').value.trim().slice(0, 40), lines = retDraftLines(), settle = $('retSettle').value === 'debt' ? 'debt' : 'cash';
  if (!DATE_RE.test(date)) return fail('Isi tanggal retur');
  if (date < t.date) return fail('Tanggal retur tidak boleh sebelum tanggal transaksi');
  if (isLocked(date)) return fail(lockMsg());
  if (!ref) return fail('No. bukti wajib diisi');
  if (state.returns.some(r => r.ref === ref) || state.tx.some(x => x.ref === ref)) return fail(`No. bukti ${ref} sudah dipakai`);
  if (!lines.length) return fail('Isi jumlah yang diretur');
  if ([...$('retLines').querySelectorAll('input')].some(x => parseQty(x.value) > +x.dataset.max)) return fail('Jumlah retur melebihi sisa');
  const r = {id: uid(), created: Date.now(), kind: t.kind, origId: t.id, date, ref, lines, settle, accountId: settle === 'cash' ? $('retAcc').value : null, debtId: null, desc: $('retDesc').value.trim().slice(0, 500), ...retCalc(t, lines)};
  const pay = retPay(r), debt = tradeDebt(t);
  if (pay <= 0) return fail('Nilai retur harus lebih dari 0');
  if (settle === 'debt') { if (!debt || pay > remainOf(debt)) return fail('Nilai retur melebihi sisa tagihan; pilih pengembalian uang'); r.debtId = debt.id; }
  const chk = stockCalc(state.trades, state.items, [...state.returns, r]);
  if (chk.neg.size) return fail('Stok tidak cukup untuk diretur: ' + [...chk.neg].map(x => itemOf(x)?.name).join(', '));
  state.returns.push(r);
  if (settle === 'cash') state.tx.push({id: uid(), created: Date.now(), type: t.kind === 'sale' ? 'out' : 'in', date, ref, amount: pay, accountId: r.accountId, categoryId: tradeCat(t)?.id, toAccountId: null, desc: `Retur ${t.ref}`, returnId: r.id});
  log('tambah', 'retur', r.id, `${ref} · ${date} · retur ${t.ref} · DPP ${rp(r.dpp)} · PPN ${rp(r.ppn)} · ${settle === 'cash' ? 'uang' : 'nota retur'}`);
  save(); toast('Retur tersimpan · ' + ref);
};
function delReturn(id) {
  const r = state.returns.find(x => x.id === id); if (!r) return;
  if (isLocked(r.date)) return toast(lockMsg());
  const rest = state.returns.filter(x => x !== r);
  if (stockCalc(state.trades, state.items, rest).neg.size) return toast('Barang retur ini sudah terjual lagi; retur tidak bisa dihapus.');
  const reason = askReason('menghapus retur'); if (!reason) return;
  log('hapus', 'retur', r.id, `${r.ref} · ${r.date} · ${rp(r.dpp)} · alasan: ${reason}`);
  state.returns = rest;
  state.tx = state.tx.filter(t => t.returnId !== r.id);
  document.querySelectorAll('dialog[open]').forEach(x => x.close());
  save(); toast('Retur dihapus (tercatat di jejak audit)');
}

/* Stok opname: mencocokkan stok buku dengan hitungan fisik; selisihnya menjadi beban atau pengurang beban */
function opRows() {
  const date = $('opDate').value || today(), st = stockAsOf(date), multi = state.warehouses.length > 0, wh = whStock().get($('opWh').value) || new Map();
  const book = i => multi ? wh.get(i.id) || 0 : st.get(i.id).qty;
  $('opWhWrap').style.display = multi ? '' : 'none';
  $('opLines').innerHTML = state.items.filter(i => st.has(i.id)).sort((a, b) => a.name.localeCompare(b.name)).map(i => `<label class="f">${esc(i.name)}: buku ${fmtQty(book(i))} ${esc(i.unit)}<input data-id="${esc(i.id)}" data-book="${book(i)}" inputmode="decimal" placeholder="Hitungan fisik"></label>`).join('') || '<div class="empty">Belum ada barang.</div>';
  opRefresh();
}
function opDraft() {
  return [...$('opLines').querySelectorAll('input')].filter(x => x.value.trim() !== '').map(x => { const counted = parseQty(x.value); return {itemId: x.dataset.id, counted, diff: Math.round((counted - +x.dataset.book) * 1000) / 1000}; });
}
function opRefresh() {
  const lines = opDraft(), a = {id: 'draft', created: Date.now(), date: $('opDate').value || today(), lines}, v = stockCalc(state.trades, state.items, state.returns, [...state.adjusts, a]).adj.get('draft') || 0;
  $('opSummary').innerHTML = lines.length ? `${lines.length} barang dihitung, ${lines.filter(l => l.diff).length} selisih. ${v < 0 ? 'Kekurangan' : 'Kelebihan'} senilai <b class="${v < 0 ? 'out' : 'in'}">${rp(Math.abs(v))}</b>` : 'Isi hitungan fisik barang yang dihitung; barang yang dikosongkan tidak dianggap dihitung.';
}
$('opLines').addEventListener('input', opRefresh);
$('opWh').onchange = opRows;
$('opDate').onchange = () => { opRows(); $('opRef').value = nextCode('OP', $('opDate').value || today(), state.adjusts.map(a => a.ref)); };
$('btnCancelOp').onclick = () => $('opDialog').close();
$('btnOpname').onclick = () => {
  if (!state.items.some(i => i.kind === 'barang')) return toast('Belum ada barang');
  $('opDate').value = today(); $('opDesc').value = '';
  fillSelect($('opWh'), state.warehouses, 'Gudang utama'); $('opWh').value = '';
  $('opRef').value = nextCode('OP', today(), state.adjusts.map(a => a.ref));
  opRows(); $('opDialog').showModal();
};
$('opForm').onsubmit = e => {
  const fail = msg => { e.preventDefault(); toast(msg); };
  const date = $('opDate').value, ref = $('opRef').value.trim().slice(0, 40), lines = opDraft();
  if (!DATE_RE.test(date)) return fail('Isi tanggal opname');
  if (isLocked(date)) return fail(lockMsg());
  if (!ref) return fail('No. bukti wajib diisi');
  if (!lines.length) return fail('Isi hitungan fisik minimal satu barang');
  const a = {id: uid(), created: Date.now(), date, ref, desc: $('opDesc').value.trim().slice(0, 500), lines, whId: $('opWh').value || null};
  if (stockCalc(state.trades, state.items, state.returns, [...state.adjusts, a]).neg.size) return fail('Stok jadi minus karena ada penjualan setelah tanggal ini; periksa tanggal opname');
  state.adjusts.push(a);
  log('tambah', 'opname', a.id, `${ref} · ${date} · ${lines.map(l => `${itemOf(l.itemId)?.name} ${l.diff > 0 ? '+' : ''}${l.diff}`).join(', ')}`.slice(0, 500));
  save(); toast('Stok opname tersimpan · ' + ref);
};
function delAdjust(id) {
  const a = state.adjusts.find(x => x.id === id); if (!a) return;
  if (isLocked(a.date)) return toast(lockMsg());
  const rest = state.adjusts.filter(x => x !== a);
  if (stockCalc(state.trades, state.items, state.returns, rest).neg.size) return toast('Stok jadi minus bila opname ini dihapus.');
  const reason = askReason('menghapus stok opname'); if (!reason) return;
  log('hapus', 'opname', a.id, `${a.ref} · ${a.date} · alasan: ${reason}`);
  state.adjusts = rest; save(); toast('Opname dihapus (tercatat di jejak audit)');
}
// Tombol Enter/Go di HP tidak boleh langsung menyimpan form yang panjang
['tradeForm', 'empForm', 'runForm', 'retForm', 'opForm'].forEach(id => {
  $(id).dataset.noenter = '1';
  $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input, select')) e.preventDefault(); });
});
Object.assign(ACTIONS, {delReturn, delAdjust, moreTrade: () => { tradeLimit += TX_PAGE; renderTrade(); }});

/* Kompensasi PPN: tiap masa yang sudah lewat, PPN masukan mengurangi PPN keluaran; lebihnya dibawa ke masa berikutnya */
function ppnMasa() {
  const by = new Map(), get = ym => { if (!by.has(ym)) by.set(ym, {out: 0, in: 0}); return by.get(ym); };
  for (const t of state.trades) {
    if (t.kind === 'sale' && !t.wapu) get(t.date.slice(0, 7)).out += t.ppn;
    if (t.kind === 'purchase' && t.ppnCredit) get(t.date.slice(0, 7)).in += t.ppn;
  }
  for (const r of state.returns) {
    if (r.kind === 'sale' && !r.wapu) get(r.date.slice(0, 7)).out -= r.ppn;
    if (r.kind === 'purchase' && r.ppnCredit) get(r.date.slice(0, 7)).in -= r.ppn;
  }
  const keys = [...by.keys()].sort(), now = today().slice(0, 7), rows = [];
  if (!keys.length) return rows;
  let carry = 0;
  for (let ym = keys[0], n = 0; ym <= (keys.at(-1) > now ? keys.at(-1) : now) && n < 600; ym = addMonths(ym, 1), n++) {
    const m = by.get(ym) || {out: 0, in: 0}, closed = ym < now, avail = Math.max(0, m.in + carry), offset = closed ? Math.min(Math.max(0, m.out), avail) : 0;
    rows.push({ym, out: m.out, in: m.in, carry, offset, pay: Math.max(0, m.out - offset), closed});
    if (closed) carry = avail - offset;
  }
  return rows;
}

/* Ekspor faktur keluaran ke XML impor Coretax (Pajak Keluaran → Impor Data) */
const tin16 = s => { const d = String(s || '').replace(/\D/g, ''); return d.length === 16 ? d : d.length === 15 ? '0' + d : ''; };
function coretaxXml(ym) {
  const T = state.tax, seller = tin16(state.company.npwp);
  if (!seller) return {err: 'Isi NPWP perusahaan (16 digit) di menu Atur'};
  const nitku = /^\d{22}$/.test(state.company.nitku) ? state.company.nitku : seller + '000000';
  const num = n => String(Math.round(n * 100) / 100), x = esc;
  const list_ = state.trades.filter(t => t.kind === 'sale' && t.ppn > 0 && (t.fpDate || t.date).startsWith(ym));
  const skipped = list_.filter(t => !tin16(t.custNpwp)), ok = list_.filter(t => tin16(t.custNpwp));
  const invoices = ok.map(t => {
    const sub = t.lines.reduce((s, l) => s + l.qty * l.price, 0) || 1, buyer = tin16(t.custNpwp);
    const goods = t.lines.filter(l => TAX_TYPES[itemOf(l.itemId)?.taxType]?.ppn !== false).map(l => {
      const it = itemOf(l.itemId), ty = TAX_TYPES[it?.taxType] || TAX_TYPES.bkp, gross = l.qty * l.price, disc = t.discount * gross / sub, base = gross - disc;
      const other = ty.lux ? base : base * T.dppNum / T.dppDen;
      return `<GoodService><Opt>${ty.kind === 'jasa' ? 'B' : 'A'}</Opt><Code>000000</Code><Name>${x(it?.name)}</Name><Unit>UM.0033</Unit><Price>${num(l.price)}</Price><Qty>${num(l.qty)}</Qty><TotalDiscount>${num(disc)}</TotalDiscount><TaxBase>${num(base)}</TaxBase><OtherTaxBase>${num(other)}</OtherTaxBase><VATRate>${T.ppnRate}</VATRate><VAT>${num(other * T.ppnRate / 100)}</VAT><STLGRate>0</STLGRate><STLG>0</STLG></GoodService>`;
    }).join('');
    return `<TaxInvoice><TaxInvoiceDate>${t.fpDate || t.date}</TaxInvoiceDate><TaxInvoiceOpt>Normal</TaxInvoiceOpt><TrxCode>${t.wapu ? (t.wapuKind === 'gov' ? '02' : '03') : '04'}</TrxCode><AddInfo/><CustomDoc/><CustomDocMonthYear/><RefDesc>${x(t.ref)}</RefDesc><FacilityStamp/><SellerIDTKU>${nitku}</SellerIDTKU><BuyerTin>${buyer}</BuyerTin><BuyerDocument>TIN</BuyerDocument><BuyerCountry>IDN</BuyerCountry><BuyerDocumentNumber>-</BuyerDocumentNumber><BuyerName>${x(partyOf(t))}</BuyerName><BuyerAdress>${x(t.custAddr)}</BuyerAdress><BuyerEmail/><BuyerIDTKU>${buyer}000000</BuyerIDTKU><ListOfGoodService>${goods}</ListOfGoodService></TaxInvoice>`;
  });
  return {count: ok.length, skipped, xml: `<?xml version="1.0" encoding="utf-8" ?>\n<TaxInvoiceBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="TaxInvoice.xsd"><TIN>${seller}</TIN><ListOfTaxInvoice>${invoices.join('')}</ListOfTaxInvoice></TaxInvoiceBulk>`};
}
$('btnCoretax').onclick = () => {
  const ym = /^\d{4}-\d{2}$/.test($('xMasa').value) ? $('xMasa').value : today().slice(0, 7), r = coretaxXml(ym);
  if (r.err) return toast(r.err);
  if (r.skipped.length) alert(`${r.skipped.length} faktur tidak ikut karena NPWP pelanggan kosong atau tidak valid: ${r.skipped.map(t => t.ref).join(', ')}`);
  if (!r.count) return toast('Tidak ada faktur keluaran yang bisa diekspor pada masa ini');
  download(r.xml, `faktur-keluaran-${ym}.xml`, 'application/xml');
  toast(`${r.count} faktur diekspor. Impor di Coretax: e-Faktur → Pajak Keluaran → Impor Data.`);
};

/* Pengaturan pajak jual beli */
const TAX_PCT = {xPpn: 'ppnRate', x22: 'pph22', x23: 'pph23', x23r: 'pph23r', x42k: 'pph42k', x42s: 'pph42s'};
function renderTaxRules() {
  const T = state.tax;
  $('xPkp').checked = T.pkp; $('xSkb').checked = T.skb; $('xNum').value = T.dppNum; $('xDen').value = T.dppDen;
  Object.entries(TAX_PCT).forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = String(T[k]).replace('.', ','); });
}
$('btnSaveTax').onclick = () => {
  const T = state.tax, before = JSON.stringify(T);
  T.pkp = $('xPkp').checked; T.skb = $('xSkb').checked;
  const n = +$('xNum').value, d = +$('xDen').value;
  if (n > 0 && d > 0) { T.dppNum = n; T.dppDen = d; }
  Object.entries(TAX_PCT).forEach(([id, k]) => T[k] = cleanPct($(id).value.replace(',', '.'), T[k]));
  if (before !== JSON.stringify(T)) log('ubah', 'pajak', '', `PKP ${T.pkp ? 'ya' : 'tidak'}, PPN ${T.ppnRate}% × ${T.dppNum}/${T.dppDen}, PPh 22 ${T.pph22}%, PPh 23 ${T.pph23}%, final konstruksi ${T.pph42k}%, final sewa ${T.pph42s}%`);
  save(); toast('Pengaturan pajak tersimpan');
};
function setorPajak(acc, label) {
  const amt = Math.max(0, journalBal(acc));
  openTx(); setTxType('out');
  $('txCat').value = sysCat(acc.code)?.id || '';
  $('txAmount').value = amt ? amt.toLocaleString('id-ID') : '';
  $('txDesc').value = `Setoran ${label} (isi NTPN/kode bayar)`;
}
$('btnSetorPpn').onclick = () => setorPajak(ACC_PPN, 'PPN');
$('btnSetorPot').onclick = () => setorPajak(ACC_PPH_POT, 'PPh potput');
$('btnSetorWapu').onclick = () => setorPajak(ACC_PPN_WAPU, 'PPN WAPU');

/* Invoice: susunan baku penagihan B2B: identitas penjual & pembeli, nomor dan tanggal, rincian, pajak, jumlah terhutang, cara bayar, tanda tangan */
function printInvoice(t) {
  const c = state.company, debt = tradeDebt(t), total = tradeTotal(t), gross = total + t.ppn, retAmt = retOf(t).reduce((s, r) => s + retPay(r), 0), due = tradePay(t) - retAmt;
  const remain = debt ? Math.max(0, remainOf(debt)) : 0, paid = !debt || remain <= 0, sub = t.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const meta = [c.address, c.phone, c.email].filter(Boolean).map(esc).join(' · ');
  const ids = [c.npwp && 'NPWP ' + c.npwp, c.nib && 'NIB ' + c.nib].filter(Boolean).map(esc).join(' · ');
  const kv = [['Tanggal', fmtDate(t.date)], ['Jatuh tempo', t.pay === 'credit' ? (t.due ? fmtDate(t.due) : 'Sesuai kesepakatan') : 'Saat diterima'], ['No. PO / kontrak', t.poNo && esc(t.poNo)], ['No. faktur pajak', t.fpNo && esc(t.fpNo)]].filter(x => x[1]);
  const row = (a, b, neg) => `<tr><td>${a}</td><td>${neg ? '(' + rp(b) + ')' : rp(b)}</td></tr>`;
  $('printArea').innerHTML = `<div class="inv">
    <div class="inv-top">
      <div class="inv-co">${logoHTML(56)}<div><b>${esc(c.name || 'Nama Perusahaan')}</b>${c.tagline ? `<i>${esc(c.tagline)}</i><br>` : ''}${meta}${ids ? '<br>' + ids : ''}</div></div>
      <div class="inv-title"><h1>INVOICE</h1><div><b>${esc(t.ref)}</b></div><span class="inv-status ${paid ? 'paid' : 'due'}">${paid ? 'LUNAS' : 'BELUM LUNAS'}</span></div>
    </div>
    <div class="inv-meta">
      <div><div class="inv-lbl">Ditagihkan kepada</div><b>${esc(partyOf(t))}</b>${t.custAddr ? '<br>' + esc(t.custAddr) : ''}${t.custNpwp ? '<br>NPWP ' + esc(t.custNpwp) : ''}</div>
      <table class="inv-kv">${kv.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
    </div>
    <table class="lines"><thead><tr><th style="width:34px">No</th><th>Deskripsi</th><th class="num">Jumlah</th><th class="num">Harga satuan</th><th class="num">Subtotal</th></tr></thead><tbody>
      ${t.lines.map((l, n) => { const it = itemOf(l.itemId); return `<tr><td>${n + 1}</td><td>${esc(it?.name)}${it?.code ? ` <span style="color:#566878">(${esc(it.code)})</span>` : ''}</td><td class="num">${fmtQty(l.qty)} ${esc(it?.unit)}</td><td class="num">${rp(l.price)}</td><td class="num">${rp(l.qty * l.price)}</td></tr>`; }).join('')}
    </tbody></table>
    <div class="inv-bottom">
      <div>
        ${c.bankInfo ? `<div class="inv-lbl">Pembayaran ke</div><div class="inv-pay">${esc(c.bankInfo)}\nCantumkan nomor invoice ${esc(t.ref)} pada berita transfer.</div>` : ''}
        <div class="inv-lbl" style="margin-top:12px">Terbilang</div><i>${esc(terbilang(due))}</i>
        ${t.desc || c.invoiceNote ? `<div class="inv-lbl" style="margin-top:12px">Catatan</div>${esc(t.desc || c.invoiceNote)}` : ''}
      </div>
      <table class="inv-sum">
        ${row('Subtotal', Math.round(sub))}${t.discount ? row('Diskon', t.discount, true) : ''}
        ${t.ppn ? row('Dasar pengenaan pajak', total) + row(`PPN (${state.tax.ppnRate}% × ${state.tax.dppNum}/${state.tax.dppDen})`, t.ppn) + row('Jumlah tagihan', gross) : ''}
        ${t.wapu && t.ppn ? row('PPN dipungut pembeli (WAPU)', t.ppn, true) : ''}
        ${t.pphParts.map(x => row(`${PPH_LABEL[x.code]} ${String(x.rate).replace('.', ',')}%`, x.amt, true)).join('')}
        ${retAmt ? row('Retur', retAmt, true) : ''}
        <tr class="grand"><td>${paid ? 'Total dibayar' : 'Jumlah harus dibayar'}</td><td>${rp(debt && !paid ? remain : due)}</td></tr>
      </table>
    </div>
    <div class="inv-sign"><div>Hormat kami,${due > 5000000 ? '<div class="inv-stamp">Meterai Rp10.000</div>' : '<div style="height:66px"></div>'}<b>${c.checkedName ? esc(c.checkedName) : '(..............................)'}</b><div>${esc(c.checkedTitle)}</div></div></div>
    <div class="inv-foot">Terima kasih atas kepercayaan Anda.</div></div>`;
  document.body.classList.add('print-voucher');
  window.print();
}

/* ---------- Karyawan & penggajian ----------
   Dasar: UU 13/2003 jo. UU 6/2023, PP 35/2021 (PKWT, lembur), PP 36/2021 (upah), Permenaker 6/2016 (THR), PP 58/2023 (TER PPh 21).
   Pilihan upah minimum dan seluruh tarif BPJS bisa diatur sendiri di Karyawan → Aturan. */
const empOf = id => state.employees.find(e => e.id === id);
const monthsBetween = (a, b) => {
  if (!a || !b || b < a) return 0;
  let m = (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + +b.slice(5, 7) - +a.slice(5, 7);
  if (+b.slice(8) < +a.slice(8)) m--;
  return Math.max(0, m);
};
const terPct = (ptkp, bruto) => TER[TER_CAT[ptkp]].find(([up]) => bruto / 1e6 <= up)[1];
function pasal17(pkp) {
  let tax = 0, low = 0;
  for (const [up, r] of PASAL17) { if (pkp <= low) break; tax += (Math.min(pkp, up) - low) * r / 100; low = up; }
  return Math.floor(tax);
}
const empWage = e => e.wage + e.allow;
const belowMin = e => state.hr.umpMode === 'wajib' && state.hr.ump > 0 && e.status !== 'harian' && empWage(e) < state.hr.ump;
const belowFloor = e => state.hr.umpMode === 'kesepakatan' && state.hr.floor > 0 && e.status !== 'harian' && empWage(e) < state.hr.floor;
const empActive = (e, ym) => (!e.joinDate || e.joinDate <= lastDayOf(ym)) && (!e.exitDate || e.exitDate >= ym + '-01');

// Perhitungan satu karyawan satu bulan; prior = akumulasi Januari s.d. bulan sebelumnya, untuk hitung ulang Desember
function payCalc(e, inp, ym, prior) {
  const hr = state.hr, harian = e.status === 'harian', days = harian ? inp.days || 0 : 0;
  // Masuk atau keluar di tengah bulan: upah bulanan dihitung sebanding hari kalender
  const first = ym + '-01', last = lastDayOf(ym), from = e.joinDate > first ? e.joinDate : first, to = e.exitDate && e.exitDate < last ? e.exitDate : last;
  const frac = harian ? 1 : Math.max(0, +to.slice(8) - +from.slice(8) + 1) / +last.slice(8);
  const base = harian ? Math.round(e.wage * days) : Math.round(e.wage * frac), fixed = harian ? e.allow : Math.round(e.allow * frac), wage = base + fixed;
  const varAllow = inp.varAllow || 0, bonus = inp.bonus || 0, deduct = inp.deduct || 0;
  // Upah lembur: PP 35/2021 Pasal 31-33
  const monthly = (harian ? e.wage * (hr.workDays === 6 ? 25 : 21) : e.wage) + e.allow, all = monthly + varAllow;
  const hourly = (varAllow && monthly < all * .75 ? all * .75 : monthly) / 173;
  const otHours = inp.otHours || 0, otDays = otHours ? Math.min(otHours, inp.otDays || Math.ceil(otHours / 4)) : 0;
  const hdHours = inp.hdHours || 0, hdDays = hdHours ? inp.hdDays || 1 : 0, L = hr.workDays === 6 ? 7 : 8;
  const hdPay = h => h <= L ? 2 * h : 2 * L + 3 * Math.min(1, h - L) + 4 * Math.max(0, h - L - 1);
  const ot = Math.round(hourly * (1.5 * otDays + 2 * (otHours - otDays) + (hdDays ? hdDays * hdPay(hdHours / hdDays) : 0)));
  // BPJS dihitung dari upah pokok + tunjangan tetap; JP dan Kesehatan memakai batas upah tertinggi
  const r = (b, p) => Math.round(b * p / 100), tk = e.bpjsTk, ks = e.bpjsKes && hr.onKes;
  const bw = harian ? wage : e.wage + e.allow, jpBase = Math.min(bw, hr.jpCap), kesBase = Math.min(bw, hr.kesCap);
  const co = {jkk: tk && hr.onJkk ? r(bw, hr.jkk) : 0, jkm: tk && hr.onJkm ? r(bw, hr.jkm) : 0, jht: tk && hr.onJht ? r(bw, hr.jhtCo) : 0,
    jp: tk && hr.onJp ? r(jpBase, hr.jpCo) : 0, kes: ks ? r(kesBase, hr.kesCo) : 0};
  const ee = {jht: tk && hr.onJht ? r(bw, hr.jhtEe) : 0, jp: tk && hr.onJp ? r(jpBase, hr.jpEe) : 0, kes: ks ? r(kesBase, hr.kesEe) : 0};
  const coTotal = co.jkk + co.jkm + co.jht + co.jp + co.kes, eeTotal = ee.jht + ee.jp + ee.kes;
  const cash = wage + varAllow + ot + bonus;
  // Objek PPh 21: JKK, JKM, dan BPJS Kesehatan bagian perusahaan ikut menambah bruto; JHT dan JP bagian perusahaan tidak
  const b0 = cash + co.jkk + co.jkm + co.kes, dec = (ym.endsWith('-12') || (e.exitDate || '').startsWith(ym)) && !harian;
  const pphOf = b => {
    if (harian) { const perDay = days ? b / days : b; return perDay > 2.5e6 ? pasal17(Math.round(b * .5)) : perDay <= 450000 ? 0 : Math.floor(b * .005); }
    if (dec) {
      const yb = prior.bruto + b, neto = yb - Math.min(yb * .05, 500000 * (prior.months + 1)) - prior.iur - ee.jht - ee.jp;
      return pasal17(Math.floor(Math.max(0, neto - PTKP[e.ptkp]) / 1000) * 1000) - prior.pph;
    }
    return Math.floor(b * terPct(e.ptkp, b) / 100);
  };
  let taxAllow = 0, pph;
  if (e.taxBy === 'perusahaan') {
    for (let n = 0; n < 40; n++) { const next = Math.max(0, pphOf(b0 + taxAllow)); if (next === taxAllow) break; taxAllow = next; }
    pph = taxAllow;
  } else pph = pphOf(b0);
  const bruto = b0 + taxAllow, net = cash - eeTotal - deduct - (e.taxBy === 'perusahaan' ? 0 : pph);
  return {empId: e.id, name: e.name, title: e.title, ptkp: e.ptkp, status: e.status, taxBy: e.taxBy, days, otHours, hdHours, rate: harian || dec ? 0 : terPct(e.ptkp, bruto),
    base, fixed, varAllow, ot, bonus, deduct, taxAllow, bruto, pph, net, co, ee, coTotal, eeTotal, dec, frac};
}
function yearPrior(empId, ym) {
  const p = {bruto: 0, iur: 0, pph: 0, months: 0};
  for (const r of state.payrolls) {
    if (r.period.slice(0, 4) !== ym.slice(0, 4) || r.period >= ym) continue;
    for (const l of r.lines) if (l.empId === empId) { p.bruto += l.bruto; p.iur += l.ee.jht + l.ee.jp; p.pph += l.pph; p.months++; }
  }
  return p;
}
const lineCo = l => l.co.jkk + l.co.jkm + l.co.jht + l.co.jp + l.co.kes;
const lineEe = l => l.ee.jht + l.ee.jp + l.ee.kes;
const paySum = p => p.lines.reduce((s, l) => { s.net += l.net; s.pph += l.pph; s.co += lineCo(l); s.ee += lineEe(l); s.deduct += l.deduct; return s; }, {net: 0, pph: 0, co: 0, ee: 0, deduct: 0});
function pkwtComp(e, upTo) {
  const m = monthsBetween(e.joinDate, e.exitDate || upTo || today());
  return m >= 1 ? Math.round(m / 12 * empWage(e)) : 0;
}
function journalBal(acc) {
  let b = 0;
  for (const x of M().journal) { if (x.cr.code === acc.code) b += x.amt; if (x.dr.code === acc.code) b -= x.amt; }
  return b;
}

let hrTab = 'emp';
function renderHr() {
  document.querySelectorAll('#hrTabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === hrTab); b.setAttribute('aria-pressed', b.dataset.tab === hrTab); });
  ['emp', 'pay', 'rules', 'att', 'leave', 'kas', 'doc', 'rev', 'shift'].forEach(k => $('hr-' + k).style.display = k === hrTab ? '' : 'none');
  const hr = state.hr, ym = today().slice(0, 7), act = state.employees.filter(e => empActive(e, ym));
  const lastRun = state.payrolls.slice().sort((a, b) => b.period.localeCompare(a.period))[0], s = lastRun && paySum(lastRun);
  $('hrCards').innerHTML = [
    ['Karyawan aktif', String(act.length), '', `${act.filter(e => e.status === 'pkwtt').length} tetap · ${act.filter(e => e.status === 'pkwt').length} kontrak · ${act.filter(e => e.status === 'harian').length} harian`],
    ['Ditanggung perusahaan', s ? rp(s.co + lastRun.lines.reduce((x, l) => x + l.taxAllow, 0)) : '—', 'out', s ? 'BPJS + PPh ditanggung, ' + ymLabel(lastRun.period) : ''],
    ['Ditanggung karyawan', s ? rp(s.ee + lastRun.lines.reduce((x, l) => x + (l.taxBy === 'karyawan' ? l.pph : 0), 0)) : '—', '', s ? 'BPJS + PPh 21 dipotong gaji' : ''],
    ['Utang PPh 21', rp(journalBal(ACC_PPH21)), '', 'Belum disetor'],
    ['Utang BPJS', rp(journalBal(ACC_BPJS)), '', 'Belum disetor'],
  ].map(statCard).join('');
  if (hrTab === 'rules') return renderRules();
  if (['att', 'leave', 'kas'].includes(hrTab)) return renderHrExtra();
  if (['doc', 'rev', 'shift'].includes(hrTab)) return renderHrMore();
  if (hrTab === 'pay') {
    $('payBody').innerHTML = state.payrolls.length ? state.payrolls.slice().sort((a, b) => b.period.localeCompare(a.period)).map(p => {
      const t = paySum(p);
      return `<tr><td data-label="Periode"><b>${ymLabel(p.period)}</b></td><td data-label="No. bukti">${esc(p.ref)}</td><td data-label="Karyawan">${p.lines.length}</td>
        <td data-label="Gaji bersih" class="num">${rp(t.net)}</td><td data-label="PPh 21" class="num">${rp(t.pph)}</td>
        <td data-label="BPJS perusahaan" class="num">${rp(t.co)}</td><td data-label="BPJS karyawan" class="num">${rp(t.ee)}</td>
        <td data-label="" class="no-print num" style="white-space:nowrap"><button class="btn sm" data-act="openPayRun" data-id="${esc(p.id)}">Detail</button></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty" data-label="">Belum ada penggajian.</td></tr>';
    return;
  }
  const now = today(), q = $('eSearch').value.toLowerCase();
  const rows = state.employees.filter(e => !q || (e.name + ' ' + e.title).toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  $('empBody').innerHTML = rows.length ? rows.map(e => {
    const out = e.exitDate && e.exitDate < now, soon = e.status === 'pkwt' && e.endDate && daysBetween(now, e.endDate) <= 30;
    return `<tr><td data-label="Nama"><b>${esc(e.name)}</b><div class="muted" style="font-size:12px">${esc(e.title)}</div></td>
      <td data-label="Status"><span class="badge ${e.status === 'pkwtt' ? 'in' : e.status === 'pkwt' ? 'warn' : 'tr'}">${EMP_STATUS[e.status]}</span>${out ? ' <span class="badge out">Keluar</span>' : ''}</td>
      <td data-label="Mulai">${e.joinDate ? fmtDate(e.joinDate) : '—'}</td>
      <td data-label="Kontrak s.d." class="${soon ? 'out' : ''}">${e.status === 'pkwt' && e.endDate ? fmtDate(e.endDate) : '—'}</td>
      <td data-label="PTKP">${esc(e.ptkp)}</td>
      <td data-label="Upah" class="num ${belowMin(e) || belowFloor(e) ? 'out' : ''}">${rp(empWage(e))}${e.status === 'harian' ? '/hari' : ''}</td>
      <td data-label="" class="no-print num"><button class="btn sm" data-act="openEmp" data-id="${esc(e.id)}">Ubah</button></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty" data-label="">Belum ada data karyawan.</td></tr>';
}
document.querySelectorAll('#hrTabs button').forEach(b => b.onclick = () => { hrTab = b.dataset.tab; renderHr(); rememberView(); });
$('eSearch').oninput = debounce(() => renderHr());

/* Aturan upah minimum & tarif */
const RULE_PCT = {hJkk: 'jkk', hJkm: 'jkm', hJhtCo: 'jhtCo', hJhtEe: 'jhtEe', hJpCo: 'jpCo', hJpEe: 'jpEe', hKesCo: 'kesCo', hKesEe: 'kesEe'};
const RULE_MONEY = {hUmp: 'ump', hFloor: 'floor', hJpCap: 'jpCap', hKesCap: 'kesCap'};
const RULE_ON = {hOnJkk: 'onJkk', hOnJkm: 'onJkm', hOnJht: 'onJht', hOnJp: 'onJp', hOnKes: 'onKes'};
function showUmpMode() {
  const wajib = $('hMode').value === 'wajib';
  $('hUmpWrap').style.display = wajib ? '' : 'none';
  $('hFloorWrap').style.display = wajib ? 'none' : '';
  $('hModeInfo').textContent = wajib
    ? 'Upah pokok + tunjangan tetap tidak boleh di bawah UMP/UMK yang ditetapkan gubernur. Isi angkanya dari keputusan gubernur tahun berjalan; aplikasi memberi peringatan bila ada upah di bawahnya.'
    : 'Usaha mikro dan kecil dikecualikan dari upah minimum. Upah ditetapkan berdasarkan kesepakatan pengusaha dan pekerja, paling sedikit 50% rata-rata konsumsi masyarakat provinsi dan paling sedikit 25% di atas garis kemiskinan provinsi (PP 36/2021 Pasal 36). Uang kompensasi PKWT juga mengikuti kesepakatan (PP 35/2021 Pasal 16 ayat 6).';
}
function renderRules() {
  const h = state.hr;
  $('hMode').value = h.umpMode; $('hDays').value = String(h.workDays);
  Object.entries(RULE_PCT).forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = String(h[k]).replace('.', ','); });
  Object.entries(RULE_MONEY).forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = h[k] ? h[k].toLocaleString('id-ID') : ''; });
  Object.entries(RULE_ON).forEach(([id, k]) => $(id).checked = h[k]);
  showUmpMode();
}
Object.keys(RULE_MONEY).forEach(id => moneyInput($(id)));
$('hMode').onchange = showUmpMode;
$('btnSaveRules').onclick = () => {
  const h = state.hr, before = JSON.stringify(h);
  h.umpMode = $('hMode').value === 'kesepakatan' ? 'kesepakatan' : 'wajib';
  h.workDays = +$('hDays').value === 6 ? 6 : 5;
  Object.entries(RULE_PCT).forEach(([id, k]) => h[k] = cleanPct($(id).value.replace(',', '.'), h[k]));
  Object.entries(RULE_MONEY).forEach(([id, k]) => h[k] = parseMoney($(id).value));
  Object.entries(RULE_ON).forEach(([id, k]) => h[k] = $(id).checked);
  if (before !== JSON.stringify(h)) log('ubah', 'aturan upah', '', `Upah minimum: ${h.umpMode}, UMP ${rp(h.ump)}, JKK ${h.jkk}%, batas JP ${rp(h.jpCap)}, batas Kesehatan ${rp(h.kesCap)}`);
  save(); toast('Aturan tersimpan');
};

/* Dialog karyawan */
let editingEmp = null;
const EMP_TEXT = {eName: 'name', eNik: 'nik', eNpwp: 'npwp', eTitle: 'title', eTkNo: 'bpjsTkNo', eKesNo: 'bpjsKesNo', eBank: 'bank'};
function showEmpFields() {
  const st = $('eStatus').value;
  $('eEndWrap').style.display = st === 'pkwt' ? '' : 'none';
  $('eWageLabel').textContent = st === 'harian' ? 'Upah per hari (Rp)' : 'Gaji pokok per bulan (Rp)';
  const w = parseMoney($('eWage').value) + parseMoney($('eAllow').value), hr = state.hr, notes = [];
  if (st !== 'harian' && hr.umpMode === 'wajib' && hr.ump && w && w < hr.ump) notes.push(`<span class="out">Upah di bawah UMP/UMK ${rp(hr.ump)}.</span>`);
  if (st !== 'harian' && hr.umpMode === 'kesepakatan' && hr.floor && w && w < hr.floor) notes.push(`<span class="out">Upah di bawah batas bawah kesepakatan ${rp(hr.floor)}.</span>`);
  if (st !== 'harian' && hr.umpMode === 'wajib' && !hr.ump) notes.push('Isi nilai UMP/UMK di tab Aturan agar upah bisa diperiksa.');
  if (st === 'pkwt') {
    notes.push('PKWT tidak boleh untuk pekerjaan tetap dan seluruh jangka waktunya beserta perpanjangan paling lama 5 tahun (PP 35/2021 Pasal 8).');
    const j = $('eJoin').value, end = $('eEnd').value;
    if (j && end && monthsBetween(j, end) > 60) notes.push('<span class="out">Jangka waktu kontrak melebihi 5 tahun.</span>');
    if (j && w) {
      const m = monthsBetween(j, end || today());
      notes.push(hr.umpMode === 'kesepakatan' ? 'Uang kompensasi saat kontrak berakhir mengikuti kesepakatan (usaha mikro/kecil).'
        : m >= 1 ? `Perkiraan uang kompensasi saat kontrak berakhir: ${rp(Math.round(m / 12 * w))} (${m} bulan ÷ 12 × upah).` : '');
    }
  }
  $('eHint').innerHTML = notes.filter(Boolean).join('<br>');
}
function openEmp(id) {
  editingEmp = id ? empOf(id) : null;
  const e = editingEmp || {status: 'pkwtt', gender: 'L', ptkp: 'TK/0', taxBy: 'karyawan', bpjsTk: true, bpjsKes: true, joinDate: today()};
  $('empTitle').textContent = editingEmp ? 'Ubah Data Karyawan' : 'Karyawan Baru';
  Object.entries(EMP_TEXT).forEach(([el, k]) => $(el).value = e[k] || '');
  $('eGender').value = e.gender; $('eStatus').value = e.status; $('ePtkp').value = e.ptkp; $('eTaxBy').value = e.taxBy;
  $('eJoin').value = e.joinDate || ''; $('eEnd').value = e.endDate || ''; $('eExit').value = e.exitDate || '';
  $('eWage').value = e.wage ? e.wage.toLocaleString('id-ID') : ''; $('eAllow').value = e.allow ? e.allow.toLocaleString('id-ID') : '';
  $('eTk').checked = e.bpjsTk; $('eKes').checked = e.bpjsKes;
  $('btnDeleteEmp').style.display = editingEmp ? '' : 'none';
  showEmpFields();
  $('empDialog').showModal();
}
moneyInput($('eWage')); moneyInput($('eAllow'));
['eStatus', 'eWage', 'eAllow', 'eJoin', 'eEnd'].forEach(id => $(id).addEventListener('input', showEmpFields));
$('btnCancelEmp').onclick = () => $('empDialog').close();
$('empForm').onsubmit = ev => {
  const fail = msg => { ev.preventDefault(); toast(msg); };
  const name = $('eName').value.trim(), status = $('eStatus').value;
  if (!name) return fail('Isi nama karyawan');
  if (!DATE_RE.test($('eJoin').value)) return fail('Isi tanggal mulai kerja');
  if (parseMoney($('eWage').value) <= 0) return fail('Isi upah');
  const nik = $('eNik').value.trim();
  if (nik && !/^\d{16}$/.test(nik)) return fail('NIK harus 16 angka');
  if (status === 'pkwt' && !DATE_RE.test($('eEnd').value)) return fail('Isi tanggal berakhir kontrak (PKWT)');
  if (status === 'pkwt' && $('eEnd').value <= $('eJoin').value) return fail('Tanggal berakhir kontrak harus setelah tanggal mulai');
  if (status === 'pkwt' && monthsBetween($('eJoin').value, $('eEnd').value) > 60) return fail('PKWT paling lama 5 tahun termasuk perpanjangan');
  if ($('eExit').value && $('eExit').value < $('eJoin').value) return fail('Tanggal keluar tidak boleh sebelum tanggal mulai');
  const data = {gender: $('eGender').value === 'P' ? 'P' : 'L', status, ptkp: $('ePtkp').value, taxBy: $('eTaxBy').value === 'perusahaan' ? 'perusahaan' : 'karyawan',
    joinDate: $('eJoin').value, endDate: status === 'pkwt' ? $('eEnd').value : '', exitDate: $('eExit').value,
    wage: parseMoney($('eWage').value), allow: parseMoney($('eAllow').value), bpjsTk: $('eTk').checked, bpjsKes: $('eKes').checked};
  Object.entries(EMP_TEXT).forEach(([el, k]) => data[k] = $(el).value.trim().slice(0, 120));
  if ((belowMin(data) || belowFloor(data)) && !confirm(`Upah ${data.name} ${rp(empWage(data))} di bawah batas yang diatur di tab Aturan. Tetap simpan?`)) return fail('Dibatalkan');
  // Rincian pribadi dan upah tidak ditulis ke jejak audit, karena jejak audit terbaca semua anggota
  if (editingEmp) {
    Object.assign(editingEmp, data);
    log('ubah', 'karyawan', editingEmp.id, `${data.name} · ${EMP_STATUS[status]}`);
  } else {
    const e = {id: uid(), created: Date.now(), ...data};
    state.employees.push(e);
    log('tambah', 'karyawan', e.id, `${data.name} · ${EMP_STATUS[status]}`);
  }
  save(); toast('Data karyawan tersimpan');
};
$('btnDeleteEmp').onclick = () => {
  if (!editingEmp) return;
  if (state.payrolls.some(p => p.lines.some(l => l.empId === editingEmp.id))) return toast('Sudah ada riwayat gaji. Isi tanggal keluar saja agar riwayatnya tetap tersimpan.');
  if (!confirm('Hapus data karyawan ini?')) return;
  log('hapus', 'karyawan', editingEmp.id, editingEmp.name);
  state.employees = state.employees.filter(x => x !== editingEmp);
  $('empDialog').close(); save();
};
$('btnAddEmp').onclick = () => openEmp();

/* Proses gaji: perhitungan langsung tampil saat angka diisi */
const RUN_INPUTS = [['days', 'Hari kerja', 0], ['varAllow', 'Tunjangan tidak tetap', 1], ['otHours', 'Jam lembur hari kerja', 0], ['otDays', 'Dalam berapa hari', 0],
  ['hdHours', 'Jam lembur hari libur', 0], ['hdDays', 'Dalam berapa hari', 0], ['bonus', 'Bonus / THR', 1], ['deduct', 'Potongan kasbon', 1]];
const runPeriod = () => /^\d{4}-\d{2}$/.test($('runPeriod').value) ? $('runPeriod').value : today().slice(0, 7);
function runInputs(row) {
  const o = {};
  row.querySelectorAll('input[data-k]').forEach(x => o[x.dataset.k] = x.classList.contains('m') ? parseMoney(x.value) : parseQty(x.value));
  return o;
}
function runRowCalc(row) {
  const e = empOf(row.dataset.id), ym = runPeriod();
  return payCalc(e, runInputs(row), ym, yearPrior(e.id, ym));
}
// Batas waktu lembur: PP 35/2021 Pasal 26 (lembur di hari libur tidak termasuk batas ini)
function otWarn(ym, inp) {
  const w = [], days = +lastDayOf(ym).slice(8), h = inp.otHours || 0, d = inp.otDays || Math.ceil(h / 4), L = state.hr.workDays === 6 ? 11 : 12;
  if (h && h / d > 4) w.push('Lembur hari kerja melebihi 4 jam sehari.');
  if (h > 18 * days / 7) w.push(`Lembur hari kerja melebihi 18 jam seminggu (sekitar ${Math.floor(18 * days / 7)} jam sebulan).`);
  if (inp.hdHours && inp.hdHours / (inp.hdDays || 1) > L) w.push(`Lembur hari libur melebihi ${L} jam sehari.`);
  if (h && h / d >= 4) w.push('Lembur 4 jam atau lebih wajib diberi makan dan minum minimal 1.400 kkal, tidak bisa diganti uang.');
  return w;
}
function runRefresh() {
  const tot = {net: 0, pph: 0, co: 0, ee: 0, taxAllow: 0};
  $('runRows').querySelectorAll('.prow').forEach(row => {
    const c = runRowCalc(row);
    tot.net += c.net; tot.pph += c.pph; tot.co += c.coTotal; tot.ee += c.eeTotal; tot.taxAllow += c.taxAllow;
    const karyawanPph = c.taxBy === 'karyawan' ? c.pph : 0;
    const warn = otWarn(runPeriod(), runInputs(row));
    row.querySelector('.pcalc').innerHTML = `${warn.map(x => `<div class="out">${x}</div>`).join('')}<table class="split"><thead><tr><th></th><th class="num">Perusahaan</th><th class="num">Karyawan</th></tr></thead>
      <tr><td>JKK</td><td class="num">${rp(c.co.jkk)}</td><td class="num">—</td></tr>
      <tr><td>JKM</td><td class="num">${rp(c.co.jkm)}</td><td class="num">—</td></tr>
      <tr><td>JHT</td><td class="num">${rp(c.co.jht)}</td><td class="num">${rp(c.ee.jht)}</td></tr>
      <tr><td>JP</td><td class="num">${rp(c.co.jp)}</td><td class="num">${rp(c.ee.jp)}</td></tr>
      <tr><td>BPJS Kesehatan</td><td class="num">${rp(c.co.kes)}</td><td class="num">${rp(c.ee.kes)}</td></tr>
      <tr><td>PPh 21 ${c.dec ? '(hitung ulang masa terakhir)' : c.status === 'harian' ? '(TER harian)' : `(TER ${TER_CAT[c.ptkp]} ${String(c.rate).replace('.', ',')}%)`}</td><td class="num">${rp(c.taxAllow)}</td><td class="num">${rp(karyawanPph)}</td></tr>
      <tr class="total"><td>Total ditanggung</td><td class="num">${rp(c.coTotal + c.taxAllow)}</td><td class="num">${rp(c.eeTotal + karyawanPph)}</td></tr></table>
      <div style="margin-top:6px">Upah ${rp(c.base + c.fixed)}${c.frac < 1 ? ` (prorata ${pct(c.frac * 100)})` : ''}${c.ot ? ' · lembur ' + rp(c.ot) : ''} · bruto pajak ${rp(c.bruto)} · <b>Gaji bersih ${rp(c.net)}</b>${c.net < 0 ? ' <span class="out">minus, periksa potongan</span>' : ''}</div>`;
  });
  $('runTotal').innerHTML = `Dibayar ke karyawan <b>${rp(tot.net)}</b> · PPh 21 disetor <b>${rp(tot.pph)}</b> · BPJS disetor <b>${rp(tot.co + tot.ee)}</b> (perusahaan ${rp(tot.co)}, karyawan ${rp(tot.ee)})`;
}
function renderRun() {
  const ym = runPeriod(), doneIds = new Set(state.payrolls.filter(p => p.period === ym).flatMap(p => p.lines.map(l => l.empId)));
  const emps = state.employees.filter(e => empActive(e, ym) && !doneIds.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  $('runInfo').textContent = doneIds.size ? `${doneIds.size} karyawan sudah digaji untuk ${ymLabel(ym)} dan tidak ditampilkan lagi.` : '';
  $('runRows').innerHTML = emps.length ? emps.map(e => `<div class="prow" data-id="${esc(e.id)}">
    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div><b>${esc(e.name)}</b> <span class="muted">${esc(e.title)} · ${EMP_STATUS[e.status]} · ${esc(e.ptkp)}</span></div>
    <button type="button" class="btn sm" data-act="fillThr" data-id="${esc(e.id)}">Hitung THR</button></div>
    <div class="form-grid pin">${RUN_INPUTS.filter(([k]) => k !== 'days' || e.status === 'harian').map(([k, label, money]) => `<label class="f">${label}<input data-k="${k}" class="${money ? 'm' : ''}" inputmode="${money ? 'numeric' : 'decimal'}"></label>`).join('')}</div>
    ${belowMin(e) ? `<div class="out" style="font-size:12px;margin-top:6px">Upah di bawah UMP/UMK ${rp(state.hr.ump)}.</div>` : ''}
    <div class="pcalc"></div></div>`).join('') : '<div class="empty">Tidak ada karyawan yang perlu digaji pada periode ini.</div>';
  $('runRef').value = nextCode('GJ', $('runDate').value || today(), state.payrolls.map(p => p.ref));
  erpRunPrefill(ym);
  runRefresh();
}
$('runRows').addEventListener('input', e => {
  if (e.target.classList.contains('m')) { const n = parseMoney(e.target.value); e.target.value = n ? n.toLocaleString('id-ID') : ''; }
  const row = e.target.closest('.prow'); if (row) runRefresh();
});
function openRun() {
  if (!state.employees.length) return toast('Tambahkan data karyawan dulu');
  if (!state.accounts.length) return toast('Tambahkan akun dulu di menu Atur');
  fillSelect($('runAcc'), state.accounts);
  $('runPeriod').value = today().slice(0, 7); $('runDate').value = today();
  renderRun();
  $('runDialog').showModal();
}
$('runPeriod').oninput = renderRun;
$('runDate').onchange = () => { $('runRef').value = nextCode('GJ', $('runDate').value || today(), state.payrolls.map(p => p.ref)); };
$('btnRun').onclick = openRun;
$('btnCancelRun').onclick = () => $('runDialog').close();
$('runForm').onsubmit = ev => {
  const fail = msg => { ev.preventDefault(); toast(msg); };
  const date = $('runDate').value, ref = $('runRef').value.trim().slice(0, 40), period = runPeriod();
  const rows = [...$('runRows').querySelectorAll('.prow')];
  if (!rows.length) return fail('Tidak ada karyawan pada periode ini');
  if (!DATE_RE.test(date)) return fail('Isi tanggal bayar');
  if (isLocked(date)) return fail(lockMsg());
  if (!ref) return fail('No. bukti wajib diisi');
  if (state.tx.some(t => t.ref === ref)) return fail(`No. bukti ${ref} sudah dipakai`);
  const over = rows.flatMap(r => otWarn(period, runInputs(r)).filter(x => /melebihi/.test(x)));
  if (over.length && !confirm(`Ada lembur melebihi batas PP 35/2021 Pasal 26:\n${[...new Set(over)].join('\n')}\nTetap simpan?`)) return fail('Dibatalkan');
  const lines = rows.map(runRowCalc).map(cleanPayLine).filter(l => l.bruto > 0);
  if (!lines.length) return fail('Belum ada upah yang diisi');
  if (lines.some(l => l.net < 0)) return fail('Ada gaji bersih minus; periksa potongan');
  const p = {id: uid(), created: Date.now(), period, date, ref, accountId: $('runAcc').value, lines}, s = paySum(p);
  if (s.net <= 0) return fail('Total gaji harus lebih dari 0');
  state.payrolls.push(p);
  state.tx.push({id: uid(), created: Date.now(), type: 'out', date, ref, amount: s.net, accountId: p.accountId, categoryId: sysCat('5-201')?.id, toAccountId: null,
    desc: `Gaji ${ymLabel(period)} (${lines.length} karyawan)`, payrollId: p.id});
  log('tambah', 'penggajian', p.id, `${ref} · ${period} · ${lines.length} karyawan · bersih ${rp(s.net)} · PPh 21 ${rp(s.pph)} · BPJS ${rp(s.co + s.ee)}`);
  hrTab = 'pay'; save(); toast('Penggajian tersimpan · ' + ref);
};

let viewingRun = null;
function openPayRun(id) {
  viewingRun = state.payrolls.find(p => p.id === id); if (!viewingRun) return;
  const p = viewingRun, s = paySum(p);
  $('prTitle').textContent = `Gaji ${ymLabel(p.period)} · ${p.ref}`;
  $('prBody').innerHTML = `<table class="rtable"><thead><tr><th>Nama</th><th class="num">Bruto</th><th class="num">BPJS perusahaan</th><th class="num">BPJS karyawan</th><th class="num">PPh 21</th><th class="num">Bersih</th><th></th></tr></thead><tbody>
    ${p.lines.map(l => `<tr><td data-label="Nama">${esc(l.name)}</td><td data-label="Bruto" class="num">${rp(l.bruto)}</td><td data-label="BPJS perusahaan" class="num">${rp(lineCo(l))}</td>
      <td data-label="BPJS karyawan" class="num">${rp(lineEe(l))}</td><td data-label="PPh 21" class="num">${rp(l.pph)}${l.taxBy === 'perusahaan' ? ' (ditanggung)' : ''}</td><td data-label="Bersih" class="num"><b>${rp(l.net)}</b></td>
      <td data-label="" class="num"><button type="button" class="btn sm" data-act="printSlip" data-id="${esc(l.empId)}">Slip</button></td></tr>`).join('')}
    </tbody></table><p class="muted">Dibayar ${fmtDate(p.date)} dari ${esc(accName(p.accountId))}. Total bersih ${rp(s.net)}, PPh 21 ${rp(s.pph)}, BPJS ${rp(s.co + s.ee)}.</p>
    ${isLocked(p.date) ? `<div class="notice">${esc(lockMsg())}</div>` : ''}`;
  $('btnDeleteRun').style.display = isLocked(p.date) ? 'none' : '';
  $('prDialog').showModal();
}
$('btnClosePr').onclick = () => $('prDialog').close();
$('btnDeleteRun').onclick = () => {
  const p = viewingRun;
  if (!p || isLocked(p.date)) return toast(lockMsg());
  if (state.payrolls.some(x => x !== p && x.period > p.period && x.period.slice(0, 4) === p.period.slice(0, 4) && x.period.endsWith('-12'))) return toast('Gaji Desember tahun ini sudah dihitung; hapus gaji Desember dulu.');
  const reason = askReason('menghapus penggajian'); if (!reason) return;
  log('hapus', 'penggajian', p.id, `${p.ref} · ${p.period} · alasan: ${reason}`);
  state.tx = state.tx.filter(t => t.payrollId !== p.id);
  state.payrolls = state.payrolls.filter(x => x !== p);
  $('prDialog').close(); save(); toast('Penggajian dihapus (tercatat di jejak audit)');
};
function printSlip(empId) {
  const p = viewingRun, l = p?.lines.find(x => x.empId === empId); if (!l) return;
  const row = (a, b) => `<tr><td>${a}</td><td class="num">${rp(b)}</td></tr>`;
  $('printArea').innerHTML = `<div class="report">${kop('SLIP GAJI', ymLabel(p.period) + ' · No. ' + esc(p.ref))}
    <p>Nama: <b>${esc(l.name)}</b><br>Jabatan: ${esc(l.title)}<br>Status PTKP: ${esc(l.ptkp)}<br>Tanggal bayar: ${fmtDate(p.date)}</p>
    <table><tr class="sect"><td colspan="2">Penerimaan</td></tr>${row('Gaji pokok', l.base)}${row('Tunjangan tetap', l.fixed)}${l.varAllow ? row('Tunjangan tidak tetap', l.varAllow) : ''}${l.ot ? row('Upah lembur', l.ot) : ''}${l.bonus ? row('Bonus / THR', l.bonus) : ''}
    <tr class="sect"><td colspan="2">Potongan</td></tr>${row('BPJS JHT (2%)'.replace('2%', state.hr.jhtEe + '%'), l.ee.jht)}${row('BPJS JP', l.ee.jp)}${row('BPJS Kesehatan', l.ee.kes)}${l.taxBy === 'karyawan' ? row('PPh 21', l.pph) : ''}${l.deduct ? row('Kasbon', l.deduct) : ''}
    <tr class="total"><td>Gaji bersih diterima</td><td class="num">${rp(l.net)}</td></tr></table>
    <p class="muted" style="font-size:12px">Ditanggung perusahaan (tidak memotong gaji): BPJS ${rp(lineCo(l))}${l.taxBy === 'perusahaan' ? `, PPh 21 ${rp(l.pph)}` : ''}.</p>
    <p><i>${esc(terbilang(l.net))}</i></p>
    <div class="sign"><div>Penerima<div class="sp"></div><b>${esc(l.name.toUpperCase())}</b></div><div>Disetujui oleh<div class="sp"></div><b>${state.company.checkedName ? esc(state.company.checkedName.toUpperCase()) : '(..............................)'}</b></div></div></div>`;
  document.body.classList.add('print-voucher');
  window.print();
}
function setorUtang(acc) {
  const amt = Math.max(0, journalBal(acc));
  openTx();
  setTxType('out');
  $('txCat').value = sysCat(acc.code)?.id || '';
  $('txAmount').value = amt ? amt.toLocaleString('id-ID') : '';
  $('txDesc').value = `Setoran ${acc === ACC_PPH21 ? 'PPh 21' : 'iuran BPJS'} (isi NTPN/kode bayar)`;
}
$('btnSetorPph').onclick = () => setorUtang(ACC_PPH21);
$('btnSetorBpjs').onclick = () => setorUtang(ACC_BPJS);

Object.assign(ACTIONS, {
  openTrade: id => openTrade(id), openItem: id => { afterItem = null; openItem(id); }, openVendor: id => { afterVendor = null; openVendor(id); },
  openEmp, openPayRun, printSlip,
  delLine: n => { tradeLines.splice(+n, 1); if (!tradeLines.length) tradeLines.push({itemId: '', qty: 1, price: 0}); renderTradeLines(); },
  // THR: Permenaker 6/2016 Pasal 3, dihitung dari upah pokok + tunjangan tetap
  fillThr: id => {
    const e = empOf(id), row = $('runRows').querySelector(`.prow[data-id="${CSS.escape(id)}"]`); if (!e || !row) return;
    const m = monthsBetween(e.joinDate, $('runDate').value || today());
    if (m < 1) return toast('Masa kerja belum 1 bulan: belum berhak THR');
    // Harian lepas: rata-rata upah yang diterima, paling banyak 12 bulan terakhir (Pasal 3 ayat 3)
    const hist = state.payrolls.filter(p => p.period < runPeriod()).sort((a, b) => b.period.localeCompare(a.period)).flatMap(p => p.lines.filter(l => l.empId === id)).slice(0, 12);
    const wage = e.status !== 'harian' ? empWage(e) : hist.length ? hist.reduce((s, l) => s + l.base + l.fixed, 0) / hist.length : e.wage * (state.hr.workDays === 6 ? 25 : 21) + e.allow;
    const thr = Math.round(wage * Math.min(m, 12) / 12), el = row.querySelector('input[data-k="bonus"]');
    el.value = thr.toLocaleString('id-ID');
    toast(`THR ${e.name}: ${rp(thr)} (masa kerja ${m} bulan). Wajib dibayar paling lambat 7 hari sebelum hari raya.`);
    runRefresh();
  },
});

/* Pengingat & laporan modul usaha */
function bizObligations() {
  const out = [], now = today(), ym = now.slice(0, 7), hr = state.hr;
  out.push(...erpObligations());
  const ppn = journalBal(ACC_PPN), ppnW = journalBal(ACC_PPN_WAPU), pot = journalBal(ACC_PPH_POT);
  if (ppn > 0) out.push(['warn', `Utang PPN belum disetor: <b>${rp(ppn)}</b> (sudah dikurangi PPN masukan masa yang lewat). Lihat Rekap Faktur &amp; Pajak.`]);
  if (ppnW > 0) out.push(['warn', `PPN yang dipungut dari vendor (WAPU) belum disetor: <b>${rp(ppnW)}</b>.`]);
  if (pot > 0) out.push([+now.slice(8) > 15 ? 'bad' : 'warn', `PPh yang dipotong/dipungut dari vendor belum disetor: <b>${rp(pot)}</b>. Setor paling lambat tanggal 15 bulan berikutnya dan buat bukti potongnya.`]);
  const low = state.items.filter(i => { const s = M().stock.stock.get(i.id); return s && i.minQty && s.qty <= i.minQty; });
  if (low.length) out.push(['warn', `Stok menipis: ${low.slice(0, 5).map(i => esc(i.name)).join(', ')}${low.length > 5 ? ` dan ${low.length - 5} lainnya` : ''}.`]);
  const act = state.employees.filter(e => empActive(e, ym));
  if (!act.length) return out;
  if (hr.umpMode === 'wajib' && !hr.ump) out.push(['warn', 'Isi nilai UMP/UMK, atau pilih <b>tidak wajib upah minimum</b> bila usaha mikro/kecil, di Karyawan → Aturan.']);
  const under = act.filter(e => belowMin(e) || belowFloor(e));
  if (under.length) out.push(['bad', `${under.length} karyawan bergaji di bawah batas upah yang diatur: ${under.slice(0, 5).map(e => esc(e.name)).join(', ')}.`]);
  for (const e of act) {
    if (e.status !== 'pkwt' || !e.endDate) continue;
    const n = daysBetween(now, e.endDate);
    if (n > 30) continue;
    const comp = hr.umpMode === 'kesepakatan' ? 'kompensasi sesuai kesepakatan' : `uang kompensasi sekitar ${rp(pkwtComp({...e, exitDate: e.endDate}))}`;
    out.push([n < 0 ? 'bad' : 'warn', `Kontrak ${esc(e.name)} ${n < 0 ? 'sudah berakhir' : 'berakhir'} ${fmtDate(e.endDate)}: perpanjang atau akhiri, ${comp}.`]);
  }
  const pph = journalBal(ACC_PPH21), bpjs = journalBal(ACC_BPJS), [y, m] = addMonths(ym, 0).split('-');
  if (pph > 0) out.push([+now.slice(8) > 15 ? 'bad' : 'warn', `Utang PPh 21 belum disetor: <b>${rp(pph)}</b>. Setor paling lambat tanggal 15 bulan berikutnya, lapor tanggal 20.`]);
  if (bpjs > 0) out.push([+now.slice(8) > 15 ? 'bad' : 'warn', `Iuran BPJS belum disetor: <b>${rp(bpjs)}</b>. Setor sesuai tagihan BPJS bulan ${MONTHS_FULL[+m - 1]} ${y}.`]);
  if (!state.payrolls.some(p => p.period === addMonths(ym, -1))) out.push(['warn', `Gaji ${ymLabel(addMonths(ym, -1))} belum diproses di Karyawan → Penggajian.`]);
  return out;
}
function bizReport(type, from, to, period) {
  const asOf = to || today();
  if (type === 'jual') {
    const rows = sorted(state.trades.filter(t => t.kind === 'sale' && inRange(t.date, from, to))).reverse(), cogs = M().stock.cogs;
    const rets = state.returns.filter(r => r.kind === 'sale' && inRange(r.date, from, to)), rcost = M().stock.rcost;
    const per = new Map(); let tr = 0, tc = 0;
    rets.forEach(r => { tr -= r.dpp; tc -= rcost.get(r.id) || 0; });
    rows.forEach(t => { const total = tradeTotal(t), c = cogs.get(t.id) || 0; tr += total; tc += c;
      const sub = t.lines.reduce((s, l) => s + l.qty * l.price, 0) || 1;
      t.lines.forEach(l => { const r = per.get(l.itemId) || {qty: 0, rev: 0}; r.qty += l.qty; r.rev += l.qty * l.price * total / sub; per.set(l.itemId, r); }); });
    return kop('Laba Penjualan', period) + `<table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Pelanggan</th><th class="num">Penjualan</th><th class="num">HPP</th><th class="num">Laba kotor</th><th class="num">Margin</th></tr></thead>
      ${rows.map(t => { const total = tradeTotal(t), c = cogs.get(t.id) || 0; return `<tr><td style="white-space:nowrap">${fmtDate(t.date)}</td><td>${esc(t.ref)}</td><td>${esc(partyOf(t))}</td><td class="num">${rp(total)}</td><td class="num">${rp(c)}</td><td class="num">${rp(total - c)}</td><td class="num">${total ? pct((total - c) / total * 100) : '—'}</td></tr>`; }).join('')}
      ${rets.map(r => { const c = rcost.get(r.id) || 0; return `<tr><td style="white-space:nowrap">${fmtDate(r.date)}</td><td>${esc(r.ref)}</td><td>Retur penjualan</td><td class="num">(${rp(r.dpp)})</td><td class="num">(${rp(c)})</td><td class="num">(${rp(r.dpp - c)})</td><td></td></tr>`; }).join('')}
      <tr class="total"><td colspan="3">Total</td><td class="num">${rp(tr)}</td><td class="num">${rp(tc)}</td><td class="num">${rp(tr - tc)}</td><td class="num">${tr ? pct((tr - tc) / tr * 100) : '—'}</td></tr></table>
      <h3>Penjualan per barang/jasa</h3><table><thead><tr><th>Barang/Jasa</th><th class="num">Terjual</th><th class="num">Penjualan bersih</th></tr></thead>
      ${[...per.entries()].sort((a, b) => b[1].rev - a[1].rev).map(([id, r]) => `<tr><td>${esc(itemOf(id)?.name || '(terhapus)')}</td><td class="num">${fmtQty(r.qty)} ${esc(itemOf(id)?.unit)}</td><td class="num">${rp(r.rev)}</td></tr>`).join('')}</table>
      <p class="muted" style="font-size:12px">HPP memakai metode rata-rata tertimbang (moving average). Diskon pada nota dibagi merata sesuai nilai barang.</p>` + signBlock();
  }
  if (type === 'stok') {
    const st = stockAsOf(asOf); let tv = 0;
    const rows = state.items.filter(i => st.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));
    return kop('Laporan Persediaan', 'Per ' + fmtDate(asOf)) + `<table><thead><tr><th>Kode</th><th>Barang</th><th class="num">Stok</th><th class="num">HPP rata-rata</th><th class="num">Nilai</th></tr></thead>
      ${rows.map(i => { const s = st.get(i.id); tv += s.value; return `<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td class="num">${fmtQty(s.qty)} ${esc(i.unit)}</td><td class="num">${s.qty ? rp(s.value / s.qty) : '—'}</td><td class="num">${rp(s.value)}</td></tr>`; }).join('')}
      <tr class="total"><td colspan="4">Total nilai persediaan</td><td class="num">${rp(tv)}</td></tr></table>
      ${state.adjusts.some(a => a.date <= asOf) ? `<h3>Stok opname</h3><table><thead><tr><th>Tanggal</th><th>No. bukti</th><th>Selisih</th><th class="num">Nilai</th></tr></thead>${state.adjusts.filter(a => a.date <= asOf).map(a => `<tr><td>${fmtDate(a.date)}</td><td>${esc(a.ref)}</td><td>${a.lines.filter(l => l.diff).map(l => `${esc(itemOf(l.itemId)?.name)} ${l.diff > 0 ? '+' : ''}${fmtQty(l.diff)}`).join(', ') || 'Semua cocok'}</td><td class="num">${rp(M().stock.adj.get(a.id) || 0)}</td></tr>`).join('')}</table>` : ''}
      <p class="muted" style="font-size:12px">Total harus sama dengan akun 1-301 Persediaan di neraca pada tanggal yang sama. Cocokkan stok fisik secara berkala.</p>` + signBlock();
  }
  if (type === 'beli') {
    const rows = sorted(state.trades.filter(t => t.kind === 'purchase' && inRange(t.date, from, to))).reverse(), per = new Map();
    rows.forEach(t => per.set(partyOf(t), (per.get(partyOf(t)) || 0) + tradeTotal(t)));
    const rets = state.returns.filter(r => r.kind === 'purchase' && inRange(r.date, from, to));
    rets.forEach(r => { const v = partyOf(state.trades.find(t => t.id === r.origId) || {kind: 'purchase'}); per.set(v, (per.get(v) || 0) - r.dpp); });
    const total = rows.reduce((s, t) => s + tradeTotal(t), 0) - rets.reduce((s, r) => s + r.dpp, 0);
    return kop('Pembelian per Vendor', period) + `<table><thead><tr><th>Vendor</th><th class="num">Total pembelian</th></tr></thead>
      ${[...per.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `<tr><td>${esc(v)}</td><td class="num">${rp(n)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${rp(total)}</td></tr></table>
      <h3>Rincian</h3><table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Vendor</th><th>Bayar</th><th class="num">Total</th></tr></thead>
      ${rows.map(t => `<tr><td style="white-space:nowrap">${fmtDate(t.date)}</td><td>${esc(t.ref)}</td><td>${esc(partyOf(t))}</td><td>${t.pay === 'cash' ? 'Tunai' : 'Kredit'}</td><td class="num">${rp(tradeTotal(t))}</td></tr>`).join('')}</table>` + signBlock();
  }
  if (type === 'faktur') {
    const rows = state.trades.filter(t => inRange(t.fpDate || t.date, from, to) && (t.ppn || t.pph || t.fpNo)).sort((a, b) => (a.fpDate || a.date).localeCompare(b.fpDate || b.date));
    const sum = f => rows.reduce((s, t) => s + f(t), 0), buy = t => t.kind === 'purchase';
    const pphTxt = t => t.pphParts.map(x => `${PPH_LABEL[x.code]} ${rp(x.amt)}`).join('; ') || '—';
    return kop('Rekap Faktur &amp; Pajak Jual Beli', period) + `<table><thead><tr><th>Tgl faktur</th><th>No. bukti</th><th>No. faktur pajak</th><th>Jenis</th><th>Pihak</th><th class="num">DPP</th><th class="num">PPN</th><th>Perlakuan PPN</th><th>PPh</th></tr></thead>
      ${rows.map(t => `<tr><td style="white-space:nowrap">${fmtDate(t.fpDate || t.date)}</td><td>${esc(t.ref)}</td><td>${esc(t.fpNo) || '<span class="out">belum diisi</span>'}</td><td>${buy(t) ? 'Masukan' : 'Keluaran'}</td><td>${esc(partyOf(t))}</td><td class="num">${rp(tradeTotal(t))}</td><td class="num">${rp(t.ppn)}</td><td>${!t.ppn ? '—' : t.wapu ? (buy(t) ? 'Kami pungut (WAPU)' : 'Dipungut pembeli') : buy(t) ? (t.ppnCredit ? 'Dikreditkan' : 'Masuk harga pokok') : 'Disetor sendiri'}</td><td>${esc(pphTxt(t))}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Belum ada faktur pada periode ini.</td></tr>'}
      </table><h3>Ringkasan</h3><table>
      ${state.returns.filter(r => inRange(r.date, from, to)).map(r => `<tr><td>Retur ${r.kind === 'sale' ? 'penjualan' : 'pembelian'} ${esc(r.ref)}: buat retur faktur di Coretax</td><td class="num">(${rp(r.ppn)})</td></tr>`).join('')}
      <tr><td>PPN keluaran disetor sendiri</td><td class="num">${rp(sum(t => !buy(t) && !t.wapu ? t.ppn : 0))}</td></tr>
      <tr><td>PPN keluaran dipungut pembeli WAPU</td><td class="num">${rp(sum(t => !buy(t) && t.wapu ? t.ppn : 0))}</td></tr>
      <tr><td>PPN masukan dapat dikreditkan</td><td class="num">${rp(sum(t => buy(t) && t.ppnCredit ? t.ppn : 0))}</td></tr>
      <tr><td>PPN vendor yang kami pungut (WAPU)</td><td class="num">${rp(sum(t => buy(t) && t.wapu ? t.ppn : 0))}</td></tr>
      <tr><td>PPh yang kami potong/pungut dari vendor</td><td class="num">${rp(sum(t => buy(t) ? t.pph : 0))}</td></tr>
      <tr><td>PPh yang dipotong pembeli (kredit pajak)</td><td class="num">${rp(sum(t => buy(t) ? 0 : t.pph))}</td></tr>
      <tr class="total"><td>Saldo utang PPN / PPN WAPU / PPh potput saat ini</td><td class="num">${rp(journalBal(ACC_PPN))} / ${rp(journalBal(ACC_PPN_WAPU))} / ${rp(journalBal(ACC_PPH_POT))}</td></tr></table>
      <h3>Perhitungan PPN per masa</h3><table><thead><tr><th>Masa</th><th class="num">Keluaran</th><th class="num">Masukan</th><th class="num">Lebih bayar masa lalu</th><th class="num">Dikompensasi</th><th class="num">Kurang bayar</th><th>Status</th></tr></thead>
      ${ppnMasa().filter(m => inRange(m.ym + '-01', from ? from.slice(0, 7) + '-01' : '', to)).map(m => `<tr><td>${ymLabel(m.ym)}</td><td class="num">${rp(m.out)}</td><td class="num">${rp(m.in)}</td><td class="num">${rp(m.carry)}</td><td class="num">${rp(m.offset)}</td><td class="num">${rp(m.pay)}</td><td>${m.closed ? 'Dikompensasi otomatis' : 'Masa berjalan'}</td></tr>`).join('')}</table>
      <p class="muted" style="font-size:12px">Faktur pajak tetap diterbitkan dan dilaporkan lewat Coretax; rekap ini untuk mencocokkan. PPN masukan dikurangkan otomatis ke PPN keluaran setelah masa berakhir, dan kelebihannya dibawa ke masa berikutnya. PPN WAPU tidak ikut dikompensasi.</p>` + signBlock();
  }
  const runs = state.payrolls.filter(p => inRange(p.date, from, to)).sort((a, b) => a.period.localeCompare(b.period));
  if (type === 'upah') {
    let no = 0;
    return kop('Daftar Upah', period) + `<table><thead><tr><th>No</th><th>Periode</th><th>Nama</th><th>Jabatan</th><th class="num">Gaji pokok</th><th class="num">Tunjangan</th><th class="num">Lembur/bonus</th><th class="num">Potongan BPJS</th><th class="num">PPh 21</th><th class="num">Kasbon</th><th class="num">Bersih</th><th>Tgl bayar</th><th>Paraf</th></tr></thead>
      ${runs.flatMap(p => p.lines.map(l => `<tr><td>${++no}</td><td>${ymLabel(p.period)}</td><td>${esc(l.name)}</td><td>${esc(l.title)}</td><td class="num">${rp(l.base)}</td><td class="num">${rp(l.fixed + l.varAllow)}</td><td class="num">${rp(l.ot + l.bonus)}</td><td class="num">${rp(lineEe(l))}</td><td class="num">${rp(l.taxBy === 'karyawan' ? l.pph : 0)}</td><td class="num">${rp(l.deduct)}</td><td class="num">${rp(l.net)}</td><td style="white-space:nowrap">${fmtDate(p.date)}</td><td></td></tr>`)).join('') || '<tr><td colspan="13" class="muted">Belum ada penggajian pada periode ini.</td></tr>'}
      </table>` + signBlock();
  }
  if (type === 'bpjs') {
    const sum = (p, f) => p.lines.reduce((s, l) => s + f(l), 0);
    const cols = [['JKK', l => l.co.jkk], ['JKM', l => l.co.jkm], ['JHT prsh', l => l.co.jht], ['JP prsh', l => l.co.jp], ['Kes prsh', l => l.co.kes], ['JHT kary', l => l.ee.jht], ['JP kary', l => l.ee.jp], ['Kes kary', l => l.ee.kes], ['PPh 21', l => l.pph], ['PPh ditanggung', l => l.taxAllow]];
    return kop('Rekap PPh 21 &amp; BPJS', period) + `<table><thead><tr><th>Masa</th>${cols.map(c => `<th class="num">${c[0]}</th>`).join('')}</tr></thead>
      ${runs.map(p => `<tr><td>${ymLabel(p.period)}</td>${cols.map(c => `<td class="num">${rp(sum(p, c[1]))}</td>`).join('')}</tr>`).join('')}
      <tr class="total"><td>Total</td>${cols.map(c => `<td class="num">${rp(runs.reduce((s, p) => s + sum(p, c[1]), 0))}</td>`).join('')}</tr></table>
      <p>Utang PPh 21 saat ini ${rp(journalBal(ACC_PPH21))} · Utang BPJS saat ini ${rp(journalBal(ACC_BPJS))}.</p>
      <p class="muted" style="font-size:12px">PPh 21 memakai tarif efektif PP 58/2023; masa Desember dihitung ulang dengan tarif Pasal 17. Buat bukti potong walaupun nihil. "PPh ditanggung" adalah tunjangan pajak yang dibayar perusahaan dan sudah termasuk di kolom PPh 21.</p>` + signBlock();
  }
  if (type === 'sdm') {
    const ym = asOf.slice(0, 7), act = state.employees.filter(e => empActive(e, ym)), n = f => act.filter(f).length;
    const monthly = act.filter(e => e.status !== 'harian').map(empWage);
    return kop('Data Ketenagakerjaan', 'Per ' + fmtDate(asOf)) + `<table>
      <tr class="sect"><td colspan="2">Jumlah pekerja</td></tr>
      <tr><td>Laki-laki</td><td class="num">${n(e => e.gender === 'L')}</td></tr><tr><td>Perempuan</td><td class="num">${n(e => e.gender === 'P')}</td></tr>
      ${Object.entries(EMP_STATUS).map(([k, v]) => `<tr><td>${v}</td><td class="num">${n(e => e.status === k)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="num">${act.length}</td></tr>
      <tr class="sect"><td colspan="2">Upah bulanan (pokok + tunjangan tetap)</td></tr>
      <tr><td>Terendah</td><td class="num">${monthly.length ? rp(Math.min(...monthly)) : '—'}</td></tr><tr><td>Tertinggi</td><td class="num">${monthly.length ? rp(Math.max(...monthly)) : '—'}</td></tr>
      <tr><td>Dasar upah</td><td class="num">${state.hr.umpMode === 'wajib' ? 'Upah minimum' + (state.hr.ump ? ' ' + rp(state.hr.ump) : '') : 'Kesepakatan (usaha mikro/kecil)'}</td></tr>
      <tr class="sect"><td colspan="2">Kepesertaan BPJS</td></tr>
      <tr><td>BPJS Ketenagakerjaan</td><td class="num">${n(e => e.bpjsTk)}</td></tr><tr><td>BPJS Kesehatan</td><td class="num">${n(e => e.bpjsKes)}</td></tr>
      </table><p class="muted" style="font-size:12px">Dapat dipakai sebagai bahan wajib lapor ketenagakerjaan.</p>` + signBlock();
  }
  return '';
}

const VIEWS = {dashboard: renderDashboard, transaksi: renderTx, jualbeli: renderTrade, erp: () => renderErp(), hutang: renderDebts, karyawan: renderHr, laporan: renderReport, pengaturan: renderSettings};
function renderView(v) { VIEWS[v]?.(); }
function renderAll() { memo = null; renderHeader(); renderView(currentView); }

/* ---------- Mulai ---------- */
function start(data) {
  if (+data?.version > DATA_VERSION) {
    document.body.className = '';
    document.body.innerHTML = '<p style="padding:20px">Data ini dibuat oleh versi aplikasi yang lebih baru. Sambungkan ke internet lalu muat ulang halaman agar data tidak tertimpa.</p>';
    return;
  }
  try { state = data ? sanitizeState(data) : defaultState(); }
  catch {
    // Data rusak: simpan salinannya, jangan ditimpa diam-diam
    try { localStorage.setItem(KEY + '-rusak-' + Date.now(), JSON.stringify(data)); } catch {}
    state = defaultState();
    setTimeout(() => toast('Data tersimpan rusak; salinannya diamankan. Pulihkan dari backup.'), 500);
  }
  if (company) companyShadow();
  migrate();
  document.body.className = '';
  initReportDates(); restoreView(); applyRole(); renderAll(); renderInstall(); armAutoLock();
  if (company) { companyPersist(); setSync('Tersinkron dengan server perusahaan'); }
  else if (cloudUser) {
    if (dirty) schedulePush(); else setSync('Tersinkron dengan server');
    mergeLocalData();
  }
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
    if (!confirm('Pakai tanpa akun? Data hanya tersimpan di perangkat ini dan tidak bisa dibuka dari perangkat lain. Anda bisa masuk ke akun kapan saja dari menu Atur, dan data ini otomatis ikut tersimpan ke akun.')) return;
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
  armIdleLogout();
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
  if (await openCompany()) return;

  let remote = null, reachable = true;
  try { remote = await Cloud.pull(); } catch { reachable = false; }
  syncBase = remote ? remote.updatedAt : null;
  const localRaw = localStorage.getItem(storeKey), lm = readMeta();
  if (remote && (!localRaw || remote.updatedAt > lm.updatedAt)) {
    localStorage.setItem(storeKey, remote.payload); writeMeta(remote.updatedAt);
  }
  cloudReachable = reachable; // data tanpa akun digabung di start(), setelah data akun terbuka
  dirty = !!localStorage.getItem(storeKey) && (!remote || readMeta().updatedAt > remote.updatedAt);
  setSync(reachable ? 'Tersinkron dengan server' : 'Tidak terhubung ke server — perubahan disinkron saat online.');
  Cloud.watch(applyRemote);
  openStore(storeKey);
}

// Versi baru aktif: halaman dimuat ulang sekali agar semua file sama versinya
function registerUpdates() {
  const hadWorker = !!navigator.serviceWorker.controller;
  let done = false;
  const reloadWhenIdle = () => {
    if (document.querySelector('dialog[open]')) return setTimeout(reloadWhenIdle, 2000);
    if (!done) { done = true; location.reload(); }
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadWorker) reloadWhenIdle(); });
  navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(r => r.update()).catch(() => {});
}

async function boot() {
  // Anti-clickjacking: aplikasi menolak dibuka di dalam bingkai (iframe) situs lain
  if (window.top !== window.self) {
    document.body.className = '';
    document.body.innerHTML = '<p style="padding:20px">Demi keamanan, aplikasi ini tidak bisa dibuka di dalam situs lain.</p>';
    return;
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
    registerUpdates();
  // Minta browser tidak menghapus data saat ruang penyimpanan HP menipis
  navigator.storage?.persist?.().catch(() => {});

  try { Cloud = await import('./cloud.js'); } catch { Cloud = null; }
  if (!Cloud?.enabled() || localStorage.getItem(MODE_KEY) === 'lokal') return openStore(KEY);
  const res = await Cloud.init();
  if (res.user) { if (await idleLogoutAtStart(res.user)) return; return openAccount(res.user); }
  if (!res.online) {
    // Tanpa internet: buka salinan akun terakhir di perangkat ini bila ada
    const last = localStorage.getItem(LAST_UID_KEY);
    if (last && localStorage.getItem(KEY + ':' + last)) { offlineAccount = true; return openStore(KEY + ':' + last); }
    return showAuth('Tidak bisa terhubung ke server. Periksa internet, atau pakai tanpa akun.');
  }
  let note = '';
  try { if (sessionStorage.getItem(IDLE_NOTE_KEY)) { note = 'Anda keluar otomatis karena 1 jam tidak ada aktivitas. Silakan masuk kembali.'; sessionStorage.removeItem(IDLE_NOTE_KEY); } } catch {}
  showAuth(note);
}
// Menunggu erp.js selesai dimuat
addEventListener('DOMContentLoaded', boot);
