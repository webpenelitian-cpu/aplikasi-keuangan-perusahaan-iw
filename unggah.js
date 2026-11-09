'use strict';
/* Unggah massal dari Excel. Template dan file dibaca langsung di peramban tanpa pustaka luar, jadi tidak ada kode pihak ketiga
   yang ikut menyentuh data. Semua baris diperiksa dengan aturan yang sama seperti formulir, lalu disimpan sekaligus: satu baris
   salah berarti tidak ada yang tersimpan, sehingga pembukuan tidak pernah terisi setengah. Berkas ini dimuat setelah erp.js. */

const XL_MAX_FILE = 5 * 2 ** 20, XL_MAX_PART = 40 * 2 ** 20, XL_MAX_ROWS = 2000, XL_TEMPLATE_ROWS = 2000, BUCKET_MAX = 900000;

/* ---------- ZIP: kerangka file .xlsx ---------- */
const CRC_TABLE = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const head = (sig, n) => { const v = new DataView(new ArrayBuffer(n)); v.setUint32(0, sig, true); return v; };
  for (const [name, text] of files) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const common = (v, p) => { v.setUint16(p, 20, true); v.setUint16(p + 2, 0x0800, true); v.setUint16(p + 4, 0, true); v.setUint16(p + 6, 0, true); v.setUint16(p + 8, 0x5A21, true); v.setUint32(p + 10, crc, true); v.setUint32(p + 14, data.length, true); v.setUint32(p + 18, data.length, true); v.setUint16(p + 22, nm.length, true); };
    const l = head(0x04034b50, 30); common(l, 4);
    const c = head(0x02014b50, 46); c.setUint16(4, 20, true); common(c, 6); c.setUint32(42, offset, true);
    parts.push(new Uint8Array(l.buffer), nm, data); central.push(new Uint8Array(c.buffer), nm);
    offset += 30 + nm.length + data.length;
  }
  const size = central.reduce((s, x) => s + x.length, 0), e = head(0x06054b50, 22);
  e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
async function inflate(bytes) {
  const r = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), out = []; let n = 0;
  for (;;) {
    let step; try { step = await r.read(); } catch { throw new Error('File rusak dan tidak bisa dibaca. Simpan ulang dari Excel, lalu unggah lagi.'); }
    const {done, value} = step; if (done) break;
    n += value.length;
    if (n > XL_MAX_PART) { await r.cancel(); throw new Error('Isi file terlalu besar.'); }
    out.push(value);
  }
  const all = new Uint8Array(n); let p = 0; for (const x of out) { all.set(x, p); p += x.length; }
  return all;
}
function zipOpen(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), bad = () => new Error('File bukan Excel .xlsx yang utuh.');
  let e = buf.byteLength - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw bad();
  const map = new Map(), dec = new TextDecoder(); let p = v.getUint32(e + 16, true);
  for (let i = 0, n = v.getUint16(e + 10, true); i < n; i++) {
    if (p + 46 > buf.byteLength || v.getUint32(p, true) !== 0x02014b50) throw bad();
    const nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    map.set(dec.decode(u8.subarray(p + 46, p + 46 + nl)), {method: v.getUint16(p + 10, true), crc: v.getUint32(p + 16, true), size: v.getUint32(p + 20, true), usize: v.getUint32(p + 24, true), at: v.getUint32(p + 42, true)});
    p += 46 + nl + xl + cl;
  }
  // Setiap bagian dicocokkan dengan CRC32 bawaan ZIP: file yang rusak sebagian ditolak, bukan dibaca dengan angka yang berubah diam-diam
  return async name => {
    const f = map.get(name); if (!f) return null;
    if (f.at + 30 > buf.byteLength || v.getUint32(f.at, true) !== 0x04034b50 || ![0, 8].includes(f.method)) throw bad();
    const s = f.at + 30 + v.getUint16(f.at + 26, true) + v.getUint16(f.at + 28, true);
    if (s + f.size > buf.byteLength || f.usize > XL_MAX_PART) throw bad();
    const raw = u8.subarray(s, s + f.size), data = f.method === 8 ? await inflate(raw) : raw;
    if (data.length !== f.usize || crc32(data) !== f.crc) throw new Error('File rusak (isi tidak cocok dengan tanda pengamannya). Simpan ulang dari Excel, lalu unggah lagi.');
    return dec.decode(data);
  };
}

/* ---------- Membaca lembar kerja ---------- */
const xmlDoc = s => {
  if (/<!DOCTYPE|<!ENTITY/i.test(s)) throw new Error('File berisi struktur yang tidak diizinkan.'); // Excel tidak pernah memakainya; mencegah bom entitas XML
  const d = new DOMParser().parseFromString(s, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error('Isi file rusak dan tidak bisa dibaca.');
  return d;
};
const byTag = (el, t) => [...el.getElementsByTagNameNS('*', t)];
const colIndex = ref => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n - 1; };
async function readXlsx(buf) {
  const part = zipOpen(buf), wbText = await part('xl/workbook.xml'); if (!wbText) throw new Error('File bukan Excel .xlsx yang utuh.');
  const wb = xmlDoc(wbText), sheets = byTag(wb, 'sheet'), pick = sheets.find(s => s.getAttribute('name')?.toLowerCase() === 'data') || sheets[0];
  if (!pick) throw new Error('Tidak ada lembar kerja di dalam file.');
  const date1904 = ['1', 'true'].includes(byTag(wb, 'workbookPr')[0]?.getAttribute('date1904'));
  const rid = [...pick.attributes].find(a => a.localName === 'id')?.value, rels = xmlDoc(await part('xl/_rels/workbook.xml.rels') || '<r/>');
  const target = byTag(rels, 'Relationship').find(r => r.getAttribute('Id') === rid)?.getAttribute('Target') || 'worksheets/sheet1.xml';
  const sheet = await part(target.startsWith('/') ? target.slice(1) : 'xl/' + target); if (!sheet) throw new Error('Lembar kerja tidak terbaca.');
  const sst = await part('xl/sharedStrings.xml'), plain = si => byTag(si, 't').filter(t => t.parentNode.localName !== 'rPh').map(t => t.textContent).join('');
  const shared = sst ? byTag(xmlDoc(sst), 'si').map(plain) : [], rows = [];
  for (const row of byTag(xmlDoc(sheet), 'row')) {
    const line = +row.getAttribute('r') || rows.length + 1, cells = []; let next = 0;
    for (const c of byTag(row, 'c')) {
      const ref = c.getAttribute('r'), i = ref ? colIndex(ref) : next, t = c.getAttribute('t'), raw = byTag(c, 'v')[0]?.textContent ?? ''; next = i + 1;
      if (i < 0 || i > 16383) continue;
      cells[i] = t === 's' ? shared[+raw] ?? '' : t === 'inlineStr' ? plain(byTag(c, 'is')[0] || c) : t === 'str' ? raw : t === 'b' ? raw === '1' : t === 'e' ? '#GALAT' : raw === '' ? '' : Number(raw);
    }
    if (cells.some(x => x !== undefined && String(x).trim() !== '')) rows.push({line, cells});
    if (rows.length > XL_MAX_ROWS + 1) throw new Error(`Paling banyak ${XL_MAX_ROWS.toLocaleString('id-ID')} baris per file. Pecah file menjadi beberapa bagian.`);
  }
  return {rows, date1904};
}
function readCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0], sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',', rows = [];
  let cell = '', cells = [], q = false, line = 1;
  const endRow = () => { cells.push(cell); cell = ''; if (cells.some(x => x.trim())) rows.push({line, cells}); cells = []; line++; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { cells.push(cell); cell = ''; }
    else if (ch === '\n') endRow();
    else if (ch !== '\r') cell += ch;
  }
  if (cell || cells.length) endRow();
  if (rows.length > XL_MAX_ROWS + 1) throw new Error(`Paling banyak ${XL_MAX_ROWS.toLocaleString('id-ID')} baris per file.`);
  return {rows, date1904: false};
}

/* ---------- Membaca isi sel sesuai jenis kolom ---------- */
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const headKey = s => norm(s).replace(/\s*\*$/, '');
const hasDigit = s => /\d/.test(s);
function numberOf(raw, label) {
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/rp\.?/ig, '').trim();
  if (!hasDigit(s) || /[a-z]/i.test(s)) throw new Error(`${label} harus berisi angka`);
  if (/^-?\d+\.\d{1,2}$/.test(s)) return Number(s);
  if (/^-?\d{1,3}(,\d{3})+$/.test(s)) return Number(s.replace(/,/g, ''));
  const n = Number(s.replace(/[^\d,-]/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`${label}: format angka tidak dikenali`);
  return n;
}
function dateOf(raw, label, date1904) {
  let out = '';
  if (typeof raw === 'number') {
    if (raw >= 30000 && raw < 80000) out = new Date(Date.UTC(1899, 11, 30) + (Math.floor(raw) + (date1904 ? 1462 : 0)) * 864e5).toISOString().slice(0, 10);
  } else {
    const s = String(raw).trim(), a = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/), b = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (a) out = `${a[1]}-${a[2].padStart(2, '0')}-${a[3].padStart(2, '0')}`;
    else if (b) out = `${b[3]}-${b[2].padStart(2, '0')}-${b[1].padStart(2, '0')}`;
  }
  out = cleanDate(out);
  if (!out) throw new Error(`${label}: tulis tanggal seperti 31/12/2026`);
  return out;
}
function cellValue(c, raw, date1904) {
  const empty = raw === undefined || raw === null || String(raw).trim() === '';
  if (empty) { if (c.req) throw new Error(`${c.h} wajib diisi`); return ''; }
  if (raw === '#GALAT') throw new Error(`${c.h} berisi rumus yang gagal`);
  switch (c.t) {
    case 'date': return dateOf(raw, c.h, date1904);
    case 'money': { const n = numberOf(raw, c.h); if (n < 0 && !c.neg) throw new Error(`${c.h} tidak boleh negatif`); return Math.round(n); }
    case 'qty': { const n = typeof raw === 'number' ? raw : parseQty(String(raw).replace(/[^\d.,-]/g, '')); if (!(n >= 0) || (typeof raw !== 'number' && !hasDigit(String(raw)))) throw new Error(`${c.h} harus berisi angka`); return cleanQty(n); }
    case 'int': { const n = numberOf(raw, c.h); if (n < 0) throw new Error(`${c.h} tidak boleh negatif`); return Math.round(n); }
    case 'pct': { const n = typeof raw === 'number' ? raw : parseQty(String(raw).replace('%', '')); if (!(n >= 0 && n <= 100)) throw new Error(`${c.h} harus 0 sampai 100`); return n; }
    case 'bool': { const s = norm(raw); if (raw === true || ['ya', 'y', 'true', '1'].includes(s)) return true; if (raw === false || ['tidak', 't', 'n', 'false', '0'].includes(s)) return false; throw new Error(`${c.h} harus Ya atau Tidak`); }
    case 'enum': { const s = norm(raw), hit = Object.entries(c.opts).find(([k, v]) => norm(k) === s || norm(v) === s); if (!hit) throw new Error(`${c.h}: "${String(raw).slice(0, 40)}" tidak ada di daftar`); return hit[0]; }
    case 'digits': if (typeof raw === 'number' && String(raw).length >= 15) throw new Error(`${c.h} terbaca sebagai angka sehingga digit terakhir bisa berubah. Format kolomnya sebagai Teks, lalu ketik ulang`); return String(raw).replace(/\s/g, '').slice(0, c.max || 30);
    default: return String(raw).trim().slice(0, c.max || 120);
  }
}

/* ---------- Pencarian data rujukan ---------- */
const findBy = (list, s, ...keys) => { const n = norm(s), hits = list.filter(x => keys.some(k => norm(x[k]) === n)); return hits.length === 1 ? hits[0] : hits.length ? 'ganda' : null; };
function ref(list, s, label, ...keys) {
  if (!String(s ?? '').trim()) throw new Error(`${label} wajib diisi`);
  const r = findBy(list, s, ...keys);
  if (r === 'ganda') throw new Error(`${label} "${s}" cocok dengan lebih dari satu data. Pakai kode yang unik`);
  if (!r) throw new Error(`${label} "${s}" tidak ditemukan di aplikasi`);
  return r;
}
const accRef = (s, label = 'Akun') => ref(state.accounts, s, label, 'name', 'code');
const itemRef = s => ref(state.items, s, 'Barang', 'code', 'name');
const empRef = s => ref(state.employees, s, 'Karyawan', 'nik', 'name');
const whRef = s => !s || norm(s) === 'gudang utama' ? null : ref(state.warehouses, s, 'Gudang', 'name').id;
const catRef = (s, type) => ref(state.categories.filter(c => (!type || c.type === type) && manualCat(c)), s, 'Kategori', 'code', 'name');
const noLock = d => { if (isLocked(d)) throw new Error(lockMsg()); };

// Data induk: nama menjadi kunci. Data yang sudah ada dilewati, atau diperbarui bila pengguna memintanya
function master(col, ent, blank, check) {
  return (v, x) => {
    const key = norm(v.name); if (x.seen.has(key)) throw new Error(`Nama sama dengan baris ${x.seen.get(key)}`);
    x.seen.set(key, x.line);
    const cur = state[col].find(r => norm(r.name) === key);
    if (cur && !x.update) return {skip: 'Sudah ada, dilewati'};
    const filled = Object.fromEntries(Object.entries(v).filter(([, val]) => val !== ''));
    const rec = {...blank(), ...cur, ...filled}, warn = check?.(rec, cur, x) || '';
    return {label: v.name, mode: cur ? 'ubah' : 'baru', warn, apply() {
      if (cur) { Object.assign(cur, rec); log('ubah', ent, cur.id, rec.name); }
      else { const r = {...rec, id: uid()}; state[col].push(r); log('tambah', ent, r.id, rec.name); }
    }};
  };
}

// Jual/beli: satu No. Bukti bisa terdiri atas beberapa baris barang
function tradeRow(kind) {
  return (v, x) => {
    const it = itemRef(v.item), g = x.groups.get(norm(v.ref));
    if (!(v.qty > 0)) throw new Error('Jumlah harus lebih dari 0');
    const party = kind === 'sale' ? v.party : ref(state.vendors, v.party, 'Vendor', 'name').name;
    if (g && (g.v.date !== v.date || norm(g.v.party) !== norm(party))) throw new Error(`No. bukti ${v.ref} sudah dipakai baris ${g.line} dengan tanggal atau pihak berbeda`);
    const price = v.price !== '' ? v.price : kind === 'sale' ? custPrice(it.price, v.party) : 0;
    if (!(price > 0)) throw new Error('Isi harga satuan');
    const line = {itemId: it.id, qty: v.qty, price};
    if (g) { g.lines.push(line); return {label: `${v.ref} · ${it.name}`, mode: 'baru'}; }
    const row = {label: `${v.ref} · ${it.name}`, mode: 'baru'};
    x.groups.set(norm(v.ref), {v, line: x.line, lines: [line], row});
    return row;
  };
}
function tradeFinish(kind) {
  return x => {
    const cands = [], pending = new Map();
    for (const g of x.groups.values()) {
      const v = g.v, sale = kind === 'sale', cust = sale ? custByName(v.party) : null;
      try {
        noLock(v.date);
        if (state.trades.some(t => t.ref === v.ref) || state.tx.some(t => t.ref === v.ref)) throw new Error(`No. bukti ${v.ref} sudah dipakai`);
        const credit = v.pay === 'credit', acc = credit ? null : accRef(v.account || '', 'Akun kas/bank');
        if (credit && sale && !v.party) throw new Error('Isi pelanggan untuk penjualan kredit');
        const terms = sale ? cust?.terms : findBy(state.vendors, v.party, 'name')?.terms;
        const due = !credit ? '' : v.due || (terms ? days(v.date, terms) : '');
        if (due && due < v.date) throw new Error('Jatuh tempo tidak boleh sebelum tanggal');
        const d = {id: uid(), created: Date.now() + cands.length, kind, date: v.date, ref: v.ref, lines: g.lines, discount: v.discount || 0, extra: sale ? 0 : v.extra || 0, pay: credit ? 'credit' : 'cash',
          vendorId: sale ? null : findBy(state.vendors, v.party, 'name').id, party: sale ? v.party : '', accountId: acc?.id || null, due, desc: v.desc, srcId: null, whId: whRef(v.wh), salesId: sale && v.sales ? ref(state.salespeople, v.sales, 'Tenaga penjual', 'name').id : null,
          wapu: sale && (v.wapu === '' ? !!cust?.wapu : v.wapu), wapuKind: 'other', cut: sale && (v.cut === '' ? (v.wapu === '' ? !!cust?.wapu : v.wapu) : v.cut), fpNo: v.fpNo, fpDate: v.fpDate, poNo: sale ? v.poNo : '', custAddr: cust?.address || '', custNpwp: cust?.npwp || ''};
        Object.assign(d, taxCalc(d));
        if (tradeTotal(d) <= 0 || tradePay(d) <= 0) throw new Error('Total harus lebih dari 0');
        if (sale && credit && cust?.limit) {
          const used = custOpen(cust.name) + (pending.get(cust.name) || 0) + tradePay(d); pending.set(cust.name, used - custOpen(cust.name));
          if (used > cust.limit) { const m = `Melebihi batas kredit ${cust.name}: ${rp(cust.limit)}`; if (!canApprove()) throw new Error(m + '. Perlu persetujuan pimpinan atau keuangan'); g.row.warn = m; }
        }
        cands.push(d);
        g.row.doc = true;
        g.row.apply = () => { state.trades.push(d); postTrade(d); log('tambah', 'jual beli', d.id, tradeSummary(d)); };
      } catch (e) { g.row.err = e.message; }
    }
    const before = M().stock.neg, r = stockCalc([...state.trades, ...cands]), neg = [...r.neg].filter(id => !before.has(id));
    if (neg.length) for (const g of x.groups.values()) { const hit = g.lines.find(l => neg.includes(l.itemId)); if (hit) { g.row.err = `Stok tidak cukup: ${itemOf(hit.itemId)?.name}`; delete g.row.apply; } }
  };
}

/* ---------- Template per jenis data ---------- */
const C = (k, h, t = 'text', o = {}) => ({k, h, t, ...o}), R = (k, h, t = 'text', o = {}) => C(k, h, t, {...o, req: true});
const asList = (arr, key = 'name') => () => arr().map(x => x[key]).filter(Boolean);
const LISTS = {akun: asList(() => state.accounts), barang: () => state.items.map(i => i.code || i.name), vendor: asList(() => state.vendors), pelanggan: asList(() => state.customers), karyawan: asList(() => state.employees), penjual: asList(() => state.salespeople),
  gudang: () => ['Gudang utama', ...state.warehouses.map(w => w.name)], kategori: () => state.categories.filter(c => manualCat(c)).map(c => c.code), kodeAkun: () => chartList().map(c => c.id)};
const PAY = {cash: 'Tunai', credit: 'Kredit'}, TXT = {in: 'Pemasukan', out: 'Pengeluaran', transfer: 'Mutasi'}, DEBT = {piutang: 'Piutang', utang: 'Utang'}, ITEM_KIND = {barang: 'Barang', jasa: 'Jasa'}, GENDER = {L: 'Laki-laki', P: 'Perempuan'}, TAXBY = {karyawan: 'Karyawan', perusahaan: 'Perusahaan'};
const labelOf = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v?.label ?? v]));
const TRADE_TAIL = [C('wh', 'Gudang', 'text', {list: 'gudang', ex: 'Gudang utama', note: 'Kosongkan untuk gudang utama.'}), C('fpNo', 'No. Faktur Pajak', 'text', {max: 40}), C('fpDate', 'Tanggal Faktur Pajak', 'date'), C('desc', 'Keterangan', 'text', {max: 500})];
const UNGGAH = {
  customers: {title: 'Pelanggan', group: 'Penjualan', roles: ['sales'], update: true, desc: 'Daftar pelanggan, kontak, tempo, dan batas kredit.',
    cols: [R('name', 'Nama Pelanggan', 'text', {ex: 'PT Maju Bersama'}), C('pic', 'Kontak PIC', 'text', {ex: 'Budi'}), C('phone', 'Telepon', 'digits', {max: 40, ex: '081234567890'}), C('email', 'Email', 'text', {ex: 'beli@contoh.co.id'}), C('npwp', 'NPWP', 'digits', {ex: '0012345678901000'}),
      C('terms', 'Tempo (hari)', 'int', {ex: 30}), C('limit', 'Batas Kredit (Rp)', 'money', {ex: 50000000, note: '0 atau kosong berarti tanpa batas.'}), C('disc', 'Diskon Harga (%)', 'pct', {ex: 5}), C('address', 'Alamat', 'text', {max: 300, ex: 'Jl. Merdeka 1'}), C('wapu', 'WAPU', 'bool', {ex: 'Tidak'})],
    row: master('customers', 'pelanggan', () => ({name: '', pic: '', phone: '', email: '', address: '', npwp: '', terms: 0, wapu: false, limit: 0, disc: 0}))},
  sale: {title: 'Penjualan', group: 'Penjualan', roles: ['sales'], desc: 'Faktur penjualan. Satu baris satu barang; baris dengan No. Bukti sama menjadi satu faktur.',
    cols: [R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), R('ref', 'No. Bukti', 'text', {max: 40, ex: 'INV-2610-001', note: 'Sama untuk semua barang dalam satu faktur.'}), C('party', 'Pelanggan', 'text', {list: 'pelanggan', ex: 'PT Maju Bersama', note: 'Wajib untuk penjualan kredit.'}), R('item', 'Kode Barang', 'text', {list: 'barang', ex: 'BRG-001', note: 'Kode atau nama barang yang sudah ada di aplikasi.'}),
      R('qty', 'Jumlah', 'qty', {ex: 2}), C('price', 'Harga Satuan (Rp)', 'money', {ex: 150000, note: 'Kosong berarti harga barang setelah diskon pelanggan.'}), C('discount', 'Diskon Faktur (Rp)', 'money', {ex: 0, note: 'Dibaca dari baris pertama faktur.'}), R('pay', 'Cara Bayar', 'enum', {opts: PAY, ex: 'Kredit'}), C('account', 'Akun Kas/Bank', 'text', {list: 'akun', ex: '', note: 'Wajib bila tunai.'}), C('due', 'Jatuh Tempo', 'date', {ex: '30/11/2026', note: 'Kosong berarti mengikuti tempo pelanggan.'}),
      C('sales', 'Tenaga Penjual', 'text', {list: 'penjual'}), C('wapu', 'WAPU', 'bool', {ex: 'Tidak', note: 'Kosong berarti mengikuti data pelanggan.'}), C('cut', 'Dipotong PPh', 'bool', {note: 'Kosong berarti mengikuti status WAPU.'}), C('poNo', 'No. PO Pelanggan', 'text', {max: 60}), ...TRADE_TAIL],
    row: tradeRow('sale'), finish: tradeFinish('sale')},
  contacts: {title: 'Riwayat kontak', group: 'Penjualan', roles: ['sales'], desc: 'Catatan kunjungan, telepon, dan tindak lanjut pelanggan.',
    cols: [R('customer', 'Pelanggan', 'text', {list: 'pelanggan', ex: 'PT Maju Bersama'}), R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), C('channel', 'Cara', 'text', {max: 60, ex: 'Kunjungan'}), C('next', 'Tindak Lanjut', 'date', {ex: '07/11/2026'}), C('note', 'Catatan', 'text', {max: 300, ex: 'Minta penawaran baru'})],
    row: v => { const c = ref(state.customers, v.customer, 'Pelanggan', 'name'); noLock(v.date); return {label: `${c.name} · ${v.date}`, mode: 'baru', apply() { const r = {id: uid(), created: Date.now(), customerId: c.id, date: v.date, channel: v.channel, next: v.next, note: v.note}; state.contacts.push(r); log('tambah', 'contacts', r.id, `${c.name} · ${v.date}`); }}; }},
  items: {title: 'Barang & jasa', group: 'Gudang', roles: ['warehouse'], update: true, desc: 'Daftar barang dan jasa, harga jual, batas stok, dan stok awal.',
    cols: [C('code', 'Kode', 'text', {max: 30, ex: 'BRG-001'}), R('name', 'Nama Barang/Jasa', 'text', {ex: 'Semen 50 kg'}), R('kind', 'Jenis', 'enum', {opts: ITEM_KIND, ex: 'Barang'}), C('taxType', 'Jenis Pajak', 'enum', {opts: labelOf(TAX_TYPES), ex: TAX_TYPES.bkp.label, note: 'Kosong berarti barang atau jasa umum kena PPN.'}), C('unit', 'Satuan', 'text', {max: 20, ex: 'sak'}), C('price', 'Harga Jual (Rp)', 'money', {ex: 75000}),
      C('minQty', 'Stok Minimum', 'qty', {ex: 10}), C('leadDays', 'Waktu Pesan (hari)', 'int', {ex: 7}), C('openQty', 'Stok Awal', 'qty', {ex: 100, note: 'Hanya dibaca untuk barang baru.'}), C('openCost', 'HPP Awal per Satuan (Rp)', 'money', {ex: 60000, note: 'Hanya dibaca untuk barang baru.'})],
    row: master('items', 'barang', () => ({name: '', code: '', kind: 'barang', taxType: '', unit: '', price: 0, minQty: 0, leadDays: 0, openQty: 0, openCost: 0}), (r, cur, x) => {
      r.taxType ||= r.kind === 'jasa' ? 'jasa' : 'bkp';
      if (TAX_TYPES[r.taxType].kind !== r.kind) throw new Error('Jenis pajak tidak sesuai dengan jenis barang/jasa');
      if (r.code) { const k = norm(r.code); if (x.codes.has(k)) throw new Error(`Kode ${r.code} sama dengan baris ${x.codes.get(k)}`); x.codes.set(k, x.line); if (state.items.some(i => i !== cur && norm(i.code) === k)) throw new Error(`Kode ${r.code} sudah dipakai barang lain`); }
      if (r.kind === 'jasa') r.openQty = r.openCost = 0;
      if (cur) { r.openQty = cur.openQty; r.openCost = cur.openCost; } else if (state.lockedUntil && r.openQty) throw new Error('Stok awal tidak bisa diisi setelah tutup buku; catat sebagai pembelian');
    })},
  vendors: {title: 'Vendor', group: 'Gudang', roles: ['warehouse'], update: true, desc: 'Daftar pemasok beserta status pajak dan rekeningnya.',
    cols: [R('name', 'Nama Vendor', 'text', {ex: 'CV Sumber Jaya'}), C('pic', 'Kontak PIC', 'text', {ex: 'Sari'}), C('phone', 'Telepon', 'digits', {max: 40, ex: '081298765432'}), C('email', 'Email'), C('address', 'Alamat', 'text', {max: 300}), C('npwp', 'NPWP', 'digits', {ex: '0098765432109000'}), C('bank', 'Rekening Bank', 'text', {ex: 'BSI 1234567890'}), C('terms', 'Tempo (hari)', 'int', {ex: 14}), C('pkp', 'PKP', 'bool', {ex: 'Ya'}), C('wapu', 'Kita Pungut sebagai WAPU', 'bool', {ex: 'Tidak'}), C('noPph', 'Bebas Potong PPh', 'bool', {ex: 'Tidak'}), C('note', 'Catatan', 'text', {max: 300})],
    row: master('vendors', 'vendor', () => ({name: '', pic: '', phone: '', email: '', address: '', npwp: '', bank: '', terms: 0, note: '', pkp: false, wapu: false, noPph: false}))},
  purchase: {title: 'Pembelian', group: 'Gudang', roles: ['warehouse'], desc: 'Faktur pembelian. Satu baris satu barang; baris dengan No. Bukti sama menjadi satu faktur.',
    cols: [R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), R('ref', 'No. Bukti', 'text', {max: 40, ex: 'BELI-2610-001'}), R('party', 'Vendor', 'text', {list: 'vendor', ex: 'CV Sumber Jaya'}), R('item', 'Kode Barang', 'text', {list: 'barang', ex: 'BRG-001'}), R('qty', 'Jumlah', 'qty', {ex: 50}), R('price', 'Harga Satuan (Rp)', 'money', {ex: 60000}), C('discount', 'Diskon Faktur (Rp)', 'money', {ex: 0}), C('extra', 'Ongkos (Rp)', 'money', {ex: 0}), R('pay', 'Cara Bayar', 'enum', {opts: PAY, ex: 'Kredit'}), C('account', 'Akun Kas/Bank', 'text', {list: 'akun', note: 'Wajib bila tunai.'}), C('due', 'Jatuh Tempo', 'date', {ex: '14/11/2026'}), ...TRADE_TAIL],
    row: tradeRow('purchase'), finish: tradeFinish('purchase')},
  opname: {title: 'Stok opname', group: 'Gudang', roles: ['warehouse'], desc: 'Hasil hitung fisik. Baris dengan No. Bukti sama menjadi satu dokumen opname.',
    cols: [R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), R('ref', 'No. Bukti', 'text', {max: 40, ex: 'OP-2610-001'}), R('item', 'Kode Barang', 'text', {list: 'barang', ex: 'BRG-001'}), C('wh', 'Gudang', 'text', {list: 'gudang', ex: 'Gudang utama'}), R('counted', 'Hitungan Fisik', 'qty', {ex: 98}), C('desc', 'Keterangan', 'text', {max: 500})],
    row(v, x) {
      const it = itemRef(v.item); if (it.kind !== 'barang') throw new Error(`${it.name} bukan barang`);
      const k = norm(v.ref), g = x.groups.get(k), whId = whRef(v.wh);
      if (g && (g.v.date !== v.date || g.whId !== whId)) throw new Error(`No. bukti ${v.ref} sudah dipakai baris ${g.line} dengan tanggal atau gudang berbeda`);
      if (g?.lines.some(l => l.itemId === it.id)) throw new Error(`${it.name} tertulis dua kali di dokumen ini`);
      x.stockAt ||= new Map(); // stok dihitung sekali per tanggal, bukan per baris
      if (state.warehouses.length) x.whs ||= whStock(); else if (!x.stockAt.has(v.date)) x.stockAt.set(v.date, stockAsOf(v.date));
      const book = x.whs ? x.whs.get(whId || '')?.get(it.id) || 0 : x.stockAt.get(v.date).get(it.id)?.qty || 0;
      const line = {itemId: it.id, counted: v.counted, diff: Math.round((v.counted - book) * 1000) / 1000}, row = {label: `${v.ref} · ${it.name}`, mode: 'baru', warn: line.diff ? `Selisih ${line.diff > 0 ? '+' : ''}${fmtQty(line.diff)}` : ''};
      if (g) g.lines.push(line); else x.groups.set(k, {v, whId, line: x.line, lines: [line], row});
      return row;
    },
    finish(x) {
      const cands = [];
      for (const g of x.groups.values()) {
        try {
          noLock(g.v.date); if (state.adjusts.some(a => a.ref === g.v.ref)) throw new Error(`No. bukti ${g.v.ref} sudah dipakai`);
          const a = {id: uid(), created: Date.now() + cands.length, date: g.v.date, ref: g.v.ref, desc: g.v.desc, lines: g.lines, whId: g.whId};
          if (stockCalc(state.trades, state.items, state.returns, [...state.adjusts, ...cands, a]).neg.size > M().stock.neg.size) throw new Error('Stok jadi minus karena ada penjualan setelah tanggal ini');
          cands.push(a); g.row.doc = true;
          g.row.apply = () => { state.adjusts.push(a); log('tambah', 'opname', a.id, `${a.ref} · ${a.date} · ${a.lines.length} barang`); };
        } catch (e) { g.row.err = e.message; }
      }
    }},
  batches: {title: 'Batch barang', group: 'Gudang', roles: ['warehouse'], desc: 'Nomor batch dan tanggal kedaluwarsa barang.',
    cols: [R('item', 'Kode Barang', 'text', {list: 'barang', ex: 'BRG-001'}), R('batch', 'No. Batch', 'text', {max: 40, ex: 'B2610'}), C('exp', 'Kedaluwarsa', 'date', {ex: '31/12/2027'}), R('qty', 'Jumlah', 'qty', {ex: 25}), C('note', 'Keterangan', 'text', {max: 300})],
    row: v => { const it = itemRef(v.item); if (state.batches.some(b => b.itemId === it.id && norm(b.batch) === norm(v.batch))) return {skip: 'Sudah ada, dilewati'}; return {label: `${it.name} · ${v.batch}`, mode: 'baru', apply() { const r = {id: uid(), itemId: it.id, batch: v.batch, exp: v.exp, qty: v.qty, note: v.note}; state.batches.push(r); log('tambah', 'batches', r.id, `${it.name} · ${v.batch}`); }}; }},
  employees: {title: 'Karyawan', group: 'SDM', roles: ['hr'], update: true, desc: 'Data karyawan, status kerja, upah, PTKP, dan kepesertaan BPJS.',
    cols: [R('name', 'Nama Karyawan', 'text', {ex: 'Andi Saputra'}), C('nik', 'NIK', 'digits', {max: 20, ex: '1171010101900001', note: '16 angka.'}), C('npwp', 'NPWP', 'digits'), C('title', 'Jabatan', 'text', {ex: 'Staf Gudang'}), R('gender', 'Jenis Kelamin', 'enum', {opts: GENDER, ex: 'Laki-laki'}), R('status', 'Status', 'enum', {opts: EMP_STATUS, ex: EMP_STATUS.pkwtt}), R('joinDate', 'Tanggal Mulai', 'date', {ex: '02/01/2025'}), C('endDate', 'Tanggal Berakhir', 'date', {note: 'Wajib untuk PKWT.'}), C('exitDate', 'Tanggal Keluar', 'date'),
      R('ptkp', 'PTKP', 'enum', {opts: Object.fromEntries(Object.keys(PTKP).map(k => [k, k])), ex: 'TK/0'}), R('wage', 'Upah (Rp)', 'money', {ex: 3500000, note: 'Harian lepas: upah per hari.'}), C('allow', 'Tunjangan Tetap (Rp)', 'money', {ex: 0}), C('taxBy', 'PPh 21 Ditanggung', 'enum', {opts: TAXBY, ex: 'Karyawan'}), C('bpjsTk', 'Ikut BPJS Ketenagakerjaan', 'bool', {ex: 'Ya'}), C('bpjsKes', 'Ikut BPJS Kesehatan', 'bool', {ex: 'Ya'}), C('bpjsTkNo', 'No. BPJS Ketenagakerjaan', 'digits'), C('bpjsKesNo', 'No. BPJS Kesehatan', 'digits'), C('bank', 'Rekening Bank')],
    row: master('employees', 'karyawan', () => ({created: Date.now(), name: '', nik: '', npwp: '', title: '', gender: 'L', status: 'pkwtt', joinDate: '', endDate: '', exitDate: '', ptkp: 'TK/0', wage: 0, allow: 0, taxBy: 'karyawan', bpjsTk: true, bpjsKes: true, bpjsTkNo: '', bpjsKesNo: '', bank: ''}), r => {
      if (r.nik && !/^\d{16}$/.test(r.nik)) throw new Error('NIK harus 16 angka');
      if (!(r.wage > 0)) throw new Error('Isi upah');
      if (r.status === 'pkwt') { if (!r.endDate) throw new Error('Isi tanggal berakhir kontrak (PKWT)'); if (r.endDate <= r.joinDate) throw new Error('Tanggal berakhir harus setelah tanggal mulai'); if (monthsBetween(r.joinDate, r.endDate) > 60) throw new Error('PKWT paling lama 5 tahun termasuk perpanjangan'); } else r.endDate = '';
      if (r.exitDate && r.exitDate < r.joinDate) throw new Error('Tanggal keluar tidak boleh sebelum tanggal mulai');
      return belowMin(r) || belowFloor(r) ? 'Upah di bawah batas di tab Aturan' : '';
    })},
  attendance: {title: 'Absensi', group: 'SDM', roles: ['hr'], update: true, desc: 'Kehadiran harian karyawan.',
    cols: [R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), R('emp', 'Karyawan', 'text', {list: 'karyawan', ex: 'Andi Saputra', note: 'Nama atau NIK.'}), R('status', 'Status', 'enum', {opts: ATT_STATUS, ex: 'Hadir'})],
    row(v, x) {
      const e = empRef(v.emp), k = e.id + v.date; noLock(v.date);
      if (x.seen.has(k)) throw new Error(`Sama dengan baris ${x.seen.get(k)}`); x.seen.set(k, x.line);
      const cur = state.attendance.find(a => a.empId === e.id && a.date === v.date); if (cur && !x.update) return {skip: 'Sudah ada, dilewati'};
      return {label: `${e.name} · ${v.date}`, mode: cur ? 'ubah' : 'baru', apply() { if (cur) cur.status = v.status; else state.attendance.push({id: 'at' + hash(e.id + v.date) + shardOf(v.date), empId: e.id, date: v.date, status: v.status}); }};
    }},
  leaves: {title: 'Cuti & izin', group: 'SDM', roles: ['hr'], desc: 'Pengajuan cuti. Tersimpan sebagai draf sampai disetujui.',
    cols: [R('emp', 'Karyawan', 'text', {list: 'karyawan', ex: 'Andi Saputra', note: 'Nama atau NIK.'}), R('type', 'Jenis', 'enum', {opts: LEAVE_TYPES, ex: LEAVE_TYPES.tahunan}), R('date', 'Mulai', 'date', {ex: '03/11/2026'}), R('to', 'Sampai', 'date', {ex: '04/11/2026'}), C('note', 'Keterangan', 'text', {max: 300})],
    row: v => { const e = empRef(v.emp); noLock(v.date); if (v.to < v.date) throw new Error('Tanggal selesai tidak boleh sebelum mulai'); if (state.leaves.some(l => l.empId === e.id && l.date === v.date)) return {skip: 'Sudah ada, dilewati'}; return {label: `${e.name} · ${v.date}`, mode: 'baru', apply() { const r = {id: uid(), created: Date.now(), empId: e.id, type: v.type, date: v.date, to: v.to, days: workDaysBetween(v.date, v.to), status: 'draft', approvedBy: '', note: v.note}; state.leaves.push(r); log('tambah', 'leaves', r.id, v.date); }}; }},
  kasbons: {title: 'Kasbon', group: 'SDM', roles: ['hr'], desc: 'Pinjaman karyawan. Ikut tercatat sebagai pengeluaran kas.',
    cols: [R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), R('ref', 'No. Bukti', 'text', {max: 40, ex: 'KB-2610-001'}), R('emp', 'Karyawan', 'text', {list: 'karyawan', ex: 'Andi Saputra', note: 'Nama atau NIK.'}), R('amount', 'Jumlah (Rp)', 'money', {ex: 500000}), R('account', 'Dibayar dari Akun', 'text', {list: 'akun', ex: 'Kas'}), C('note', 'Keterangan', 'text', {max: 300})],
    row(v, x) {
      const e = empRef(v.emp), a = accRef(v.account), k = norm(v.ref); noLock(v.date);
      if (!(v.amount > 0)) throw new Error('Isi jumlah');
      if (x.seen.has(k)) throw new Error(`No. bukti sama dengan baris ${x.seen.get(k)}`); x.seen.set(k, x.line);
      if (state.kasbons.some(r => r.ref === v.ref) || state.tx.some(t => t.ref === v.ref)) throw new Error(`No. bukti ${v.ref} sudah dipakai`);
      return {label: `${v.ref} · ${e.name}`, mode: 'baru', apply() { const r = {id: uid(), created: Date.now(), empId: e.id, date: v.date, ref: v.ref, amount: v.amount, accountId: a.id, note: v.note}; state.kasbons.push(r); FORMS.kasbons.after(r); log('tambah', 'kasbons', r.id, v.ref); }};
    }},
  accounts: {title: 'Akun kas & bank', group: 'Keuangan', roles: [], update: true, desc: 'Akun kas, bank, dan saldo awalnya.',
    cols: [C('code', 'Kode', 'text', {max: 20, ex: '1-103'}), R('name', 'Nama Akun', 'text', {ex: 'Bank BSI'}), C('opening', 'Saldo Awal (Rp)', 'money', {neg: true, ex: 10000000})],
    row: master('accounts', 'akun', () => ({code: '', name: '', opening: 0}), (r, cur) => { if (state.lockedUntil && r.opening !== (cur?.opening || 0)) throw new Error('Saldo awal tidak bisa diisi setelah tutup buku; catat sebagai transaksi setoran'); })},
  tx: {title: 'Transaksi kas', group: 'Keuangan', roles: [], desc: 'Pemasukan, pengeluaran, dan mutasi antarakun.',
    cols: [R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), C('ref', 'No. Bukti', 'text', {max: 40, ex: 'BKK-2610-001', note: 'Kosong berarti dibuat otomatis.'}), R('type', 'Jenis', 'enum', {opts: TXT, ex: 'Pengeluaran'}), R('account', 'Akun', 'text', {list: 'akun', ex: 'Kas'}), C('to', 'Akun Tujuan', 'text', {list: 'akun', note: 'Wajib untuk mutasi.'}), C('cat', 'Kategori', 'text', {list: 'kategori', ex: '5-301', note: 'Kode atau nama kategori. Wajib selain mutasi.'}), R('amount', 'Jumlah (Rp)', 'money', {ex: 1500000}), C('desc', 'Uraian', 'text', {max: 500, ex: 'Sewa kantor Oktober'}), C('center', 'Pusat Biaya', 'text')],
    row(v, x) {
      noLock(v.date); if (!(v.amount > 0)) throw new Error('Jumlah harus lebih dari 0');
      const a = accRef(v.account), to = v.type === 'transfer' ? accRef(v.to, 'Akun tujuan') : null, cat = v.type === 'transfer' ? null : catRef(v.cat, v.type);
      if (to?.id === a.id) throw new Error('Akun asal dan tujuan harus berbeda');
      const center = v.center ? ref(state.centers, v.center, 'Pusat biaya', 'code', 'name') : null;
      if (v.ref) { const k = norm(v.ref); if (x.refs.has(k)) throw new Error(`No. bukti sama dengan baris ${x.refs.get(k)}`); x.refs.set(k, x.line); if (state.tx.some(t => t.ref === v.ref)) throw new Error(`No. bukti ${v.ref} sudah dipakai`); }
      return {label: `${v.ref || 'Otomatis'} · ${rp(v.amount)}`, mode: 'baru', apply() {
        let r = v.ref;
        if (!r) { const base = nextRef(v.type, v.date), pre = base.slice(0, base.lastIndexOf('-') + 1); let n = parseInt(base.slice(pre.length)); r = base; while (x.refs.has(norm(r))) r = pre + String(++n).padStart(3, '0'); }
        const t = {id: uid(), created: Date.now(), type: v.type, date: v.date, ref: r, amount: v.amount, accountId: a.id, desc: v.desc, categoryId: cat?.id || null, toAccountId: to?.id || null}; if (center) t.centerId = center.id;
        state.tx.push(t); log('tambah', 'transaksi', t.id, txSummary(t));
      }};
    }},
  debts: {title: 'Piutang & utang', group: 'Keuangan', roles: [], desc: 'Tagihan dan kewajiban yang belum lunas, termasuk saldo lama.',
    cols: [R('kind', 'Jenis', 'enum', {opts: DEBT, ex: 'Piutang'}), R('party', 'Pihak', 'text', {ex: 'PT Maju Bersama'}), C('ref', 'No. Faktur', 'text', {max: 40, ex: 'INV-001'}), R('date', 'Tanggal', 'date', {ex: '01/10/2026'}), C('due', 'Jatuh Tempo', 'date', {ex: '31/10/2026'}), R('amount', 'Nilai (Rp)', 'money', {ex: 2500000}), R('cat', 'Kategori', 'text', {list: 'kategori', ex: '4-101'}), C('desc', 'Uraian', 'text', {max: 500})],
    row: v => { noLock(v.date); if (!(v.amount > 0)) throw new Error('Nilai harus lebih dari 0'); if (v.due && v.due < v.date) throw new Error('Jatuh tempo tidak boleh sebelum tanggal'); const c = catRef(v.cat, v.kind === 'piutang' ? 'in' : 'out'); if (v.ref && state.debts.some(d => d.kind === v.kind && d.ref === v.ref)) throw new Error(`No. faktur ${v.ref} sudah ada`); return {label: `${v.party} · ${rp(v.amount)}`, mode: 'baru', apply() { const d = {id: uid(), created: Date.now(), kind: v.kind, party: v.party, ref: v.ref, date: v.date, due: v.due, amount: v.amount, categoryId: c.id, desc: v.desc}; state.debts.push(d); log('tambah', v.kind, d.id, debtSummary(d)); }}; }},
  assets: {title: 'Aset tetap', group: 'Keuangan', roles: [], update: true, desc: 'Daftar aset tetap dan dasar penyusutannya.',
    cols: [R('name', 'Nama Aset', 'text', {ex: 'Mobil Operasional'}), C('code', 'Kode', 'text', {max: 30}), R('date', 'Tanggal Perolehan', 'date', {ex: '15/01/2025'}), R('cost', 'Harga Perolehan (Rp)', 'money', {ex: 200000000}), R('group', 'Kelompok', 'enum', {opts: labelOf(ASSET_GROUPS), ex: ASSET_GROUPS[2][0]}), C('life', 'Masa Manfaat (bulan)', 'int', {note: 'Wajib untuk kelompok Lainnya.'}), C('residual', 'Nilai Sisa (Rp)', 'money', {ex: 0}), C('opening', 'Aset Lama', 'bool', {ex: 'Ya', note: 'Ya bila belum tercatat lewat transaksi kategori aset.'})],
    row: master('assets', 'assets', () => ({created: Date.now(), name: '', code: '', date: '', cost: 0, life: 0, residual: 0, group: '0', opening: false}), (r, cur) => { noLock(r.date); if (cur) noLock(cur.date); const e = FORMS.assets.prep(r); if (e) throw new Error(e); })},
  journals: {title: 'Jurnal manual', group: 'Keuangan', roles: [], desc: 'Jurnal penyesuaian dengan akun debit dan kredit.',
    cols: [R('date', 'Tanggal', 'date', {ex: '31/10/2026'}), R('ref', 'No. Bukti', 'text', {max: 40, ex: 'JM-2610-001'}), R('drCode', 'Akun Debit', 'text', {list: 'kodeAkun', ex: '5-901'}), R('crCode', 'Akun Kredit', 'text', {list: 'kodeAkun', ex: '5-305'}), R('amount', 'Jumlah (Rp)', 'money', {ex: 100000}), C('desc', 'Uraian', 'text', {max: 500})],
    row(v, x) {
      noLock(v.date); const k = norm(v.ref), list = chartList();
      if (x.seen.has(k)) throw new Error(`No. bukti sama dengan baris ${x.seen.get(k)}`); x.seen.set(k, x.line);
      if (state.journals.some(j => j.ref === v.ref)) throw new Error(`No. bukti ${v.ref} sudah dipakai`);
      for (const c of [v.drCode, v.crCode]) if (!list.some(a => a.id === c)) throw new Error(`Kode akun ${c} tidak ada di daftar`);
      const d = {date: v.date, ref: v.ref, drCode: v.drCode, crCode: v.crCode, amount: v.amount, desc: v.desc}, e = FORMS.journals.prep(d); if (e) throw new Error(e);
      return {label: `${v.ref} · ${rp(v.amount)}`, mode: 'baru', apply() { const r = {id: uid(), created: Date.now(), ...d}; state.journals.push(r); log('tambah', 'journals', r.id, v.ref); }};
    }},
  budgets: {title: 'Anggaran', group: 'Keuangan', roles: [], update: true, desc: 'Anggaran tahunan per kategori.',
    cols: [R('year', 'Tahun', 'int', {ex: 2026}), R('cat', 'Kategori', 'text', {list: 'kategori', ex: '5-301'}), R('amount', 'Anggaran (Rp)', 'money', {ex: 60000000})],
    row(v, x) {
      const y = String(v.year); if (!/^\d{4}$/.test(y)) throw new Error('Tahun harus 4 angka');
      const c = catRef(v.cat), k = y + c.id; if (c.lr === false) throw new Error(`Kategori ${c.name} bukan pendapatan atau beban, jadi tidak bisa dianggarkan`); if (x.seen.has(k)) throw new Error(`Sama dengan baris ${x.seen.get(k)}`); x.seen.set(k, x.line);
      const cur = state.budgets.find(b => b.year === y && b.categoryId === c.id); if (cur && !x.update) return {skip: 'Sudah ada, dilewati'};
      return {label: `${y} · ${c.name}`, mode: cur ? 'ubah' : 'baru', apply() { if (cur) cur.amount = v.amount; else state.budgets.push({id: uid(), year: y, categoryId: c.id, amount: v.amount}); log(cur ? 'ubah' : 'tambah', 'budgets', cur?.id || '', `${y} · ${c.name}`); }};
    }},
};
const ugAllowed = key => { const r = company?.role || 'owner'; return ['owner', 'finance'].includes(r) || UNGGAH[key].roles.includes(r); };
const ugKinds = () => Object.keys(UNGGAH).filter(ugAllowed);

/* ---------- Menyusun file template ---------- */
const xe = s => String(s ?? '').replace(/[^\x09\x0A\x0D\x20-퟿-�]/g, '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
const xCell = (ref_, v, s = 0) => typeof v === 'number' ? `<c r="${ref_}" s="${s}"><v>${v}</v></c>` : v === '' || v === undefined ? `<c r="${ref_}" s="${s}"/>` : `<c r="${ref_}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
const xRow = (n, cells, s) => `<row r="${n}">${cells.map((v, i) => xCell(colName(i) + n, v, typeof s === 'function' ? s(i) : s)).join('')}</row>`;
const XS = {head: 1, headReq: 2, text: 3, date: 4, money: 5, qty: 6, title: 7, wrap: 8, tableHead: 9};
const colStyle = c => c.t === 'date' ? XS.date : c.t === 'money' ? XS.money : ['qty', 'pct', 'int'].includes(c.t) ? XS.qty : XS.text;
const colFormat = c => ({date: 'Tanggal, contoh 31/12/2026', money: 'Angka tanpa titik atau Rp', int: 'Angka bulat', qty: 'Angka', pct: 'Angka 0 sampai 100', bool: 'Ya atau Tidak', enum: 'Pilih dari daftar', digits: 'Teks angka'}[c.t] || (c.list ? 'Pilih dari daftar atau ketik' : 'Teks'));
const XL_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font><font><b/><sz val="15"/><color rgb="FF14304A"/><name val="Calibri"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF14304A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5B700"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
function templateFiles(key) {
  const s = UNGGAH[key], X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>', NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const lists = [], validations = [];
  s.cols.forEach((c, i) => {
    const vals = c.t === 'bool' ? ['Ya', 'Tidak'] : c.t === 'enum' ? Object.values(c.opts) : c.list ? LISTS[c.list]() : null;
    if (!vals?.length) return;
    lists.push([c.h, vals]);
    const col = colName(lists.length - 1), range = `${colName(i)}2:${colName(i)}${XL_TEMPLATE_ROWS + 1}`, strict = c.t === 'bool' || c.t === 'enum' ? 1 : 0;
    validations.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="${strict}" errorTitle="Pilihan tidak ada" error="Pilih salah satu dari daftar." sqref="${range}"><formula1>Daftar!$${col}$2:$${col}$${vals.length + 1}</formula1></dataValidation>`);
  });
  const data = `${X}<worksheet ${NS}><sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>
<cols>${s.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(14, Math.min(34, c.h.length + 5))}" style="${colStyle(c)}" customWidth="1"/>`).join('')}</cols>
<sheetData><row r="1" ht="32" customHeight="1">${s.cols.map((c, i) => xCell(colName(i) + 1, c.h + (c.req ? ' *' : ''), c.req ? XS.headReq : XS.head)).join('')}</row></sheetData>${validations.length ? `<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>` : ''}</worksheet>`;
  const guide = [xRow(1, [`Template ${s.title}`], XS.title), xRow(2, [s.desc]),
    xRow(3, [`Isi lembar Data mulai baris 2. Kolom kuning bertanda * wajib diisi. Jangan mengubah judul kolom. Paling banyak ${XL_MAX_ROWS.toLocaleString('id-ID')} baris per file.`]),
    xRow(5, ['Kolom', 'Wajib', 'Cara mengisi', 'Keterangan', 'Contoh'], XS.tableHead),
    ...s.cols.map((c, i) => xRow(6 + i, [c.h, c.req ? 'Wajib' : 'Boleh kosong', colFormat(c), c.note || '', c.ex ?? ''], XS.wrap))].join('');
  const sheet2 = `${X}<worksheet ${NS}><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="28" customWidth="1"/><col min="4" max="4" width="52" customWidth="1"/><col min="5" max="5" width="26" customWidth="1"/></cols><sheetData>${guide}</sheetData></worksheet>`;
  const depth = Math.max(0, ...lists.map(l => l[1].length)), rows = [lists.length ? xRow(1, lists.map(l => l[0]), XS.tableHead) : ''];
  for (let r = 0; r < depth; r++) rows.push(`<row r="${r + 2}">${lists.map((l, i) => r < l[1].length ? xCell(colName(i) + (r + 2), l[1][r]) : '').join('')}</row>`);
  const sheet3 = `${X}<worksheet ${NS}><sheetFormatPr defaultRowHeight="15"/>${lists.length ? `<cols><col min="1" max="${lists.length}" width="28" customWidth="1"/></cols>` : ''}<sheetData>${rows.join('')}</sheetData></worksheet>`;
  const R_ = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', P = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return [['[Content_Types].xml', `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${P}.sheet.main+xml"/>${[1, 2, 3].map(n => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${P}.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="${P}.styles+xml"/></Types>`],
    ['_rels/.rels', `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${X}<workbook ${NS} xmlns:r="${R_}"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Petunjuk" sheetId="2" r:id="rId2"/><sheet name="Daftar" sheetId="3" r:id="rId3"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1, 2, 3].map(n => `<Relationship Id="rId${n}" Type="${R_}/worksheet" Target="worksheets/sheet${n}.xml"/>`).join('')}<Relationship Id="rId4" Type="${R_}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', XL_STYLES], ['xl/worksheets/sheet1.xml', data], ['xl/worksheets/sheet2.xml', sheet2], ['xl/worksheets/sheet3.xml', sheet3]];
}
const templateBytes = key => zipStore(templateFiles(key));

/* ---------- Pemeriksaan isi file ---------- */
function ugCheck(key, file, update) {
  const s = UNGGAH[key], [head, ...body] = file.rows, out = {key, items: [], fatal: ''};
  if (!head) { out.fatal = 'File kosong.'; return out; }
  const pos = new Map(); head.cells.forEach((h, i) => { if (h !== undefined) pos.set(headKey(h), i); });
  const missing = s.cols.filter(c => c.req && !pos.has(norm(c.h)));
  if (missing.length) { out.fatal = `Kolom ${missing.map(c => c.h).join(', ')} tidak ditemukan. Pastikan memakai template ${s.title}.`; return out; }
  if (!body.length) { out.fatal = 'Belum ada baris data di bawah judul kolom.'; return out; }
  const x = {update, seen: new Map(), codes: new Map(), refs: new Map(), groups: new Map(), line: 0};
  for (const r of body) {
    x.line = r.line; let item;
    try {
      const v = {}; for (const c of s.cols) v[c.k] = pos.has(norm(c.h)) ? cellValue(c, r.cells[pos.get(norm(c.h))], file.date1904) : '';
      item = s.row(v, x);
    } catch (e) { item = {err: e.message, label: String(r.cells.find(c => c !== undefined && c !== '') ?? '').slice(0, 60)}; }
    item.line = r.line; out.items.push(item);
  }
  if (s.finish && out.items.every(i => !i.err)) s.finish(x);
  out.errors = out.items.filter(i => i.err).length; out.skipped = out.items.filter(i => i.skip).length;
  out.added = out.items.filter(i => !i.err && !i.skip && i.mode === 'baru').length; out.changed = out.items.filter(i => !i.err && !i.skip && i.mode === 'ubah').length;
  out.docs = out.items.filter(i => i.doc).length;
  return out;
}
function ugGuardSize() {
  if (!company) return;
  const size = new Map();
  for (const e of flatten(state).values()) { const k = e.sub + '/' + e.bid; size.set(k, (size.get(k) || 0) + e.json.length + e.rid.length + 8); }
  for (const [k, n] of size) if (n > BUCKET_MAX) throw new Error(`Data kelompok ${k.split('/')[1].split('~')[0]} terlalu besar untuk satu penyimpanan server. Pecah file menjadi bagian lebih kecil.`);
}

/* ---------- Halaman ---------- */
let ugKey = '', ugFile = null, ugName = '', ugPlan = null;
function renderUnggah() {
  const keys = ugKinds(); if (!keys.includes(ugKey)) ugKey = keys[0] || '';
  const groups = [...new Set(keys.map(k => UNGGAH[k].group))];
  $('ugKind').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${keys.filter(k => UNGGAH[k].group === g).map(k => `<option value="${k}"${k === ugKey ? ' selected' : ''}>${esc(UNGGAH[k].title)}</option>`).join('')}</optgroup>`).join('');
  $('ugList').innerHTML = groups.map(g => `<h4 class="ug-group">${esc(g)}</h4><div class="ug-grid">${keys.filter(k => UNGGAH[k].group === g).map(k => `<div class="ug-item"><div><b>${esc(UNGGAH[k].title)}</b><p class="muted">${esc(UNGGAH[k].desc)}</p></div><button type="button" class="btn sm" data-act="ugTpl" data-id="${k}">Unduh template</button></div>`).join('')}</div>`).join('') || '<div class="empty">Akun ini hanya bisa melihat data.</div>';
  $('ugForm').hidden = !keys.length;
  const s = UNGGAH[ugKey]; if (!s) return;
  $('ugUpdateWrap').hidden = !s.update;
  $('ugNeed').innerHTML = `Kolom wajib: ${s.cols.filter(c => c.req).map(c => `<b>${esc(c.h)}</b>`).join(', ')}.`;
}
function ugShow() {
  const p = ugPlan, box = $('ugResult'); if (!p) { box.innerHTML = ''; return; }
  if (p.fatal) { box.innerHTML = `<div class="notice">${esc(p.fatal)}</div>`; return; }
  const ready = p.added + p.changed, s = UNGGAH[p.key], tag = i => i.err ? ['Salah', 'out'] : i.skip ? ['Dilewati', 'warn'] : i.mode === 'ubah' ? ['Diperbarui', 'tr'] : ['Baru', 'in'];
  const rows = [...p.items].sort((a, b) => !!b.err - !!a.err || !!b.warn - !!a.warn || a.line - b.line).slice(0, 300);
  box.innerHTML = `<div class="grid cards">${statCard(['Siap disimpan', ready.toLocaleString('id-ID'), 'in', p.docs ? `${p.docs} dokumen` : `${p.added} baru, ${p.changed} diperbarui`])}${statCard(['Dilewati', String(p.skipped), '', 'Sudah ada di aplikasi'])}${statCard(['Perlu diperbaiki', String(p.errors), p.errors ? 'out' : '', 'Baris yang salah'])}</div>
    <div class="card" style="margin-top:12px">
      <p class="muted" style="margin-top:0;font-size:12px">File: ${esc(ugName)}</p>
      ${p.errors ? `<div class="notice">Belum ada yang tersimpan. Perbaiki ${p.errors} baris di file, lalu unggah ulang.</div>` : ''}
      <div class="toolbar"><button type="button" class="btn primary" data-act="ugSave"${p.errors || !ready ? ' disabled' : ''}>Simpan ${ready.toLocaleString('id-ID')} data ${esc(s.title.toLowerCase())}</button>${p.errors ? '<button type="button" class="btn" data-act="ugErrors">Unduh daftar kesalahan</button>' : ''}<button type="button" class="btn" data-act="ugReset">Batal</button></div>
      <div class="table-wrap"><table class="rtable"><thead><tr><th>Baris</th><th>Status</th><th>Data</th><th>Catatan</th></tr></thead><tbody>${rows.map(i => { const t = tag(i); return `<tr><td data-label="Baris">${i.line}</td><td data-label="Status"><span class="badge ${t[1]}">${t[0]}</span></td><td data-label="Data">${esc(i.label)}</td><td data-label="Catatan" class="${i.err ? 'out' : ''}">${esc(i.err || i.skip || i.warn || '')}</td></tr>`; }).join('')}</tbody></table></div>
      ${p.items.length > rows.length ? `<p class="muted" style="font-size:12px">Ditampilkan ${rows.length} dari ${p.items.length} baris; yang bermasalah tampil lebih dulu.</p>` : ''}
    </div>`;
}
const ugRun = () => { ugPlan = ugFile ? ugCheck(ugKey, ugFile, $('ugUpdate').checked && !!UNGGAH[ugKey].update) : null; ugShow(); };
async function ugOpen(f) {
  if (!f) return;
  ugPlan = null; ugFile = null; ugName = f.name.slice(0, 80); ugShow();
  const fail = m => { ugPlan = {fatal: m}; ugShow(); };
  if (f.size > XL_MAX_FILE) return fail('File lebih dari 5 MB. Pecah menjadi beberapa file.');
  if (/\.xls$/i.test(f.name)) return fail('Format .xls lama belum didukung. Di Excel pilih Simpan Sebagai, lalu pilih format .xlsx.');
  if (!/\.(xlsx|csv)$/i.test(f.name)) return fail('Pilih file .xlsx atau .csv.');
  try { ugFile = /\.csv$/i.test(f.name) ? readCsv(await f.text()) : await readXlsx(await f.arrayBuffer()); ugRun(); }
  catch (e) { fail(e?.message || 'File tidak bisa dibaca.'); }
}
function ugSave() {
  if (!ugPlan || !ugAllowed(ugPlan.key)) return toast('Peran Anda tidak bisa mengunggah data ini');
  ugRun(); // diperiksa ulang karena data bisa berubah sejak pratinjau
  const p = ugPlan, s = UNGGAH[p.key]; if (p.fatal || p.errors) return toast('Masih ada baris yang perlu diperbaiki');
  const go = p.items.filter(i => i.apply); if (!go.length) return toast('Tidak ada data baru untuk disimpan');
  const n = p.added + p.changed; if (!confirm(`Simpan ${n.toLocaleString('id-ID')} data ${s.title.toLowerCase()} dari ${ugName}?`)) return;
  const backup = JSON.stringify(state);
  try {
    go.forEach(i => i.apply());
    log('unggah', s.title.toLowerCase(), '', `File ${ugName} · ${p.added} baru · ${p.changed} diperbarui · ${p.skipped} dilewati`);
    ugGuardSize();
  } catch (e) { state = JSON.parse(backup); memo = null; return toast(e?.message || 'Gagal menyimpan; tidak ada data yang berubah'); }
  ugFile = ugPlan = null; $('ugFileInput').value = ''; ugShow();
  save(); toast(`${n.toLocaleString('id-ID')} data ${s.title.toLowerCase()} tersimpan`);
}
Object.assign(ACTIONS, {
  ugTpl: async k => { if (ugAllowed(k)) await download(templateBytes(k), `template-${UNGGAH[k].title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); },
  ugSave,
  ugReset: () => { ugFile = ugPlan = null; $('ugFileInput').value = ''; ugShow(); },
  ugErrors: () => { if (ugPlan) download(toCsv([['Baris', 'Data', 'Kesalahan'], ...ugPlan.items.filter(i => i.err).map(i => [i.line, i.label || '', i.err])]), `kesalahan-${ugKey}-${today()}.csv`, 'text/csv'); },
});
$('ugKind').onchange = e => { ugKey = e.target.value; renderUnggah(); ugRun(); };
$('ugUpdate').onchange = ugRun;
// Pilihan dikosongkan setelah dibaca, agar file yang sama bisa diunggah ulang setelah diperbaiki
$('ugFileInput').onchange = async e => { const f = e.target.files[0]; await ugOpen(f); e.target.value = ''; };
$('btnUgTpl').onclick = () => ACTIONS.ugTpl(ugKey);
$('btnGoUnggah').onclick = () => goView('unggah');
