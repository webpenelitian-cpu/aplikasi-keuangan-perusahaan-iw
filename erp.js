'use strict';
/* Modul ERP: perusahaan bersama (banyak pengguna), penjualan & CRM, pembelian & gudang, akuntansi lanjutan, dan SDM lanjutan.
   Berkas ini dimuat setelah app.js dan memakai fungsi serta data yang sama. */

const APP_VERSION = '28'; // samakan dengan versi CACHE di sw.js
const ROLES = {owner: 'Pimpinan', finance: 'Keuangan', sales: 'Penjualan', warehouse: 'Gudang & pembelian', hr: 'SDM', viewer: 'Hanya lihat'};
const ROLE_VIEWS = {sales: ['dashboard', 'transaksi', 'jualbeli', 'erp', 'hutang', 'unggah', 'laporan', 'panduan', 'pengaturan'], warehouse: ['dashboard', 'transaksi', 'jualbeli', 'erp', 'hutang', 'unggah', 'laporan', 'panduan', 'pengaturan'],
  hr: ['dashboard', 'karyawan', 'unggah', 'laporan', 'panduan', 'pengaturan'], viewer: ['dashboard', 'laporan', 'panduan', 'pengaturan']};
const ACC_ASET = {code: '1-401', name: 'Pembelian aset tetap'};
const ACC_AKUM = {code: '1-491', name: 'Akumulasi penyusutan'};
const ACC_DEP = {code: '5-401', name: 'Beban penyusutan'};
const ASSET_GROUPS = {1: ['Kelompok 1 (4 tahun)', 48], 2: ['Kelompok 2 (8 tahun)', 96], 3: ['Kelompok 3 (16 tahun)', 192], 4: ['Kelompok 4 (20 tahun)', 240], 0: ['Lainnya (isi sendiri)', 0]};
const ORDER_KINDS = {quote: {label: 'Penawaran', prefix: 'QT', title: 'PENAWARAN HARGA', side: 'sale', next: 'so', nextLabel: 'Jadikan pesanan'},
  so: {label: 'Pesanan penjualan', prefix: 'SO', title: 'PESANAN PENJUALAN', side: 'sale', invoice: true},
  pr: {label: 'Permintaan pembelian', prefix: 'PR', title: 'PERMINTAAN PEMBELIAN', side: 'purchase', next: 'po', nextLabel: 'Jadikan PO', approval: true},
  po: {label: 'Pesanan pembelian', prefix: 'PO', title: 'PURCHASE ORDER', side: 'purchase', invoice: true, approval: true}};
const ORDER_STATUS = {draft: ['Draf', 'warn'], approved: ['Disetujui', 'in'], cancelled: ['Dibatalkan', 'out']};
const ATT_STATUS = {hadir: 'Hadir', izin: 'Izin', sakit: 'Sakit', cuti: 'Cuti', alpa: 'Tanpa keterangan'};
const LEAVE_TYPES = {tahunan: 'Cuti tahunan', sakit: 'Sakit', melahirkan: 'Melahirkan', penting: 'Alasan penting', lain: 'Lainnya'};
const LEAVE_QUOTA = 12;

function erpDefaults() {
  return {customers: [], orders: [], warehouses: [], transfers: [], centers: [], assets: [], journals: [], budgets: [], attendance: [], leaves: [], kasbons: [],
    salespeople: [], contacts: [], batches: [], recurring: [], recons: [], empdocs: [], reviews: [], shifts: []};
}
function sanitizeErp(d) {
  const num = v => Math.abs(cleanNum(v)), oneOf = (v, o, def) => Object.hasOwn(o, v) ? v : def, acc = a => ({code: cleanStr(a?.code, 20), name: cleanStr(a?.name, 120)});
  return {
    ...sanitizeMore(d),
    customers: list(d.customers).map(c => ({id: cleanId(c?.id), name: cleanStr(c?.name, 120), pic: cleanStr(c?.pic, 120), phone: cleanStr(c?.phone, 40), email: cleanStr(c?.email, 120),
      address: cleanStr(c?.address, 300), npwp: cleanStr(c?.npwp, 30), terms: num(c?.terms), wapu: c?.wapu === true, limit: num(c?.limit), disc: cleanPct(c?.disc, 0)})).filter(c => c.id && c.name),
    orders: list(d.orders).map(o => ({id: cleanId(o?.id), created: cleanNum(o?.created), kind: oneOf(o?.kind, ORDER_KINDS, 'quote'), date: cleanDate(o?.date), ref: cleanStr(o?.ref, 40),
      partyId: o?.partyId ? cleanId(o.partyId) : null, lines: list(o?.lines).map(cleanLine).filter(l => l.itemId && l.qty > 0), status: oneOf(o?.status, ORDER_STATUS, 'draft'),
      approvedBy: cleanStr(o?.approvedBy, 60), fromId: o?.fromId ? cleanId(o.fromId) : null, due: cleanDate(o?.due), note: cleanStr(o?.note)})).filter(o => o.id && o.date),
    warehouses: list(d.warehouses).map(w => ({id: cleanId(w?.id), name: cleanStr(w?.name, 120), address: cleanStr(w?.address, 300)})).filter(w => w.id && w.name),
    transfers: list(d.transfers).map(t => ({id: cleanId(t?.id), created: cleanNum(t?.created), date: cleanDate(t?.date), ref: cleanStr(t?.ref, 40), fromId: t?.fromId ? cleanId(t.fromId) : '', toId: t?.toId ? cleanId(t.toId) : '',
      itemId: cleanId(t?.itemId), qty: cleanQty(t?.qty), desc: cleanStr(t?.desc)})).filter(t => t.id && t.date && t.itemId && t.qty > 0),
    centers: list(d.centers).map(c => ({id: cleanId(c?.id), code: cleanStr(c?.code, 20), name: cleanStr(c?.name, 120)})).filter(c => c.id && c.name),
    assets: list(d.assets).map(a => ({id: cleanId(a?.id), created: cleanNum(a?.created), code: cleanStr(a?.code, 30), name: cleanStr(a?.name, 120), date: cleanDate(a?.date), cost: num(a?.cost), life: num(a?.life),
      residual: num(a?.residual), group: oneOf(String(a?.group), ASSET_GROUPS, '0'), opening: a?.opening === true})).filter(a => a.id && a.name && a.date),
    journals: list(d.journals).map(j => ({id: cleanId(j?.id), created: cleanNum(j?.created), date: cleanDate(j?.date), ref: cleanStr(j?.ref, 40), desc: cleanStr(j?.desc), dr: acc(j?.dr), cr: acc(j?.cr), amount: num(j?.amount)}))
      .filter(j => j.id && j.date && j.amount > 0 && j.dr.code && j.cr.code),
    budgets: list(d.budgets).map(b => ({id: cleanId(b?.id), year: cleanStr(b?.year, 4), categoryId: cleanId(b?.categoryId), amount: num(b?.amount)})).filter(b => b.id && b.categoryId),
    attendance: list(d.attendance).map(a => ({id: cleanId(a?.id), empId: cleanId(a?.empId), date: cleanDate(a?.date), status: oneOf(a?.status, ATT_STATUS, 'hadir')})).filter(a => a.id && a.empId && a.date),
    leaves: list(d.leaves).map(l => ({id: cleanId(l?.id), created: cleanNum(l?.created), empId: cleanId(l?.empId), type: oneOf(l?.type, LEAVE_TYPES, 'tahunan'), date: cleanDate(l?.date), to: cleanDate(l?.to), days: num(l?.days),
      status: oneOf(l?.status, ORDER_STATUS, 'draft'), approvedBy: cleanStr(l?.approvedBy, 60), note: cleanStr(l?.note, 300)})).filter(l => l.id && l.empId && l.date),
    kasbons: list(d.kasbons).map(k => ({id: cleanId(k?.id), created: cleanNum(k?.created), empId: cleanId(k?.empId), date: cleanDate(k?.date), ref: cleanStr(k?.ref, 40), amount: num(k?.amount), accountId: cleanId(k?.accountId), note: cleanStr(k?.note, 300)}))
      .filter(k => k.id && k.empId && k.date),
  };
}
function mergeErp(S, L, m) {
  const add = (col, fix = x => x) => { const ids = new Set(S[col].map(x => x.id)); for (const x of L[col]) if (!ids.has(x.id)) S[col].push(fix(x)); };
  const lines = x => ({...x, lines: x.lines.map(l => ({...l, itemId: m.itemMap.get(l.itemId) ?? l.itemId}))});
  ['customers', 'warehouses', 'centers', 'assets', 'journals', 'salespeople', 'contacts', 'recons'].forEach(c => add(c));
  add('batches', b => ({...b, itemId: m.itemMap.get(b.itemId) ?? b.itemId}));
  add('recurring', r => ({...r, categoryId: m.catMap.get(r.categoryId) ?? r.categoryId, accountId: m.accMap.get(r.accountId) ?? r.accountId}));
  ['empdocs', 'reviews', 'shifts'].forEach(c => add(c, x => ({...x, empId: m.empMap.get(x.empId) ?? x.empId})));
  add('orders', o => lines({...o, partyId: o.partyId ? m.venMap.get(o.partyId) ?? o.partyId : null}));
  add('transfers', t => ({...t, itemId: m.itemMap.get(t.itemId) ?? t.itemId}));
  add('budgets', b => ({...b, categoryId: m.catMap.get(b.categoryId) ?? b.categoryId}));
  ['attendance', 'leaves'].forEach(c => add(c, x => ({...x, empId: m.empMap.get(x.empId) ?? x.empId})));
  add('kasbons', k => ({...k, empId: m.empMap.get(k.empId) ?? k.empId, accountId: m.accMap.get(k.accountId) ?? k.accountId}));
}

/* ---------- Perusahaan bersama ----------
   Data dipecah menjadi kelompok per jenis dan bulan. Tiap simpan hanya mengirim data yang berubah, sehingga dua pengguna yang
   mengisi bersamaan tidak saling menimpa. Data karyawan disimpan terpisah dan hanya terbuka untuk peran yang berhak. */
let company = null; // {id, name, role}
const SYNC_COLS = {accounts: 0, categories: 0, items: 0, vendors: 0, customers: 0, warehouses: 0, centers: 0, assets: 0, budgets: 0, salespeople: 0, batches: 0, recurring: 0,
  tx: 1, debts: 1, trades: 1, returns: 1, adjusts: 1, orders: 1, transfers: 1, journals: 1, audit: 1, contacts: 1, recons: 1,
  employees: 2, empdocs: 2, payrolls: 3, attendance: 3, leaves: 3, kasbons: 3, reviews: 3, shifts: 3};
const SETTING_KEYS = ['company', 'hr', 'tax', 'lockedUntil', 'lastBackup'];
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const shardOf = id => hash(id).charCodeAt(0) % 4;
function bucketOf(col, id, rec) {
  const kind = SYNC_COLS[col], dated = kind === 1 || kind === 3;
  const when = dated ? String(rec.date || rec.ts || '').slice(0, 7) || 'x' : '';
  // Jejak audit tiap akun punya kelompok sendiri yang memuat uid-nya, jadi penulisnya dibuktikan oleh aturan server
  if (col === 'audit' && rec.u) return {sub: 'buckets', id: `audit~${when}~${rec.u}~${shardOf(id)}`};
  return {sub: kind >= 2 ? 'hrdata' : 'buckets', id: `${col}~${when}~${shardOf(id)}`};
}
function flatten(s) {
  const m = new Map(), put = (col, id, rec, b) => m.set(col + '/' + id, {rid: id, rec, json: JSON.stringify(rec), sub: b.sub, bid: b.id});
  for (const col of Object.keys(SYNC_COLS))
    for (const r of s[col] || []) { const id = col === 'audit' ? 'a' + hash(auditKey(r)) + hash(r.ts) : r.id; put(col, id, r, bucketOf(col, id, r)); }
  for (const k of SETTING_KEYS) put('settings', k, {v: s[k]}, {sub: 'buckets', id: 'settings~~0'});
  return m;
}
let bucketStray = 0, shadow = new Map(), remote = new Map(), remoteReady = {buckets: false, hrdata: false}, rebuildTimer = null, unwatch = [];
// companyFresh: data perusahaan belum ada di server, jadi seluruh isi state harus diunggah
let companyFresh = false;
const companyShadow = () => { shadow = companyFresh ? new Map() : flatten(state); companyFresh = false; };
function companyData() {
  const d = {version: DATA_VERSION, audit: [], accounts: [], categories: [], tx: [], debts: [], security: state?.security || {autoLockMin: 5}}; let stray = 0;
  for (const col of Object.keys(SYNC_COLS)) d[col] ||= [];
  for (const [bid, r] of remote) {
    const col = bid.split('~')[0];
    if (col === 'settings') { if (bid === 'settings~~0') for (const k of SETTING_KEYS) if (r[k]) d[k] = r[k].v; continue; }
    // Identitas diambil dari nama kelompok yang dijaga server, bukan dari isi catatan yang ditulis peramban
    if (col === 'audit') { const owner = bid.split('~')[3] === undefined ? undefined : bid.split('~')[2]; for (const a of Object.values(r)) { const {u, ...rest} = a; d.audit.push(owner ? {...rest, u: owner} : rest); } continue; }
    // Server hanya bisa mengunci bulan lewat nama kelompok. Catatan bertanggal lain yang diselipkan ke kelompok ini tidak dipakai,
    // sehingga bulan yang sudah ditutup tetap aman dari aplikasi yang dimodifikasi
    if (d[col]) for (const x of Object.values(r)) { if ([1, 3].includes(SYNC_COLS[col]) && String(x?.date || x?.ts || '').slice(0, 7) !== bid.split('~')[1]) stray++; else d[col].push(x); }
  }
  bucketStray = stray;
  d.accounts.sort((a, b) => a.code.localeCompare(b.code)); d.categories.sort((a, b) => a.code.localeCompare(b.code));
  d.audit.sort((a, b) => a.ts.localeCompare(b.ts));
  return d;
}
function companyPersist() {
  const now = flatten(state), groups = new Map();
  const group = e => { const k = e.sub + '|' + e.bid; if (!groups.has(k)) groups.set(k, {sub: e.sub, bid: e.bid, set: {}, del: []}); return groups.get(k); };
  for (const [k, e] of now) {
    const old = shadow.get(k);
    if (old && old.bid === e.bid && old.json === e.json) continue;
    group(e).set[e.rid] = JSON.parse(e.json); // lewat JSON: Firestore menolak nilai undefined
    // data yang pindah kelompok (mis. tanggal berubah) dihapus dari kelompok lama
    if (old && old.bid !== e.bid) group(old).del.push(old.rid);
  }
  for (const [k, o] of shadow) if (!now.has(k)) group(o).del.push(o.rid);
  shadow = now;
  if (!groups.size) return Promise.resolve();
  setSync(navigator.onLine ? 'Menyimpan ke server…' : 'Offline: tersimpan di perangkat, dikirim otomatis saat online.');
  const writes = [...groups.values()].map(async g => Cloud.writeBucket(company.id, g.sub, g.bid, g.set, g.del));
  return Promise.allSettled(writes).then(res => {
    const bad = res.find(r => r.status === 'rejected');
    if (bad) {
      const code = bad.reason?.code || bad.reason?.message || 'tidak diketahui';
      setSync('Gagal menyimpan ke server: ' + code);
      toast(code === 'permission-denied' ? 'Sebagian perubahan ditolak server: peran Anda tidak mengizinkannya, atau bulannya sudah ditutup buku (misalnya isian offline yang terkirim setelah tutup buku). Periksa kembali data tersebut.' : 'Gagal menyimpan ke server: ' + code);
      companyRebuild();
    } else setSync('Tersimpan di server · ' + new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'}));
  });
}
function companyRebuild() {
  // Data dari pengguna lain ditunda selama formulir terbuka agar isian tidak hilang, lalu dicoba lagi
  clearTimeout(rebuildTimer);
  if (document.querySelector('dialog[open]')) { rebuildTimer = setTimeout(companyRebuild, 1000); return; }
  try { state = sanitizeState(companyData()); } catch { return; }
  companyShadow(); migrate(); memo = null; renderAll();
}
// bucketsFromCache: data pertama yang terbaca berasal dari salinan di perangkat (offline), bukan dari server
let bucketsFromCache = false;
function companyWatch() {
  return new Promise(resolve => {
    const done = () => { if (remoteReady.buckets && remoteReady.hrdata) resolve(); };
    // Tanpa internet, salinan perangkat yang kosong kadang baru dilaporkan setelah beberapa detik; jangan menunggu selamanya
    setTimeout(() => { if (!remoteReady.buckets) bucketsFromCache = true; remoteReady.buckets = remoteReady.hrdata = true; resolve(); }, 15000);
    const apply = (sub, changes, fromCache) => {
      for (const c of changes) { if (c.removed) remote.delete(c.id); else remote.set(c.id, c.r); }
      const first = !remoteReady[sub]; remoteReady[sub] = true;
      if (sub === 'buckets') bucketsFromCache = !!fromCache;
      if (first) done(); else if (state) companyRebuild();
    };
    // Ditolak setelah berjalan berarti akses dicabut: muat ulang agar data tidak terus tampil
    unwatch.push(Cloud.watchBuckets(company.id, 'buckets', (c, fc) => apply('buckets', c, fc), () => { if (remoteReady.buckets) return location.reload(); remoteReady.buckets = true; done(); }));
    unwatch.push(Cloud.watchBuckets(company.id, 'hrdata', (c, fc) => apply('hrdata', c, fc), () => { remoteReady.hrdata = true; done(); }));
  });
}
// Perusahaan terakhir yang dibuka di perangkat ini, agar tetap bisa dibuka saat offline. Hanya penanda; hak akses tetap diperiksa server.
const coMemoKey = () => KEY + ':co-of:' + cloudUser.uid;
async function openCompany() {
  let cid = null, member = null, co = null;
  try { cid = await Cloud.getCompanyId(); if (cid) { member = await Cloud.getMember(cid); co = await Cloud.getCompany(cid); } }
  catch {
    // Server tidak terjangkau dan salinan perangkat belum lengkap: pakai perusahaan terakhir yang dibuka di perangkat ini
    let m = null; try { m = JSON.parse(localStorage.getItem(coMemoKey())); } catch {}
    if (!m?.id || !ROLES[m.role]) return false;
    cid = m.id; member = {active: true, role: m.role}; co = {name: m.name};
  }
  if (!cid || !member?.active) { localStorage.removeItem(coMemoKey()); return false; }
  try { localStorage.setItem(coMemoKey(), JSON.stringify({id: cid, role: member.role, name: co?.name || ''})); } catch {}
  company = {id: cid, name: co?.name || '', role: member.role};
  storeKey = KEY + ':co:' + cid;
  localStorage.removeItem(storeKey); // versi lama menyimpan salinan tanpa enkripsi di sini
  await companyWatch();
  unwatch.push(Cloud.watchMember(cid, m => { if (!m?.active || m.role !== company.role) location.reload(); }));
  let data = companyData();
  if (bucketsFromCache && !data.accounts.length) {
    // Offline dan data perusahaan belum pernah tersimpan di perangkat ini. Membuka data kosong berisiko menimpa
    // akun kas di server saat kembali online, jadi aplikasi menunggu koneksi.
    unwatch.forEach(f => f()); unwatch = []; company = null; remote = new Map(); remoteReady = {buckets: false, hrdata: false};
    return 'offline-kosong';
  }
  setSync(!navigator.onLine ? 'Offline: memakai salinan di perangkat. Perubahan dikirim otomatis saat online.' : 'Tersinkron dengan server perusahaan');
  // Perusahaan masih kosong: pimpinan mengisinya dari data pribadi di server, yang tidak pernah dihapus
  if (member.role === 'owner' && !data.accounts.length) { data = await personalData(); companyFresh = true; }
  start(data);
  return true;
}
async function personalData() {
  let r = null; try { r = await Cloud.pull(); } catch {}
  if (!r?.payload) return defaultState();
  let d = JSON.parse(r.payload);
  while (isEnvelope(d)) {
    const pw = await askPassword({title: 'Kata sandi data pribadi', hint: 'Data pribadi Anda terenkripsi. Masukkan kata sandinya agar bisa disalin ke perusahaan.'});
    if (pw === null) return defaultState();
    try { d = await unseal(await deriveKey(pw, fromB64(d.salt), envIter(d)), d); } catch { toast('Kata sandi salah'); }
  }
  return d;
}
function applyRole() {
  const role = company?.role || 'owner', views = ROLE_VIEWS[role];
  document.body.dataset.role = role;
  document.querySelectorAll('nav button').forEach(b => { b.hidden = !!views && !views.includes(b.dataset.view); });
  document.querySelectorAll('#view-pengaturan .card').forEach((c, i) => { c.hidden = i > 0 && !['owner', 'finance'].includes(role); });
  $('btnWipe').hidden = role !== 'owner';
  $('btnGoUnggah').hidden = role === 'viewer';
  // Laporan yang tampil mengikuti peran
  const reports = REPORT_ROLES[role];
  if (reports) {
    [...$('rType').options].forEach(o => { if (!reports.includes(o.value)) o.remove(); });
    [...$('rType').querySelectorAll('optgroup')].forEach(g => { if (!g.children.length) g.remove(); });
  }
  showView(currentView);
  if (views && !views.includes(currentView)) showView('dashboard');
}
const canApprove = () => ['owner', 'finance'].includes(company?.role || 'owner');
const whoAmI = () => cloudInfo?.username ? '@' + cloudInfo.username : 'Pimpinan';
function companyBoxHTML() {
  if (!company) return `<div class="notice" style="margin-bottom:10px"><b>Perusahaan bersama:</b> belum aktif. Buat perusahaan agar karyawan bisa masuk dengan akun masing-masing, atau gabung dengan kode undangan.
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn sm primary" data-act="createCompany">Buat perusahaan</button><button class="btn sm" data-act="joinCompany">Gabung dengan kode</button></div></div>`;
  const owner = company.role === 'owner';
  return `<div class="notice ok" style="margin-bottom:10px"><b>${esc(company.name)}</b> · peran Anda: ${esc(ROLES[company.role] || company.role)}
    <div id="memberBox" class="muted" style="margin-top:6px">${owner ? '<button class="btn sm" data-act="loadMembers">Kelola anggota</button>' : ''}${!owner ? '<button class="btn sm danger" data-act="leaveCompany">Keluar dari perusahaan</button>' : ''}</div></div>`;
}
Object.assign(ACTIONS, {
  createCompany: async () => {
    const name = prompt('Nama perusahaan:', state.company.name); if (!name?.trim()) return;
    if (!confirm('Seluruh data di akun ini akan disalin ke perusahaan bersama. Anggota dapat melihat data sesuai perannya, dan kata sandi enkripsi perangkat tidak dipakai lagi untuk data ini. Salinan pribadi tetap tersimpan. Lanjutkan?')) return;
    try {
      await saving; if (dirty) await pushNow();
      await Cloud.createCompany(name.trim().slice(0, 120), cloudInfo?.username || '');
      toast('Perusahaan dibuat. Memuat ulang…'); setTimeout(() => location.reload(), 1000); // data disalin saat aplikasi terbuka kembali
    } catch (e) { toast(e?.code === 'permission-denied' ? 'Ditolak server: aturan Firestore terbaru belum dipasang.' : 'Gagal membuat perusahaan: ' + (e?.code || e?.message)); }
  },
  joinCompany: async () => {
    const code = prompt('Masukkan kode undangan:'); if (!code?.trim()) return;
    try { await Cloud.joinCompany(code.trim().toLowerCase(), cloudInfo?.username || ''); location.reload(); }
    catch (e) { toast(e?.code === 'invite-invalid' ? 'Kode undangan tidak berlaku.' : 'Gagal bergabung: ' + (e?.code || e?.message)); }
  },
  leaveCompany: async () => { if (confirm('Keluar dari perusahaan ini?')) { await Cloud.leaveCompany(company.id); localStorage.removeItem(storeKey); location.reload(); } },
  loadMembers: async () => {
    const ms = await Cloud.listMembers(company.id);
    const opts = cur => Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
    $('memberBox').innerHTML = `<table><tbody>${ms.map(m => `<tr><td>@${esc(m.name)}</td><td>${m.role === 'owner' ? 'Pimpinan' : `<select data-member="${esc(m.uid)}" aria-label="Peran">${opts(m.role)}</select>`}</td>
      <td class="num">${m.role === 'owner' ? '' : `<button class="btn sm danger" data-act="removeMember" data-id="${esc(m.uid)}">Keluarkan</button>`}</td></tr>`).join('')}</tbody></table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><select id="invRole" aria-label="Peran undangan">${opts('sales')}</select><button class="btn sm primary" data-act="makeInvite">Buat kode undangan</button></div><div id="invOut"></div>`;
  },
  makeInvite: async () => {
    const code = await Cloud.createInvite(company.id, $('invRole').value);
    $('invOut').innerHTML = `<p>Kode (berlaku 7 hari, sekali pakai): <b style="user-select:all">${esc(code)}</b></p>`;
  },
  removeMember: async id => { if (confirm('Keluarkan anggota ini?')) { await Cloud.removeMember(company.id, id); ACTIONS.loadMembers(); } },
});
document.addEventListener('change', async e => {
  const uid = e.target.dataset?.member; if (!uid) return;
  await Cloud.setMember(company.id, uid, {role: e.target.value}); toast('Peran diperbarui');
});

/* ---------- Halaman ERP ---------- */
const ERP_TABS = {customers: ['Pelanggan', ['sales']], quote: ['Penawaran', ['sales']], so: ['Pesanan jual', ['sales']], pr: ['Permintaan beli', ['warehouse']], po: ['PO', ['warehouse']],
  wh: ['Gudang', ['warehouse']], assets: ['Aset', []], journals: ['Jurnal', []], budgets: ['Anggaran', []], centers: ['Pusat biaya', []]};
let erpTab = 'customers', ordEditing = null, ordKind = 'quote', ordLines = [], formKey = '', formRec = null;
const erpTabs = () => { const r = company?.role || 'owner'; return Object.entries(ERP_TABS).filter(([, v]) => ['owner', 'finance'].includes(r) || v[1].includes(r)); };
const custOf = id => state.customers.find(c => c.id === id);
const partyName = o => (ORDER_KINDS[o.kind].side === 'sale' ? custOf(o.partyId) : vendorOf(o.partyId))?.name || '—';
function orderRemain(o) {
  const done = new Map();
  for (const t of state.trades) if (t.srcId === o.id) for (const l of t.lines) done.set(l.itemId, (done.get(l.itemId) || 0) + l.qty);
  return o.lines.map(l => { const d = done.get(l.itemId) || 0, take = Math.min(d, l.qty); done.set(l.itemId, d - take); return {...l, qty: Math.round((l.qty - take) * 1000) / 1000}; }).filter(l => l.qty > 0);
}
const orderTotal = o => Math.round(o.lines.reduce((s, l) => s + l.qty * l.price, 0));
const orderNext = o => state.orders.some(x => x.fromId === o.id && x.status !== 'cancelled');
function orderBadge(o) {
  if (o.status === 'cancelled') return ['Dibatalkan', 'out'];
  const k = ORDER_KINDS[o.kind];
  if (k.invoice && o.status === 'approved' && !orderRemain(o).length) return ['Selesai', 'in'];
  if (k.next && orderNext(o)) return ['Dilanjutkan', 'in'];
  return ORDER_STATUS[o.status];
}
function renderErp() {
  const tabs = erpTabs(); if (!tabs.some(([k]) => k === erpTab) && tabs[0]) erpTab = tabs[0][0];
  $('erpTabs').innerHTML = tabs.map(([k, v]) => `<button type="button" data-act="erpTab" data-id="${k}" class="${k === erpTab ? 'on' : ''}" aria-pressed="${k === erpTab}">${esc(v[0])}</button>`).join('');
  const box = $('erpBody'), table = (head, rows, empty) => `<div class="table-wrap"><table class="rtable"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}<th class="no-print"></th></tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length + 1}" class="empty" data-label="">${empty}</td></tr>`}</tbody></table></div>`;
  const td = (l, v, c = '') => `<td data-label="${l}" class="${c}">${v}</td>`, open = (act, id, t = 'Buka') => `<td data-label="" class="no-print num"><button class="btn sm" data-act="${act}" data-id="${esc(id)}">${t}</button></td>`;
  const add = (label, key) => `<div class="toolbar"><button class="btn primary" data-act="${key}">${label}</button></div>`;
  if (renderErpMore(box, table, td, open, add)) return;
  if (ORDER_KINDS[erpTab]) {
    const k = ORDER_KINDS[erpTab], rows = sorted(state.orders.filter(o => o.kind === erpTab));
    box.innerHTML = add('+ ' + k.label, 'newOrder') + table(['Tanggal', 'No.', 'Pihak', 'Nilai', 'Status'], rows.map(o => { const b = orderBadge(o); return `<tr>${td('Tanggal', fmtDate(o.date))}${td('No.', esc(o.ref))}${td('Pihak', esc(partyName(o)))}${td('Nilai', rp(orderTotal(o)), 'num')}${td('Status', `<span class="badge ${b[1]}">${b[0]}</span>`)}${open('openOrder', o.id)}</tr>`; }), 'Belum ada dokumen.');
  } else if (erpTab === 'customers') {
    box.innerHTML = add('+ Pelanggan', 'formNew') + table(['Nama', 'Kontak', 'Piutang'], state.customers.slice().sort((a, b) => a.name.localeCompare(b.name)).map(c => {
      const open_ = state.debts.filter(d => d.kind === 'piutang' && d.party === c.name).reduce((s, d) => s + Math.max(0, remainOf(d)), 0);
      return `<tr>${td('Nama', `<b>${esc(c.name)}</b>${c.wapu ? ' <span class="badge warn">WAPU</span>' : ''}`)}${td('Kontak', esc([c.pic, c.phone].filter(Boolean).join(' · ')))}${td('Piutang', rp(open_), 'num')}${open('formEdit', c.id, 'Ubah')}</tr>`; }), 'Belum ada pelanggan.');
  } else if (erpTab === 'wh') {
    const st = whStock(), names = [{id: '', name: 'Gudang utama'}, ...state.warehouses];
    const rows = state.items.filter(i => i.kind === 'barang').map(i => `<tr>${td('Barang', esc(i.name))}${names.map(w => td(esc(w.name), fmtQty(st.get(w.id)?.get(i.id) || 0), 'num')).join('')}<td class="no-print"></td></tr>`);
    box.innerHTML = `<div class="toolbar"><button class="btn primary" data-act="formNew">+ Gudang</button> <button class="btn" data-act="newTransfer">Pindah stok</button></div>` + table(['Barang', ...names.map(w => esc(w.name))], rows, 'Belum ada barang.')
      + `<h3 style="font-size:14px;margin:16px 0 8px">Daftar gudang</h3>` + table(['Nama', 'Alamat'], state.warehouses.map(w => `<tr>${td('Nama', esc(w.name))}${td('Alamat', esc(w.address))}${open('formEdit', w.id, 'Ubah')}</tr>`), 'Baru ada gudang utama.')
      + `<h3 style="font-size:14px;margin:16px 0 8px">Riwayat pindah stok</h3>` + table(['Tanggal', 'No.', 'Barang', 'Jumlah', 'Rute'], sorted(state.transfers).map(t => `<tr>${td('Tanggal', fmtDate(t.date))}${td('No.', esc(t.ref))}${td('Barang', esc(itemOf(t.itemId)?.name))}${td('Jumlah', fmtQty(t.qty), 'num')}${td('Rute', esc(whName(t.fromId) + ' → ' + whName(t.toId)))}${open('delTransfer', t.id, 'Hapus')}</tr>`), 'Belum ada.');
  } else if (erpTab === 'assets') {
    const upTo = lastDayOf(addMonths(today().slice(0, 7), -1));
    box.innerHTML = add('+ Aset', 'formNew') + table(['Aset', 'Tanggal', 'Harga perolehan', 'Akum. susut', 'Nilai buku'], state.assets.map(a => { const d = depTo(a, upTo); return `<tr>${td('Aset', `<b>${esc(a.name)}</b>`)}${td('Tanggal', fmtDate(a.date))}${td('Harga perolehan', rp(a.cost), 'num')}${td('Akum. susut', rp(d), 'num')}${td('Nilai buku', rp(a.cost - d), 'num')}${open('formEdit', a.id, 'Ubah')}</tr>`; }), 'Belum ada aset tetap.');
  } else if (erpTab === 'journals') {
    box.innerHTML = add('+ Jurnal', 'formNew') + table(['Tanggal', 'No.', 'Debit', 'Kredit', 'Jumlah'], sorted(state.journals).map(j => `<tr>${td('Tanggal', fmtDate(j.date))}${td('No.', esc(j.ref))}${td('Debit', accHTML(j.dr))}${td('Kredit', accHTML(j.cr))}${td('Jumlah', rp(j.amount), 'num')}${open('formEdit', j.id, 'Ubah')}</tr>`), 'Belum ada jurnal manual.');
  } else if (erpTab === 'budgets') {
    box.innerHTML = add('+ Anggaran', 'formNew') + table(['Tahun', 'Kategori', 'Anggaran', 'Realisasi'], state.budgets.map(b => `<tr>${td('Tahun', esc(b.year))}${td('Kategori', catLabel(b.categoryId))}${td('Anggaran', rp(b.amount), 'num')}${td('Realisasi', rp(actualOf(b)), 'num')}${open('formEdit', b.id, 'Ubah')}</tr>`), 'Belum ada anggaran.');
  } else {
    box.innerHTML = add('+ Pusat biaya', 'formNew') + table(['Kode', 'Nama'], state.centers.map(c => `<tr>${td('Kode', esc(c.code))}${td('Nama', esc(c.name))}${open('formEdit', c.id, 'Ubah')}</tr>`), 'Belum ada cabang atau proyek.');
  }
}

/* Formulir umum untuk data induk */
const money = (k, label) => ({k, label, type: 'money'}), text = (k, label, req) => ({k, label, type: 'text', req}), date_ = (k, label) => ({k, label, type: 'date', req: true});
const chartList = () => {
  const skip = new Set(['1-201', '2-101', ACC_PERSEDIAAN.code, ...state.accounts.map(a => a.code)]), m = new Map();
  for (const c of state.categories) if (!skip.has(c.code)) m.set(c.code, c.name);
  for (const a of [ACC_DEP, ACC_AKUM, ACC_OPENING, ACC_PPN_IN, ACC_KREDIT_PPH, ACC_SELISIH]) if (!m.has(a.code)) m.set(a.code, a.name);
  return [...m.entries()].sort().map(([code, name]) => ({id: code, name: code + ' · ' + name}));
};
const FORMS = {
  customers: {col: 'customers', title: 'Pelanggan', fields: [text('name', 'Nama', true), text('pic', 'Kontak (PIC)'), text('phone', 'Telepon'), text('email', 'Email'), text('npwp', 'NPWP'), {k: 'terms', label: 'Tempo (hari)', type: 'int'}, money('limit', 'Batas kredit (Rp, 0 = tanpa batas)'), {k: 'disc', label: 'Diskon harga pelanggan (%)', type: 'qty'}, {k: 'address', label: 'Alamat', type: 'area'}, {k: 'wapu', label: 'Pelanggan WAPU', type: 'check'}]},
  wh: {col: 'warehouses', title: 'Gudang', fields: [text('name', 'Nama gudang', true), {k: 'address', label: 'Alamat', type: 'area'}],
    used: r => state.trades.some(t => t.whId === r.id) || state.transfers.some(t => t.fromId === r.id || t.toId === r.id)},
  centers: {col: 'centers', title: 'Pusat biaya', fields: [text('code', 'Kode'), text('name', 'Nama cabang/proyek', true)], used: r => state.tx.some(t => t.centerId === r.id)},
  assets: {col: 'assets', title: 'Aset tetap', dated: true, fields: [text('name', 'Nama aset', true), text('code', 'Kode'), date_('date', 'Tanggal perolehan'), money('cost', 'Harga perolehan (Rp)'),
    {k: 'group', label: 'Kelompok masa manfaat', type: 'select', opts: () => Object.entries(ASSET_GROUPS).map(([id, v]) => ({id, name: v[0]}))}, {k: 'life', label: 'Masa manfaat (bulan), untuk kelompok Lainnya', type: 'int'}, money('residual', 'Nilai sisa (Rp)'),
    {k: 'opening', label: 'Aset lama (belum tercatat lewat Transaksi kategori aset)', type: 'check'}],
    prep: d => { const g = ASSET_GROUPS[d.group]; if (g?.[1]) d.life = g[1]; return d.cost > 0 && d.life > 0 && d.residual < d.cost ? '' : 'Isi harga, masa manfaat, dan nilai sisa yang wajar'; }},
  journals: {col: 'journals', title: 'Jurnal manual', dated: true, fields: [date_('date', 'Tanggal'), text('ref', 'No. bukti', true), {k: 'drCode', label: 'Akun debit', type: 'select', opts: chartList}, {k: 'crCode', label: 'Akun kredit', type: 'select', opts: chartList}, money('amount', 'Jumlah (Rp)'), {k: 'desc', label: 'Uraian', type: 'area'}],
    load: r => ({...r, drCode: r.dr?.code, crCode: r.cr?.code}),
    prep: d => { const name = c => chartList().find(x => x.id === c)?.name.split(' · ')[1] || c; if (d.drCode === d.crCode) return 'Akun debit dan kredit harus berbeda'; if (!(d.amount > 0)) return 'Isi jumlah'; d.dr = {code: d.drCode, name: name(d.drCode)}; d.cr = {code: d.crCode, name: name(d.crCode)}; delete d.drCode; delete d.crCode; return ''; }},
  budgets: {col: 'budgets', title: 'Anggaran tahunan', fields: [{k: 'year', label: 'Tahun', type: 'text', req: true}, {k: 'categoryId', label: 'Kategori', type: 'select', opts: () => state.categories.filter(c => c.lr !== false)}, money('amount', 'Anggaran (Rp)')],
    prep: d => /^\d{4}$/.test(d.year) ? '' : 'Tahun harus 4 angka'},
  transfers: {col: 'transfers', title: 'Pindah stok', dated: true, fields: [date_('date', 'Tanggal'), text('ref', 'No. bukti', true), {k: 'itemId', label: 'Barang', type: 'select', opts: () => state.items.filter(i => i.kind === 'barang')},
    {k: 'fromId', label: 'Dari gudang', type: 'select', opts: () => [{id: '', name: 'Gudang utama'}, ...state.warehouses]}, {k: 'toId', label: 'Ke gudang', type: 'select', opts: () => [{id: '', name: 'Gudang utama'}, ...state.warehouses]}, {k: 'qty', label: 'Jumlah', type: 'qty'}, {k: 'desc', label: 'Keterangan', type: 'area'}],
    prep: d => { if (d.fromId === d.toId) return 'Gudang asal dan tujuan harus berbeda'; if (!(d.qty > 0)) return 'Isi jumlah'; return d.qty > (whStock().get(d.fromId)?.get(d.itemId) || 0) + 1e-9 ? 'Stok di gudang asal tidak cukup' : ''; }},
  leaves: {col: 'leaves', title: 'Cuti / izin', dated: true, fields: [{k: 'empId', label: 'Karyawan', type: 'select', opts: () => state.employees}, {k: 'type', label: 'Jenis', type: 'select', opts: () => Object.entries(LEAVE_TYPES).map(([id, name]) => ({id, name}))}, date_('date', 'Mulai'), date_('to', 'Sampai'), {k: 'note', label: 'Keterangan', type: 'area'}],
    prep: d => { if (d.to < d.date) return 'Tanggal selesai tidak boleh sebelum mulai'; d.days = workDaysBetween(d.date, d.to); d.status ||= 'draft'; return ''; }},
  kasbons: {col: 'kasbons', title: 'Kasbon', dated: true, fields: [{k: 'empId', label: 'Karyawan', type: 'select', opts: () => state.employees}, date_('date', 'Tanggal'), text('ref', 'No. bukti', true), money('amount', 'Jumlah (Rp)'), {k: 'accountId', label: 'Dibayar dari akun', type: 'select', opts: () => state.accounts}, {k: 'note', label: 'Keterangan', type: 'area'}],
    prep: d => d.amount > 0 ? '' : 'Isi jumlah',
    after: k => { const t = state.tx.find(x => x.kasbonId === k.id), data = {type: 'out', date: k.date, ref: k.ref, amount: k.amount, accountId: k.accountId, categoryId: sysCat(ACC_KASBON.code)?.id, toAccountId: null, desc: `Kasbon ${k.ref}`, kasbonId: k.id}; if (t) Object.assign(t, data); else state.tx.push({id: uid(), created: Date.now(), ...data}); },
    gone: k => { state.tx = state.tx.filter(x => x.kasbonId !== k.id); }},
};
const formKeyOf = () => ({wh: 'wh', customers: 'customers', centers: 'centers', assets: 'assets', journals: 'journals', budgets: 'budgets', contacts: 'contacts', salespeople: 'salespeople', batches: 'batches', recurring: 'recurring'}[erpTab]);
function openForm(key, id) {
  formKey = key; const f = FORMS[key];
  formRec = id ? state[f.col].find(x => x.id === id) : null;
  const v = formRec ? (f.load ? f.load(formRec) : formRec) : {date: today(), to: today(), year: today().slice(0, 4), active: true};
  const locked = f.dated && formRec && isLocked(formRec.date);
  $('efTitle').textContent = (formRec ? 'Ubah ' : 'Tambah ') + f.title;
  $('efFields').innerHTML = f.fields.map(x => {
    const val = v[x.k] ?? '', id_ = 'ef-' + x.k;
    if (x.type === 'check') return `<label class="check wide"><input type="checkbox" id="${id_}"${val ? ' checked' : ''}>${esc(x.label)}</label>`;
    if (x.type === 'area') return `<label class="f wide">${esc(x.label)}<textarea id="${id_}" rows="2" maxlength="300">${esc(val)}</textarea></label>`;
    if (x.type === 'select') return `<label class="f">${esc(x.label)}<select id="${id_}">${x.opts().map(o => `<option value="${esc(o.id)}"${String(o.id) === String(val) ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`;
    const shown = x.type === 'money' ? (val ? Number(val).toLocaleString('id-ID') : '') : val;
    return `<label class="f">${esc(x.label)}<input id="${id_}" type="${x.type === 'date' ? 'date' : 'text'}" inputmode="${x.type === 'text' || x.type === 'date' ? 'text' : 'decimal'}" value="${esc(shown)}"${x.type === 'money' ? ' data-money="1"' : ''}></label>`;
  }).join('');
  $('efForm').querySelectorAll('.bd input, .bd select, .bd textarea').forEach(x => x.disabled = !!locked);
  $('efNote').textContent = locked ? lockMsg() : '';
  $('btnEfSave').style.display = locked ? 'none' : '';
  $('btnEfDel').style.display = formRec && !locked ? '' : 'none';
  $('efDialog').showModal();
}
$('efFields').addEventListener('input', e => { if (e.target.dataset.money) { const n = parseMoney(e.target.value); e.target.value = n ? n.toLocaleString('id-ID') : ''; } });
$('btnEfCancel').onclick = () => $('efDialog').close();
$('efForm').onsubmit = e => {
  const fail = m => { e.preventDefault(); toast(m); }, f = FORMS[formKey], d = {};
  for (const x of f.fields) {
    const el = $('ef-' + x.k);
    d[x.k] = x.type === 'check' ? el.checked : x.type === 'money' ? parseMoney(el.value) : x.type === 'int' ? Math.abs(parseInt(el.value) || 0) : x.type === 'qty' ? parseQty(el.value) : el.value.trim();
    if ((x.req || (x.type === 'date' && !x.opt)) && !d[x.k]) return fail('Isi ' + x.label.toLowerCase());
    if (x.type === 'date' && d[x.k] && !cleanDate(d[x.k])) return fail('Tanggal tidak valid');
  }
  if (f.dated && (isLocked(d.date) || (formRec && isLocked(formRec.date)))) return fail(lockMsg());
  if (formRec && f.prep === FORMS.transfers.prep) d.qty ||= formRec.qty;
  const err = f.prep?.(d); if (err) return fail(err);
  if (d.ref && state[f.col].some(x => x !== formRec && x.ref === d.ref)) return fail(`No. bukti ${d.ref} sudah dipakai`);
  if (formRec) { Object.assign(formRec, d); log('ubah', f.col, formRec.id, d.name || d.ref || d.date || f.title); }
  else { formRec = {id: uid(), created: Date.now(), ...d}; state[f.col].push(formRec); log('tambah', f.col, formRec.id, d.name || d.ref || d.date || f.title); }
  f.after?.(formRec);
  save(); toast('Tersimpan');
};
$('btnEfDel').onclick = () => {
  const f = FORMS[formKey], r = formRec; if (!r) return;
  if (f.dated && isLocked(r.date)) return toast(lockMsg());
  if (f.used?.(r)) return toast('Data ini sudah dipakai, tidak bisa dihapus');
  const reason = askReason('menghapus ' + f.title.toLowerCase()); if (!reason) return;
  log('hapus', f.col, r.id, `${r.name || r.ref || r.date} · alasan: ${reason}`);
  f.gone?.(r);
  state[f.col] = state[f.col].filter(x => x !== r);
  $('efDialog').close(); save(); toast('Dihapus (tercatat di jejak audit)');
};

/* Dokumen penawaran, pesanan, permintaan, dan PO */
const refOrder = (kind, date) => nextCode(ORDER_KINDS[kind].prefix, date, state.orders.map(o => o.ref));
function renderOrdLines() {
  const opts = state.items.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  $('oLines').innerHTML = ordLines.map((l, n) => `<div class="tline" data-n="${n}"><select class="tl-item" aria-label="Barang"><option value="">Pilih…</option>${opts}</select>
    <input class="tl-qty" inputmode="decimal" aria-label="Jumlah" placeholder="Jumlah" value="${l.qty ? String(l.qty).replace('.', ',') : ''}"><input class="tl-price" inputmode="numeric" aria-label="Harga" placeholder="Harga" value="${l.price ? l.price.toLocaleString('id-ID') : ''}">
    <button type="button" class="btn sm danger" data-act="delOrdLine" data-id="${n}" aria-label="Hapus baris">✕</button></div>`).join('');
  $('oLines').querySelectorAll('.tline').forEach((r, n) => { r.querySelector('.tl-item').value = ordLines[n].itemId || ''; });
  $('oTotal').innerHTML = `Total <b>${rp(ordLines.reduce((s, l) => s + l.qty * l.price, 0))}</b>`;
}
$('oLines').addEventListener('input', e => {
  const row = e.target.closest('.tline'); if (!row) return;
  const l = ordLines[+row.dataset.n];
  if (e.target.classList.contains('tl-item')) { l.itemId = e.target.value; if (!l.price) { l.price = itemOf(l.itemId)?.price || 0; row.querySelector('.tl-price').value = l.price ? l.price.toLocaleString('id-ID') : ''; } }
  else if (e.target.classList.contains('tl-qty')) l.qty = parseQty(e.target.value);
  else { l.price = parseMoney(e.target.value); e.target.value = l.price ? l.price.toLocaleString('id-ID') : ''; }
  $('oTotal').innerHTML = `Total <b>${rp(ordLines.reduce((s, x) => s + x.qty * x.price, 0))}</b>`;
});
$('btnOAddLine').onclick = () => { ordLines.push({itemId: '', qty: 1, price: 0}); renderOrdLines(); };
function openOrder(id, seed) {
  ordEditing = id ? state.orders.find(o => o.id === id) : null;
  const o = ordEditing || seed || {kind: erpTab, date: today(), status: 'draft', lines: []}, k = ORDER_KINDS[o.kind];
  ordKind = o.kind; ordLines = o.lines.length ? o.lines.map(l => ({...l})) : [{itemId: '', qty: 1, price: 0}];
  $('oTitle').textContent = k.label + (ordEditing ? ' ' + o.ref : ' baru');
  $('oDate').value = o.date; $('oDue').value = o.due || ''; $('oNote').value = o.note || '';
  $('oRef').value = o.ref || refOrder(o.kind, o.date);
  $('oPartyLabel').textContent = k.side === 'sale' ? 'Pelanggan' : 'Vendor';
  fillSelect($('oParty'), k.side === 'sale' ? state.customers : state.vendors, 'Pilih…', x => x.name);
  $('oParty').value = o.partyId || '';
  const fixed = ordEditing && (o.status !== 'draft' || isLocked(o.date));
  $('oForm').querySelectorAll('.bd input, .bd select, .bd textarea, .bd button').forEach(x => x.disabled = !!fixed);
  renderOrdLines();
  $('oForm').querySelectorAll('#oLines input, #oLines select, #oLines button').forEach(x => x.disabled = !!fixed);
  const st = ordEditing && o.status;
  $('btnOSave').style.display = fixed ? 'none' : '';
  $('btnOApprove').style.display = st === 'draft' && (!k.approval || canApprove()) ? '' : 'none';
  $('btnOApprove').textContent = k.approval ? 'Setujui' : 'Konfirmasi';
  $('btnONext').style.display = st === 'approved' && k.next && !orderNext(o) ? '' : 'none'; $('btnONext').textContent = k.nextLabel || '';
  const rem = st === 'approved' && k.invoice ? orderRemain(o) : [];
  $('btnOInv').style.display = rem.length ? '' : 'none'; $('btnOInv').textContent = k.side === 'sale' ? 'Buat invoice' : 'Terima barang';
  $('btnODeliv').style.display = st === 'approved' && o.kind === 'so' ? '' : 'none';
  $('btnOPrint').style.display = ordEditing ? '' : 'none';
  $('btnOCancel').style.display = st && st !== 'cancelled' && !state.trades.some(t => t.srcId === o.id) && !orderNext(o) ? '' : 'none';
  $('oDialog').showModal();
}
$('btnOClose').onclick = () => $('oDialog').close();
$('oDate').onchange = () => { if (!ordEditing) $('oRef').value = refOrder(ordKind, $('oDate').value || today()); };
$('oForm').onsubmit = e => {
  const fail = m => { e.preventDefault(); toast(m); };
  const date = $('oDate').value, ref = $('oRef').value.trim().slice(0, 40), lines = ordLines.filter(l => l.itemId && l.qty > 0).map(l => ({...l}));
  if (!cleanDate(date)) return fail('Isi tanggal');
  if (isLocked(date)) return fail(lockMsg());
  if (!ref) return fail('No. dokumen wajib diisi');
  if (state.orders.some(o => o !== ordEditing && o.ref === ref)) return fail(`No. ${ref} sudah dipakai`);
  if (!lines.length) return fail('Tambahkan minimal satu barang');
  if (!$('oParty').value && ordKind !== 'pr') return fail('Pilih ' + $('oPartyLabel').textContent.toLowerCase());
  const data = {kind: ordKind, date, ref, lines, partyId: $('oParty').value || null, due: $('oDue').value, note: $('oNote').value.trim().slice(0, 500)};
  if (ordEditing) { Object.assign(ordEditing, data); log('ubah', 'dokumen', ordEditing.id, `${ref} · ${rp(orderTotal(ordEditing))}`); }
  else { const o = {id: uid(), created: Date.now(), status: 'draft', approvedBy: '', fromId: orderSeedFrom, ...data}; state.orders.push(o); log('tambah', 'dokumen', o.id, `${ref} · ${rp(orderTotal(o))}`); }
  orderSeedFrom = null; save(); toast('Dokumen tersimpan · ' + ref);
};
let orderSeedFrom = null;
$('btnOApprove').onclick = () => { const o = ordEditing; if (!o) return; if (ORDER_KINDS[o.kind].approval && !canApprove()) return toast('Perlu persetujuan pimpinan atau keuangan'); o.status = 'approved'; o.approvedBy = whoAmI(); log('setuju', 'dokumen', o.id, `${o.ref} oleh ${o.approvedBy}`); $('oDialog').close(); save(); };
$('btnOCancel').onclick = () => { const o = ordEditing; if (!o) return; const r = askReason('membatalkan dokumen'); if (!r) return; o.status = 'cancelled'; log('batal', 'dokumen', o.id, `${o.ref} · alasan: ${r}`); $('oDialog').close(); save(); };
$('btnONext').onclick = () => { const o = ordEditing; if (!o) return; const next = ORDER_KINDS[o.kind].next, date = today(); $('oDialog').close(); orderSeedFrom = o.id; erpTab = next; renderErp(); openOrder(null, {kind: next, date, status: 'draft', partyId: o.partyId, note: o.note, lines: o.lines}); };
$('btnOInv').onclick = () => {
  const o = ordEditing; if (!o) return; const sale = ORDER_KINDS[o.kind].side === 'sale', c = custOf(o.partyId); $('oDialog').close();
  tradeSrc = {srcId: o.id, ref: o.ref, lines: orderRemain(o), party: sale ? c?.name : '', addr: c?.address, npwp: c?.npwp, vendorId: sale ? '' : o.partyId};
  goView('jualbeli'); openTrade(null, sale ? 'sale' : 'purchase');
};
function printOrder(o, delivery) {
  const k = ORDER_KINDS[o.kind], c = state.company, p = k.side === 'sale' ? custOf(o.partyId) : vendorOf(o.partyId), lines = delivery ? orderRemain(o).length ? orderRemain(o) : o.lines : o.lines;
  $('printArea').innerHTML = `<div class="inv"><div class="inv-top"><div class="inv-co">${logoHTML(56)}<div><b>${esc(c.name || 'Nama Perusahaan')}</b>${esc(c.address)}</div></div>
    <div class="inv-title"><h1 style="font-size:22px">${delivery ? 'SURAT JALAN' : k.title}</h1><div><b>${esc(o.ref)}</b></div></div></div>
    <div class="inv-meta"><div><div class="inv-lbl">${k.side === 'sale' ? 'Kepada' : 'Vendor'}</div><b>${esc(p?.name || '—')}</b>${p?.address ? '<br>' + esc(p.address) : ''}</div>
    <table class="inv-kv"><tr><td>Tanggal</td><td>${fmtDate(o.date)}</td></tr>${o.due ? `<tr><td>${o.kind === 'quote' ? 'Berlaku s.d.' : 'Tanggal diperlukan'}</td><td>${fmtDate(o.due)}</td></tr>` : ''}${o.approvedBy ? `<tr><td>Disetujui</td><td>${esc(o.approvedBy)}</td></tr>` : ''}</table></div>
    <table class="lines"><thead><tr><th>No</th><th>Deskripsi</th><th class="num">Jumlah</th>${delivery ? '' : '<th class="num">Harga</th><th class="num">Subtotal</th>'}</tr></thead><tbody>
    ${lines.map((l, n) => `<tr><td>${n + 1}</td><td>${esc(itemOf(l.itemId)?.name)}</td><td class="num">${fmtQty(l.qty)} ${esc(itemOf(l.itemId)?.unit)}</td>${delivery ? '' : `<td class="num">${rp(l.price)}</td><td class="num">${rp(l.qty * l.price)}</td>`}</tr>`).join('')}</tbody></table>
    ${delivery ? '' : `<div class="inv-bottom"><div></div><table class="inv-sum"><tr class="grand"><td>Total</td><td>${rp(orderTotal(o))}</td></tr></table></div>`}
    ${o.note ? `<p>${esc(o.note)}</p>` : ''}<div class="sign three"><div>Dibuat<div class="sp"></div>(..............)</div><div>${delivery ? 'Pengirim' : 'Disetujui'}<div class="sp"></div>(..............)</div><div>${delivery ? 'Penerima' : 'Mengetahui'}<div class="sp"></div>(..............)</div></div></div>`;
  document.body.classList.add('print-voucher'); window.print();
}
$('btnOPrint').onclick = () => { if (ordEditing) printOrder(ordEditing); };
$('btnODeliv').onclick = () => { if (ordEditing) printOrder(ordEditing, true); };
['efForm', 'oForm'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input, select')) e.preventDefault(); }));

/* Gudang: jumlah per lokasi; nilai persediaan tetap dihitung untuk seluruh perusahaan */
const whName = id => id ? state.warehouses.find(w => w.id === id)?.name || '(terhapus)' : 'Gudang utama';
function whStock() {
  const m = new Map(), put = (wh, item, q) => { const k = wh || ''; if (!m.has(k)) m.set(k, new Map()); m.get(k).set(item, Math.round(((m.get(k).get(item) || 0) + q) * 1000) / 1000); };
  state.items.forEach(i => { if (i.kind === 'barang') put('', i.id, i.openQty); });
  const stocked = id => itemOf(id)?.kind === 'barang';
  for (const t of state.trades) for (const l of t.lines) if (stocked(l.itemId)) put(t.whId, l.itemId, t.kind === 'purchase' ? l.qty : -l.qty);
  for (const r of state.returns) { const o = state.trades.find(t => t.id === r.origId); for (const l of r.lines) if (stocked(l.itemId)) put(o?.whId, l.itemId, r.kind === 'sale' ? l.qty : -l.qty); }
  for (const a of state.adjusts) for (const l of a.lines) put(a.whId, l.itemId, l.diff);
  for (const t of state.transfers) { put(t.fromId, t.itemId, -t.qty); put(t.toId, t.itemId, t.qty); }
  return m;
}

/* Aset tetap: garis lurus, mulai bulan perolehan */
function depMonths(a, upTo) {
  const m = (+upTo.slice(0, 4) - +a.date.slice(0, 4)) * 12 + +upTo.slice(5, 7) - +a.date.slice(5, 7) + 1;
  return Math.max(0, Math.min(m, a.life));
}
const depAt = (a, n) => Math.round((a.cost - a.residual) * n / (a.life || 1));
const depTo = (a, upTo) => depAt(a, depMonths(a, upTo));
function erpJournal(add) {
  state.assets.forEach(a => { if (a.opening) add('', 'SA', 'Aset ' + a.name, ACC_ASET, ACC_OPENING, a.cost, 'saldo'); });
  state.journals.forEach(j => add(j.date, j.ref, j.desc || 'Jurnal manual', j.dr, j.cr, j.amount, 'manual'));
  const now = today().slice(0, 7), per = new Map();
  for (const a of state.assets) {
    if (!a.life) continue;
    for (let ym = a.date.slice(0, 7), n = 1; ym < now && n <= a.life; ym = addMonths(ym, 1), n++) per.set(ym, (per.get(ym) || 0) + depAt(a, n) - depAt(a, n - 1));
  }
  for (const [ym, v] of per) add(lastDayOf(ym), 'DEP-' + ym.slice(2, 4) + ym.slice(5), 'Penyusutan ' + ymLabel(ym), ACC_DEP, ACC_AKUM, v, 'susut');
}
function actualOf(b) {
  const c = catOf(b.categoryId); if (!c) return 0;
  let v = 0;
  for (const e of M().journal) if (e.date.startsWith(b.year)) { if (e.dr.code === c.code) v += c.type === 'out' ? e.amt : -e.amt; if (e.cr.code === c.code) v += c.type === 'in' ? e.amt : -e.amt; }
  return v;
}

/* SDM lanjutan */
function workDaysBetween(a, b) {
  let n = 0; const six = state.hr.workDays === 6;
  for (let d = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00'); d <= e; d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w !== 0 && (six || w !== 6)) n++; }
  return n;
}
const leaveUsed = (empId, y) => state.leaves.filter(l => l.empId === empId && l.type === 'tahunan' && l.status === 'approved' && l.date.startsWith(y)).reduce((s, l) => s + l.days, 0);
const kasbonLeft = empId => state.kasbons.filter(k => k.empId === empId).reduce((s, k) => s + k.amount, 0) - state.payrolls.reduce((s, p) => s + p.lines.filter(l => l.empId === empId).reduce((x, l) => x + l.deduct, 0), 0);
let attDate = '';
function renderHrExtra() {
  const y = today().slice(0, 4);
  if (hrTab === 'att') {
    attDate ||= today(); $('attDate').value = attDate;
    const rows = state.employees.filter(e => empActive(e, attDate.slice(0, 7))).sort((a, b) => a.name.localeCompare(b.name));
    $('attBody').innerHTML = rows.map(e => { const a = state.attendance.find(x => x.empId === e.id && x.date === attDate); return `<tr><td data-label="Nama"><b>${esc(e.name)}</b></td><td data-label="Kehadiran"><select data-att="${esc(e.id)}" aria-label="Kehadiran"><option value="">Belum diisi</option>${Object.entries(ATT_STATUS).map(([k, v]) => `<option value="${k}"${a?.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td></tr>`; }).join('') || '<tr><td colspan="2" class="empty" data-label="">Belum ada karyawan aktif.</td></tr>';
  } else if (hrTab === 'leave') {
    $('leaveBody').innerHTML = sorted(state.leaves).map(l => { const b = ORDER_STATUS[l.status]; return `<tr><td data-label="Nama"><b>${esc(empOf(l.empId)?.name)}</b></td><td data-label="Jenis">${LEAVE_TYPES[l.type]}</td><td data-label="Tanggal">${fmtDate(l.date)} s.d. ${fmtDate(l.to)}</td><td data-label="Hari" class="num">${l.days}</td><td data-label="Sisa cuti ${y}" class="num">${LEAVE_QUOTA - leaveUsed(l.empId, y)}</td><td data-label="Status"><span class="badge ${b[1]}">${b[0]}</span></td>
      <td data-label="" class="no-print num" style="white-space:nowrap">${l.status === 'draft' ? `<button class="btn sm primary" data-act="approveLeave" data-id="${esc(l.id)}">Setujui</button> ` : ''}<button class="btn sm" data-act="openLeave" data-id="${esc(l.id)}">Ubah</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty" data-label="">Belum ada pengajuan.</td></tr>';
  } else {
    $('kasBody').innerHTML = sorted(state.kasbons).map(k => `<tr><td data-label="Tanggal">${fmtDate(k.date)}</td><td data-label="No.">${esc(k.ref)}</td><td data-label="Nama"><b>${esc(empOf(k.empId)?.name)}</b></td><td data-label="Jumlah" class="num">${rp(k.amount)}</td><td data-label="Sisa kasbon karyawan" class="num">${rp(Math.max(0, kasbonLeft(k.empId)))}</td><td data-label="" class="no-print num"><button class="btn sm" data-act="openKasbon" data-id="${esc(k.id)}">Ubah</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty" data-label="">Belum ada kasbon.</td></tr>';
  }
}
$('attDate').oninput = () => { attDate = cleanDate($('attDate').value) || today(); renderHrExtra(); };
document.addEventListener('change', e => {
  const empId = e.target.dataset?.att; if (!empId) return;
  const id = 'at' + hash(empId + attDate) + shardOf(attDate), cur = state.attendance.find(x => x.empId === empId && x.date === attDate);
  if (!e.target.value) state.attendance = state.attendance.filter(x => x !== cur);
  else if (cur) cur.status = e.target.value;
  else state.attendance.push({id, empId, date: attDate, status: e.target.value});
  log('ubah', 'absensi', id, `Absensi ${attDate}`); // tanpa nama dan status: jejak audit terbaca semua anggota, sedangkan kehadiran dan sakit adalah data SDM
  persist();
});
$('btnNewLeave').onclick = () => { if (!state.employees.length) return toast('Tambahkan data karyawan dulu'); openForm('leaves'); };
$('btnNewKasbon').onclick = () => { if (!state.employees.length) return toast('Tambahkan data karyawan dulu'); openForm('kasbons'); $('ef-ref').value = nextCode('KB', today(), state.kasbons.map(k => k.ref)); };
// Harian lepas: hari kerja diisi dari absensi; kasbon yang tersisa diingatkan
function erpRunPrefill(ym) {
  $('runRows').querySelectorAll('.prow').forEach(row => {
    const id = row.dataset.id, days = state.attendance.filter(a => a.empId === id && a.status === 'hadir' && a.date.startsWith(ym)).length, left = kasbonLeft(id);
    const d = row.querySelector('input[data-k="days"]'); if (d && days) d.value = String(days);
    const k = row.querySelector('input[data-k="deduct"]'); if (k && left > 0) k.placeholder = 'Sisa kasbon ' + left.toLocaleString('id-ID');
  });
}
function erpObligations() {
  const out = [], now = today(), mine = canApprove();
  const wait = state.orders.filter(o => o.status === 'draft' && ORDER_KINDS[o.kind].approval);
  if (wait.length && mine) out.push(['warn', `${wait.length} permintaan/PO menunggu persetujuan: ${wait.slice(0, 4).map(o => esc(o.ref)).join(', ')}.`]);
  const lv = state.leaves.filter(l => l.status === 'draft');
  if (lv.length) out.push(['warn', `${lv.length} pengajuan cuti menunggu persetujuan.`]);
  const old = state.orders.filter(o => o.kind === 'quote' && o.status !== 'cancelled' && o.due && o.due < now && !orderNext(o));
  if (old.length) out.push(['warn', `${old.length} penawaran sudah lewat masa berlaku.`]);
  out.push(...moreObligations());
  return out;
}
function erpReport(type, from, to, period) {
  const asOf = to || today();
  if (type === 'aset') {
    const last = lastDayOf(addMonths(today().slice(0, 7), -1)), end = asOf < last ? asOf : last; let c = 0, d = 0;
    const rows = state.assets.filter(a => a.date <= asOf).map(a => { const x = depTo(a, end); c += a.cost; d += x; return `<tr><td>${esc(a.code)}</td><td>${esc(a.name)}</td><td>${fmtDate(a.date)}</td><td class="num">${a.life}</td><td class="num">${rp(a.cost)}</td><td class="num">${rp(x)}</td><td class="num">${rp(a.cost - x)}</td></tr>`; }).join('');
    return kop('Daftar Aset Tetap', 'Per ' + fmtDate(asOf)) + `<table><thead><tr><th>Kode</th><th>Aset</th><th>Perolehan</th><th class="num">Bulan</th><th class="num">Harga</th><th class="num">Akum. susut</th><th class="num">Nilai buku</th></tr></thead>${rows}<tr class="total"><td colspan="4">Total</td><td class="num">${rp(c)}</td><td class="num">${rp(d)}</td><td class="num">${rp(c - d)}</td></tr></table><p class="muted" style="font-size:12px">Metode garis lurus, mulai bulan perolehan. Penyusutan fiskal dapat berbeda; sesuaikan saat SPT Tahunan.</p>` + signBlock();
  }
  if (type === 'anggaran') {
    const y = asOf.slice(0, 4), list_ = state.budgets.filter(b => b.year === y);
    return kop('Anggaran dan Realisasi', 'Tahun ' + esc(y)) + `<table><thead><tr><th>Kategori</th><th class="num">Anggaran</th><th class="num">Realisasi</th><th class="num">Selisih</th><th class="num">%</th></tr></thead>${list_.map(b => { const a = actualOf(b); return `<tr><td>${catLabel(b.categoryId)}</td><td class="num">${rp(b.amount)}</td><td class="num">${rp(a)}</td><td class="num">${rp(b.amount - a)}</td><td class="num">${b.amount ? pct(a / b.amount * 100) : '—'}</td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Belum ada anggaran tahun ini.</td></tr>'}</table>` + signBlock();
  }
  if (type === 'aruskas') {
    const G = {op: ['Aktivitas operasi', 0, 0], inv: ['Aktivitas investasi', 0, 0], fin: ['Aktivitas pendanaan', 0, 0]};
    const grp = t => { const code = (t.debtId ? '' : catOf(t.categoryId)?.code) || ''; return /^1-4/.test(code) ? 'inv' : /^(3-|2-20)/.test(code) ? 'fin' : 'op'; };
    for (const t of state.tx) if (t.type !== 'transfer' && inRange(t.date, from, to)) G[grp(t)][t.type === 'in' ? 1 : 2] += t.amount;
    const net = Object.values(G).reduce((s, g) => s + g[1] - g[2], 0);
    return kop('Laporan Arus Kas', period) + `<table><thead><tr><th></th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Bersih</th></tr></thead>${Object.values(G).map(g => `<tr><td>${g[0]}</td><td class="num">${rp(g[1])}</td><td class="num">${rp(g[2])}</td><td class="num">${rp(g[1] - g[2])}</td></tr>`).join('')}<tr class="total"><td colspan="3">Kenaikan (penurunan) kas</td><td class="num">${rp(net)}</td></tr></table>` + signBlock();
  }
  if (type === 'pusat') {
    const m = new Map();
    for (const t of state.tx) if (t.type !== 'transfer' && inRange(t.date, from, to)) { const r = m.get(t.centerId || '') || [0, 0]; r[t.type === 'in' ? 0 : 1] += t.amount; m.set(t.centerId || '', r); }
    return kop('Kas per Cabang/Proyek', period) + `<table><thead><tr><th>Pusat biaya</th><th class="num">Masuk</th><th class="num">Keluar</th><th class="num">Bersih</th></tr></thead>${[...m.entries()].map(([id, r]) => `<tr><td>${esc(state.centers.find(c => c.id === id)?.name || 'Tanpa pusat biaya')}</td><td class="num">${rp(r[0])}</td><td class="num">${rp(r[1])}</td><td class="num">${rp(r[0] - r[1])}</td></tr>`).join('')}</table>` + signBlock();
  }
  if (type === 'absensi') {
    return kop('Rekap Kehadiran', period) + `<table><thead><tr><th>Nama</th>${Object.values(ATT_STATUS).map(v => `<th class="num">${v}</th>`).join('')}<th class="num">Cuti terpakai ${esc(asOf.slice(0, 4))}</th></tr></thead>${state.employees.map(e => `<tr><td>${esc(e.name)}</td>${Object.keys(ATT_STATUS).map(k => `<td class="num">${state.attendance.filter(a => a.empId === e.id && a.status === k && inRange(a.date, from, to)).length}</td>`).join('')}<td class="num">${leaveUsed(e.id, asOf.slice(0, 4))}</td></tr>`).join('')}</table>` + signBlock();
  }
  return '';
}
Object.assign(ACTIONS, {
  erpTab: k => { erpTab = k; renderErp(); },
  goDebts: () => goView('hutang'),
  newOrder: () => { orderSeedFrom = null; openOrder(); }, openOrder: id => openOrder(id),
  delOrdLine: n => { ordLines.splice(+n, 1); if (!ordLines.length) ordLines.push({itemId: '', qty: 1, price: 0}); renderOrdLines(); },
  formNew: () => openForm(formKeyOf()), formEdit: id => openForm(formKeyOf(), id),
  newTransfer: () => { if (!state.warehouses.length) return toast('Tambahkan gudang dulu'); openForm('transfers'); $('ef-ref').value = nextCode('MG', today(), state.transfers.map(t => t.ref)); },
  delTransfer: id => { const t = state.transfers.find(x => x.id === id); if (!t) return; if (isLocked(t.date)) return toast(lockMsg()); const r = askReason('menghapus pindah stok'); if (!r) return; log('hapus', 'transfers', id, `${t.ref} · alasan: ${r}`); state.transfers = state.transfers.filter(x => x !== t); save(); },
  openLeave: id => openForm('leaves', id), openKasbon: id => openForm('kasbons', id),
  approveLeave: id => {
    const l = state.leaves.find(x => x.id === id); if (!l) return;
    const y = l.date.slice(0, 4);
    if (l.type === 'tahunan' && leaveUsed(l.empId, y) + l.days > LEAVE_QUOTA && !confirm('Melebihi 12 hari cuti tahunan. Tetap setujui?')) return;
    l.status = 'approved'; l.approvedBy = whoAmI();
    for (let d = new Date(l.date + 'T00:00:00'), e = new Date(l.to + 'T00:00:00'); d <= e; d.setDate(d.getDate() + 1)) {
      const date = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10), cur = state.attendance.find(a => a.empId === l.empId && a.date === date);
      if (cur) cur.status = 'cuti'; else state.attendance.push({id: 'at' + hash(l.empId + date) + shardOf(date), empId: l.empId, date, status: 'cuti'});
    }
    log('setuju', 'cuti', l.id, `${l.date} s.d. ${l.to}`); save();
  },
});

/* Dasbor standar, hanya rekap tanpa tombol kerja. Semua peran memakai susunan yang sama: judul, KPI, perlu tindakan, tren, lalu rincian.
   Isinya mengikuti bidang masing-masing, dengan rumus KPI yang lazim dipakai tiap fungsi. */
const REPORT_ROLES = {sales: ['jual', 'umur', 'komisi'], warehouse: ['stok', 'beli'], hr: ['upah', 'bpjs', 'pph21', 'sdm', 'absensi']};
const longDate = () => new Date().toLocaleDateString('id-ID', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'});
const num1 = n => String(Math.round(n * 10) / 10).replace('.', ',');
const shortRp = n => { const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e9 ? num1(a / 1e9) + ' M' : a >= 1e6 ? num1(a / 1e6) + ' jt' : a >= 1e3 ? Math.round(a / 1e3) + ' rb' : String(Math.round(a))); };
const panel = (title, rows, empty) => `<div class="card"><h3>${title}</h3>${rows.length ? `<table class="dt"><tbody>${rows.join('')}</tbody></table>` : `<div class="muted">${empty}</div>`}</div>`;
const tr = (...c) => `<tr>${c.map((x, i) => `<td${i && i === c.length - 1 ? ' class="num"' : ''}>${x}</td>`).join('')}</tr>`;
const pill = (t, cls) => `<span class="badge ${cls}">${t}</span>`;
const days = (date, n) => { const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate() + n); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const last6 = () => Array.from({length: 6}, (_, i) => addMonths(today().slice(0, 7), i - 5));
const sameDayPrev = () => { const now = today(), ym = addMonths(now.slice(0, 7), -1), end = lastDayOf(ym), d = ym + now.slice(7); return d > end ? end : d; };
function salesIn(from, to) {
  const st = M().stock, list_ = state.trades.filter(t => t.kind === 'sale' && inRange(t.date, from, to)), rets = state.returns.filter(r => r.kind === 'sale' && inRange(r.date, from, to));
  return {n: list_.length, rev: list_.reduce((s, t) => s + tradeTotal(t), 0) - rets.reduce((s, r) => s + r.dpp, 0),
    hpp: list_.reduce((s, t) => s + (st.cogs.get(t.id) || 0), 0) - rets.reduce((s, r) => s + (st.rcost.get(r.id) || 0), 0)};
}
function delta(now, prev) {
  if (!prev) return now ? 'Belum ada pembanding bulan lalu' : '';
  const p = (now - prev) / Math.abs(prev) * 100;
  return `${p >= 0 ? '▲' : '▼'} ${num1(Math.abs(p))}% dari periode sama bulan lalu`;
}
const openOrders = kind => state.orders.filter(o => o.kind === kind && o.status === 'approved' && orderRemain(o).length);
const dueSoon = (kind, n) => state.debts.filter(d => d.kind === kind && remainOf(d) > 0 && d.due && daysBetween(today(), d.due) <= n).sort((a, b) => a.due.localeCompare(b.due));
const debtRow = d => tr(esc(d.party), d.due < today() ? pill(`Telat ${daysBetween(d.due, today())} hari`, 'out') : fmtDate(d.due), rp(remainOf(d)));
function aging(kind) {
  const b = [['Belum jatuh tempo', 0], ['1–30 hari', 0], ['31–60 hari', 0], ['61–90 hari', 0], ['Lebih 90 hari', 0]], now = today();
  for (const d of state.debts) {
    if (d.kind !== kind || remainOf(d) <= 0) continue;
    const n = d.due && d.due < now ? daysBetween(d.due, now) : 0;
    b[n === 0 ? 0 : n <= 30 ? 1 : n <= 60 ? 2 : n <= 90 ? 3 : 4][1] += remainOf(d);
  }
  return b;
}
const meterRows = (rows, fmt = rp) => { const max = Math.max(1, ...rows.map(r => r[1])); return rows.map(([l, v]) => `<tr><td colspan="2"><div class="cat-row"><span>${l}</span><span>${fmt(v)}</span></div><div class="meter"><span class="m1" style="width:${Math.max(0, v / max * 100)}%"></span></div></td></tr>`); };
function trend(title, series, fmt = shortRp) {
  const months = last6(), max = Math.max(1, ...series.flatMap(s => s.vals));
  const legend = series.length > 1 ? `<div class="legend">${series.map((s, i) => `<span><i class="k${i + 1}"></i>${s.name}</span>`).join('')}</div>` : '';
  const now = series.map(s => `${s.name}: <b>${fmt(s.vals[5])}</b>`).join(' · ');
  return `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h3>${title}</h3>${legend}</div>
    <div class="bars" style="height:150px">${months.map((ym, i) => `<div class="bar-group" title="${ymLabel(ym)}: ${series.map(s => `${s.name} ${rp(s.vals[i])}`).join(', ')}"><div class="bar-pair">${series.map((s, k) => `<div class="bar k${k + 1}" style="height:${Math.max(0, s.vals[i]) / max * 100}%"></div>`).join('')}</div><div class="bar-label">${MONTHS[+ym.slice(5) - 1]}</div></div>`).join('')}</div>
    <div class="muted" style="font-size:12px;margin-top:6px">Bulan ini · ${now}</div></div>`;
}
function dashPage({title, sub, alerts = [], kpis, chart, side, panels = []}) {
  const who = `${cloudInfo?.username ? '@' + esc(cloudInfo.username) + ' · ' : ''}${esc(ROLES[company?.role || 'owner'])}`;
  return `<div class="dash-head"><div><h2>${title}</h2><p class="muted">${sub}</p></div><div class="muted dash-who">${who}<br>${esc(longDate())}</div></div>
    <div class="grid cards kpi">${kpis.map(statCard).join('')}</div>
    <div class="card" style="margin-top:16px"><h3>Perlu tindakan</h3>${alerts.length ? alerts.map(([lvl, html]) => `<div class="ob ${lvl}"><span class="dot"></span><div>${html.replace(/<button[^>]*>.*?<\/button>/g, '')}</div></div>`).join('') : '<div class="muted">Tidak ada yang perlu ditindaklanjuti saat ini.</div>'}</div>
    <div class="grid two" style="margin-top:16px">${chart}${side}</div>
    ${panels.length ? `<div class="grid dash-panels">${panels.join('')}</div>` : ''}`;
}

function salesDash() {
  const now = today(), ym = now.slice(0, 7), m = salesIn(ym + '-01', now), p = salesIn(addMonths(ym, -1) + '-01', sameDayPrev());
  const target = state.budgets.filter(b => b.year === now.slice(0, 4) && ['4-101', '4-102'].includes(catOf(b.categoryId)?.code)).reduce((s, b) => s + b.amount, 0) / 12;
  const q90 = state.orders.filter(o => o.kind === 'quote' && o.status !== 'draft' && o.date >= days(now, -90)), won = q90.filter(orderNext).length;
  const so = openOrders('so'), backlog = so.reduce((s, o) => s + orderRemain(o).reduce((x, l) => x + l.qty * l.price, 0), 0);
  const ar = debtTotals('piutang'), rev90 = salesIn(days(now, -90), now).rev, dso = rev90 > 0 ? ar.open / (rev90 / 90) : 0;
  const expiring = state.orders.filter(o => o.kind === 'quote' && o.status !== 'cancelled' && o.due && o.due <= days(now, 7) && !orderNext(o));
  const prod = new Map(), cust = new Map();
  state.trades.forEach(t => {
    if (t.kind !== 'sale' || !t.date.startsWith(ym)) return;
    cust.set(partyOf(t), (cust.get(partyOf(t)) || 0) + tradeTotal(t));
    t.lines.forEach(l => { const r = prod.get(l.itemId) || 0; prod.set(l.itemId, r + l.qty * l.price); });
  });
  const top = map => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const followUp = state.contacts.filter(c => c.next && c.next <= now && !state.contacts.some(x => x.customerId === c.customerId && x.date > c.date));
  const overLimit = state.customers.filter(c => c.limit && custOpen(c.name) > c.limit);
  const alerts = [
    ...(ar.no ? [['bad', `${ar.no} tagihan lewat jatuh tempo senilai <b>${rp(ar.overdue)}</b>. Lakukan penagihan.`]] : []),
    ...(so.length ? [['warn', `${so.length} pesanan belum selesai dikirim atau ditagih, senilai ${rp(backlog)}.`]] : []),
    ...(expiring.length ? [['warn', `${expiring.length} penawaran berakhir dalam 7 hari: ${expiring.slice(0, 3).map(o => esc(o.ref)).join(', ')}. Tindak lanjuti ke pelanggan.`]] : []),
    ...(followUp.length ? [['warn', `${followUp.length} pelanggan perlu ditindaklanjuti hari ini.`]] : []),
    ...(overLimit.length ? [['bad', `Piutang melebihi batas kredit: ${overLimit.slice(0, 3).map(c => esc(c.name)).join(', ')}.`]] : []),
  ];
  return dashPage({title: 'Dasbor Penjualan', sub: 'Pencapaian penjualan, peluang, dan penagihan.', alerts,
    kpis: [[`Penjualan ${MONTHS[+ym.slice(5) - 1]}`, rp(m.rev), '', delta(m.rev, p.rev)], ['Pencapaian target', target ? pct(m.rev / target * 100) : '—', '', target ? `Target ${rp(target)} sebulan` : 'Isi anggaran pendapatan di ERP'],
      ['Nilai rata-rata invoice', rp(m.n ? m.rev / m.n : 0), '', `${m.n} invoice`], ['Konversi penawaran', q90.length ? pct(won / q90.length * 100) : '—', '', `${won} dari ${q90.length} penawaran, 90 hari`],
      ['Pesanan belum selesai', rp(backlog), '', `${so.length} pesanan`], ['Umur piutang rata-rata', rev90 > 0 ? Math.round(dso) + ' hari' : '—', '', `Piutang ${rp(ar.open)}`]],
    chart: trend('Tren penjualan 6 bulan', [{name: 'Penjualan', vals: last6().map(x => salesIn(x + '-01', lastDayOf(x)).rev)}]),
    side: panel('Umur piutang', meterRows(aging('piutang')), ''),
    panels: [panel('Produk terlaris bulan ini', top(prod).map(([id, v]) => tr(esc(itemOf(id)?.name), rp(v))), 'Belum ada penjualan.'), panel('Pelanggan terbesar bulan ini', top(cust).map(([c, v]) => tr(esc(c), rp(v))), 'Belum ada penjualan.'),
      panel('Pesanan perlu diproses', so.slice(0, 6).map(o => tr(esc(o.ref), esc(partyName(o)))), 'Semua pesanan selesai.'), panel('Tagihan perlu diikuti', dueSoon('piutang', 7).slice(0, 6).map(debtRow), 'Tidak ada tagihan mendesak.'),
      panel('Kinerja tenaga penjual', state.salespeople.slice(0, 6).map(s => { const v = salesBy(s.id, ym); return tr(esc(s.name), s.target ? pct(v / s.target * 100) + ' dari target' : '—', rp(v)); }), 'Isi tenaga penjual di ERP.'),
      panel('Tindak lanjut pelanggan', followUp.slice(0, 6).map(c => tr(esc(custOf(c.customerId)?.name), fmtDate(c.next), esc(c.channel))), 'Tidak ada tindak lanjut jatuh tempo.')]});
}

function warehouseDash() {
  const now = today(), st = M().stock.stock, goods = state.items.filter(i => i.kind === 'barang');
  const status = i => { const q = st.get(i.id)?.qty || 0; return q <= 0 ? 0 : i.minQty && q <= i.minQty ? 1 : 2; };
  const out = goods.filter(i => status(i) === 0), low = goods.filter(i => status(i) === 1);
  // Opname: akurasi = barang yang cocok dibanding barang yang dihitung; cakupan = barang yang dihitung 30 hari terakhir
  const lastCount = new Map(); let counted = 0, match = 0, shrink = 0;
  for (const a of state.adjusts) for (const l of a.lines) {
    if ((lastCount.get(l.itemId) || '') < a.date) lastCount.set(l.itemId, a.date);
    if (a.date >= days(now, -90)) { counted++; if (!l.diff) match++; }
  }
  for (const a of state.adjusts) if (a.date.startsWith(now.slice(0, 4))) shrink += Math.min(0, M().stock.adj.get(a.id) || 0);
  const covered = goods.filter(i => (lastCount.get(i.id) || '') >= days(now, -30)).length, uncounted = goods.filter(i => (lastCount.get(i.id) || '') < days(now, -30));
  const yearAgo = days(now, -365), cost = salesIn(yearAgo, now).hpp, value = stockValue(), turn = value > 0 ? cost / value : 0;
  const lastSale = new Map(); state.trades.forEach(t => { if (t.kind === 'sale') t.lines.forEach(l => { if ((lastSale.get(l.itemId) || '') < t.date) lastSale.set(l.itemId, t.date); }); });
  const dead = goods.filter(i => (st.get(i.id)?.qty || 0) > 0 && (lastSale.get(i.id) || '') < days(now, -90));
  const po = openOrders('po'), draft = state.orders.filter(o => ['pr', 'po'].includes(o.kind) && o.status === 'draft');
  const expired = state.batches.filter(b => b.exp && b.exp < now), soon = state.batches.filter(b => b.exp && b.exp >= now && b.exp <= days(now, 60));
  const label = [pill('Habis', 'out'), pill('Menipis', 'warn'), pill('Aman', 'in')];
  const stockRows = goods.slice().sort((a, b) => status(a) - status(b) || a.name.localeCompare(b.name)).slice(0, 8).map(i => tr(esc(i.name), `${fmtQty(st.get(i.id)?.qty || 0)} ${esc(i.unit)}`, label[status(i)]));
  const alerts = [
    ...(out.length ? [['bad', `${out.length} barang habis: ${out.slice(0, 4).map(i => esc(i.name)).join(', ')}.`]] : []),
    ...(low.length ? [['warn', `${low.length} barang di bawah batas minimum: ${low.slice(0, 4).map(i => esc(i.name)).join(', ')}. Ajukan pembelian.`]] : []),
    ...(uncounted.length ? [['warn', `${uncounted.length} barang belum diopname 30 hari terakhir.`]] : []),
    ...(draft.length ? [['warn', `${draft.length} permintaan/PO menunggu persetujuan.`]] : []),
    ...(expired.length ? [['bad', `${expired.length} batch sudah kedaluwarsa.`]] : []),
    ...(soon.length ? [['warn', `${soon.length} batch kedaluwarsa dalam 60 hari.`]] : []),
  ];
  const moved = dir => last6().map(ym => { let q = 0; for (const t of state.trades) if (t.date.startsWith(ym) && t.kind === dir) for (const l of t.lines) if (itemOf(l.itemId)?.kind === 'barang') q += l.qty; return q; });
  return dashPage({title: 'Dasbor Gudang', sub: 'Ketersediaan stok, ketepatan stok opname, dan barang masuk.', alerts,
    kpis: [['Nilai persediaan', rp(value), '', `${goods.length} jenis barang`], ['Stok habis / menipis', `${out.length} / ${low.length}`, out.length ? 'out' : ''], ['Akurasi opname', counted ? pct(match / counted * 100) : '—', '', counted ? `${match} dari ${counted} hitungan cocok, 90 hari` : 'Belum ada opname'],
      ['Cakupan opname', goods.length ? pct(covered / goods.length * 100) : '—', '', `${covered} dari ${goods.length} barang, 30 hari`], ['Selisih opname tahun ini', rp(-shrink), shrink ? 'out' : '', 'Nilai kekurangan barang'], ['Perputaran stok', turn ? num1(turn) + '×' : '—', '', turn ? `Sekitar ${Math.round(365 / turn)} hari tersimpan` : 'HPP 12 bulan ÷ nilai stok']],
    chart: trend('Barang masuk dan keluar 6 bulan', [{name: 'Masuk', vals: moved('purchase')}, {name: 'Keluar', vals: moved('sale')}], fmtQty),
    side: panel('Stok barang', stockRows, 'Belum ada barang.'),
    panels: [panel('Riwayat stok opname', sorted(state.adjusts).slice(0, 6).map(a => tr(fmtDate(a.date), `${a.lines.length} barang, ${a.lines.filter(l => l.diff).length} selisih`, rp(M().stock.adj.get(a.id) || 0))), 'Belum ada stok opname.'),
      panel('Jadwal opname berikutnya', uncounted.sort((a, b) => (lastCount.get(a.id) || '').localeCompare(lastCount.get(b.id) || '')).slice(0, 6).map(i => tr(esc(i.name), lastCount.has(i.id) ? 'Terakhir ' + fmtDate(lastCount.get(i.id)) : 'Belum pernah')), 'Semua barang sudah dihitung 30 hari terakhir.'),
      panel('Stok lambat bergerak', dead.slice(0, 6).map(i => tr(esc(i.name), `${fmtQty(st.get(i.id).qty)} ${esc(i.unit)}`, lastSale.has(i.id) ? fmtDate(lastSale.get(i.id)) : 'Belum terjual')), 'Tidak ada barang tanpa penjualan 90 hari.'),
      panel('Barang akan datang', po.slice(0, 6).map(o => tr(esc(o.ref), esc(partyName(o)))), 'Tidak ada PO terbuka.'),
      panel('Saran pesan ulang', reorderList().slice(0, 6).map(r => tr(esc(r.i.name), `tersedia ${fmtQty(r.have)}, titik ${fmtQty(r.point)}`, `pesan ${fmtQty(r.qty)}`)), 'Stok masih di atas titik pesan ulang.'),
      panel('Segera kedaluwarsa', [...expired, ...soon].slice(0, 6).map(b => tr(esc(itemOf(b.itemId)?.name), esc(b.batch), fmtDate(b.exp))), 'Tidak ada batch mendekati kedaluwarsa.')]});
}

function hrDash() {
  const now = today(), ym = now.slice(0, 7), prev = addMonths(ym, -1), act = state.employees.filter(e => empActive(e, ym)), hr = state.hr;
  const monthAtt = state.attendance.filter(a => a.date.startsWith(ym)), hadir = monthAtt.filter(a => a.status === 'hadir').length, absent = monthAtt.filter(a => ['alpa', 'sakit', 'izin'].includes(a.status)).length;
  const todayAtt = state.attendance.filter(a => a.date === now), wait = state.leaves.filter(l => l.status === 'draft');
  const ending = act.filter(e => e.status === 'pkwt' && e.endDate && daysBetween(now, e.endDate) <= 30).sort((a, b) => a.endDate.localeCompare(b.endDate));
  const exits = state.employees.filter(e => e.exitDate && e.exitDate >= days(now, -365) && e.exitDate <= now).length, turnover = act.length + exits ? exits / (act.length + exits / 2) * 100 : 0;
  const cost = x => state.payrolls.filter(p => p.period === x).reduce((s, p) => { const t = paySum(p); return s + t.net + t.pph + t.ee + t.deduct + t.co; }, 0);
  const paid = state.payrolls.some(p => p.period === prev), under = act.filter(e => belowMin(e) || belowFloor(e));
  const docs = state.empdocs.filter(x => x.exp && x.exp <= days(now, 30)), shiftNow = state.shifts.filter(s => s.date === now);
  const lastScore = act.map(e => [e, sorted(state.reviews.filter(r => r.empId === e.id))[0]]).filter(x => x[1]);
  const alerts = [
    ...(!paid && act.length ? [['bad', `Gaji ${ymLabel(prev)} belum diproses.`]] : []),
    ...(under.length ? [['bad', `${under.length} karyawan bergaji di bawah batas yang diatur.`]] : []),
    ...(ending.length ? [['warn', `${ending.length} kontrak berakhir dalam 30 hari.`]] : []),
    ...(wait.length ? [['warn', `${wait.length} pengajuan cuti menunggu persetujuan.`]] : []),
    ...(act.length > todayAtt.length ? [['warn', `Absensi hari ini belum diisi untuk ${act.length - todayAtt.length} karyawan.`]] : []),
    ...(hr.umpMode === 'wajib' && !hr.ump && act.length ? [['warn', 'Isi nilai UMP/UMK di Karyawan → Aturan.']] : []),
    ...(docs.length ? [['warn', `${docs.length} dokumen karyawan berakhir dalam 30 hari.`]] : []),
  ];
  const n = f => act.filter(f).length;
  return dashPage({title: 'Dasbor SDM', sub: 'Tenaga kerja, kehadiran, kontrak, dan biaya gaji.', alerts,
    kpis: [['Karyawan aktif', String(act.length), '', `${n(e => e.status === 'pkwtt')} tetap · ${n(e => e.status === 'pkwt')} kontrak · ${n(e => e.status === 'harian')} harian`], ['Tingkat kehadiran', monthAtt.length ? pct(hadir / monthAtt.length * 100) : '—', '', 'Bulan ini, dari absensi terisi'],
      ['Tingkat absen', monthAtt.length ? pct(absent / monthAtt.length * 100) : '—', absent ? 'out' : '', 'Sakit, izin, tanpa keterangan'], ['Turnover 12 bulan', pct(turnover), '', `${exits} karyawan keluar`], [`Biaya gaji ${MONTHS[+prev.slice(5) - 1]}`, rp(cost(prev)), '', 'Termasuk BPJS perusahaan'], ['Kontrak berakhir', String(ending.length), ending.length ? 'out' : '', 'Dalam 30 hari']],
    chart: trend('Biaya gaji 6 bulan', [{name: 'Biaya gaji', vals: last6().map(cost)}]),
    side: panel('Komposisi karyawan', meterRows([['Tetap (PKWTT)', n(e => e.status === 'pkwtt')], ['Kontrak (PKWT)', n(e => e.status === 'pkwt')], ['Harian lepas', n(e => e.status === 'harian')], ['Laki-laki', n(e => e.gender === 'L')], ['Perempuan', n(e => e.gender === 'P')]], String), 'Belum ada karyawan.'),
    panels: [panel('Pengajuan cuti', wait.slice(0, 6).map(l => tr(esc(empOf(l.empId)?.name), `${fmtDate(l.date)} · ${l.days} hari`)), 'Tidak ada pengajuan.'),
      panel('Kontrak akan berakhir', ending.slice(0, 6).map(e => tr(esc(e.name), fmtDate(e.endDate), `${daysBetween(now, e.endDate)} hari`)), 'Tidak ada kontrak yang segera berakhir.'),
      panel('Tidak masuk hari ini', todayAtt.filter(a => a.status !== 'hadir').slice(0, 6).map(a => tr(esc(empOf(a.empId)?.name), ATT_STATUS[a.status])), 'Belum ada catatan.'),
      panel('Jadwal hari ini', shiftNow.slice(0, 8).map(s => tr(esc(empOf(s.empId)?.name), SHIFTS[s.shift])), 'Belum ada jadwal shift.'),
      panel('Dokumen akan berakhir', docs.slice(0, 6).map(x => tr(esc(empOf(x.empId)?.name), DOC_TYPES[x.type], fmtDate(x.exp))), 'Tidak ada dokumen yang segera berakhir.'),
      panel('Penilaian terakhir', lastScore.slice(0, 6).map(([e, r]) => tr(esc(e.name), fmtDate(r.date), r.score + '/5')), 'Belum ada penilaian kinerja.')]});
}

// Kas masuk dan keluar per bulan, serta daya tahan kas dari rata-rata pengeluaran 3 bulan terakhir
const cashOf = (ym, type) => state.tx.reduce((s, t) => t.type === type && t.date.startsWith(ym) ? s + t.amount : s, 0);
const runway = () => { const ym = today().slice(0, 7), out = [1, 2, 3].reduce((s, i) => s + cashOf(addMonths(ym, -i), 'out'), 0) / 3; return out > 0 ? totalBalance() / out : 0; };
const expenses = () => lrData(today().slice(0, 4) + '-01-01', today().slice(0, 4) + '-12-31').opex.slice().sort((a, b) => b.v - a.v).slice(0, 5).map(r => tr(r.label, rp(r.v)));
const balances = () => [...state.accounts.map(a => tr(accLabel(a), rp(balance(a.id)))), tr('<b>Total</b>', `<b>${rp(totalBalance())}</b>`)];
function financeDash() {
  const now = today(), ym = now.slice(0, 7), ar = debtTotals('piutang'), ap = debtTotals('utang');
  const tax = [ACC_PPH21, ACC_BPJS, ACC_PPN, ACC_PPN_WAPU, ACC_PPH_POT].reduce((s, a) => s + Math.max(0, journalBal(a)), 0);
  const curA = totalBalance() + ar.open + stockValue(), curL = ap.open + tax, rv = runway(), rev90 = salesIn(days(now, -90), now).rev;
  const buy90 = state.trades.filter(t => t.kind === 'purchase' && t.date >= days(now, -90)).reduce((s, t) => s + tradeTotal(t), 0), inM = cashOf(ym, 'in'), outM = cashOf(ym, 'out');
  return dashPage({title: 'Dasbor Keuangan', sub: 'Likuiditas, tagihan, dan kewajiban pajak.', alerts: [...integrityIssues(), ...obligations().filter(o => o[0] !== 'ok')],
    kpis: [['Kas & bank', rp(totalBalance()), '', `Daya tahan ${rv ? num1(rv) + ' bulan' : '—'}`], ['Arus kas bulan ini', rp(inM - outM), inM - outM >= 0 ? 'in' : 'out', `Masuk ${shortRp(inM)} · keluar ${shortRp(outM)}`], ['Rasio lancar', curL ? num1(curA / curL) + '×' : '—', '', 'Aset lancar ÷ utang lancar'],
      ['Umur piutang', rev90 > 0 ? Math.round(ar.open / (rev90 / 90)) + ' hari' : '—', '', `Piutang ${rp(ar.open)}`], ['Umur utang', buy90 > 0 ? Math.round(ap.open / (buy90 / 90)) + ' hari' : '—', '', `Utang ${rp(ap.open)}`], ['Pajak & BPJS belum disetor', rp(tax), tax ? 'out' : '']],
    chart: trend('Kas masuk dan keluar 6 bulan', [{name: 'Masuk', vals: last6().map(x => cashOf(x, 'in'))}, {name: 'Keluar', vals: last6().map(x => cashOf(x, 'out'))}]),
    side: panel('Saldo per akun', balances(), 'Belum ada akun.'),
    panels: [panel('Umur piutang', meterRows(aging('piutang')), ''), panel('Umur utang', meterRows(aging('utang')), ''), panel('Beban terbesar tahun ini', expenses(), 'Belum ada beban.'), panel('Utang jatuh tempo 7 hari', dueSoon('utang', 7).slice(0, 6).map(debtRow), 'Tidak ada utang mendesak.'),
      panel('Kalender pajak', taxCalendar().map(([n, d, v]) => tr(esc(n), fmtDate(d), v ? rp(v) : '')), ''),
      panel('Rekonsiliasi terakhir', sorted(state.recons).slice(0, 4).map(r => tr(esc(accName(r.accountId)), fmtDate(r.date), r.diff ? pill('Selisih ' + rp(r.diff), 'out') : pill('Cocok', 'in'))), 'Belum ada rekonsiliasi bank.')]});
}
// Pemeriksaan kesehatan data: tanpa kode server, dua pengguna bersamaan bisa menghasilkan nomor ganda atau stok minus
function integrityIssues() {
  const out = [], seen = new Set(), dup = new Set();
  if (bucketStray) out.push(['bad', `${bucketStray} catatan di server diabaikan karena tanggalnya tidak sesuai dengan bulan penyimpanannya. Ini bisa berarti ada pengubahan di luar aplikasi; periksa Log aktivitas.`]);
  for (const t of state.trades) { if (seen.has(t.ref)) dup.add(t.ref); seen.add(t.ref); }
  if (dup.size) out.push(['bad', `No. bukti ganda di Jual/Beli: ${[...dup].slice(0, 4).map(esc).join(', ')}. Periksa dan ubah salah satunya.`]);
  const neg = [...M().stock.stock].filter(([, s]) => s.qty < 0).map(([id]) => itemOf(id)?.name);
  if (neg.length) out.push(['bad', `Stok minus: ${neg.slice(0, 4).map(esc).join(', ')}. Periksa penjualan yang terinput bersamaan, lalu lakukan stok opname.`]);
  const diff = neracaData('2100-12-31').diff;
  if (diff) out.push(['bad', `Neraca tidak seimbang sebesar ${rp(diff)}. Periksa kode akun kategori.`]);
  const linked = new Set([...state.tx.map(t => t.tradeId), ...state.debts.map(d => d.tradeId)]), lost = state.trades.filter(t => !linked.has(t.id));
  if (lost.length) out.push(['bad', `${lost.length} jual/beli tidak punya catatan kas atau piutang/utang: ${lost.slice(0, 3).map(t => esc(t.ref)).join(', ')}.`]);
  return out;
}
function ownerDash() {
  const now = today(), ym = now.slice(0, 7), y = now.slice(0, 4), m = salesIn(ym + '-01', now), p = salesIn(addMonths(ym, -1) + '-01', sameDayPrev()), L = lrData(y + '-01-01', y + '-12-31'), ar = debtTotals('piutang'), rv = runway();
  const waitPO = state.orders.filter(o => o.status === 'draft' && ORDER_KINDS[o.kind].approval), waitLv = state.leaves.filter(l => l.status === 'draft');
  const decide = [...waitPO.slice(0, 5).map(o => tr(esc(o.ref), esc(ORDER_KINDS[o.kind].label))), ...waitLv.slice(0, 5).map(l => tr(esc(empOf(l.empId)?.name), `Cuti ${l.days} hari`))];
  const lrMonth = last6().map(x => lrData(x + '-01', lastDayOf(x))), target = targetYear(), ly = String(+y - 1);
  const ytd = lrData(y + '-01-01', now), lastYtd = lrData(ly + '-01-01', ly + now.slice(4));
  const act = state.employees.filter(e => empActive(e, ym)).length;
  return dashPage({title: company?.role === 'viewer' ? 'Ringkasan Perusahaan' : 'Dasbor Pimpinan', sub: 'Kinerja, likuiditas, dan hal yang menunggu keputusan.', alerts: [...integrityIssues(), ...obligations().filter(o => o[0] !== 'ok')],
    kpis: [[`Penjualan ${MONTHS[+ym.slice(5) - 1]}`, rp(m.rev), '', delta(m.rev, p.rev)], ['Margin kotor', m.rev ? pct((m.rev - m.hpp) / m.rev * 100) : '—', '', `Laba kotor ${rp(m.rev - m.hpp)}`], [`Laba bersih ${y}`, rp(L.net), L.net >= 0 ? 'in' : 'out', L.ti ? 'Margin ' + pct(L.net / L.ti * 100) : ''],
      ['Kas & bank', rp(totalBalance()), '', `Daya tahan ${rv ? num1(rv) + ' bulan' : '—'}`], ['Piutang lewat tempo', rp(ar.overdue), ar.overdue ? 'out' : '', `${ar.no} tagihan`], ['Menunggu keputusan', String(waitPO.length + waitLv.length), waitPO.length + waitLv.length ? 'out' : '', `${act} karyawan aktif`]],
    chart: trend('Pendapatan dan beban 6 bulan', [{name: 'Pendapatan', vals: lrMonth.map(l => l.ti)}, {name: 'Beban', vals: lrMonth.map(l => l.to)}]),
    side: panel('Menunggu keputusan', decide, 'Tidak ada yang menunggu persetujuan.'),
    panels: [panel('Target dan tahun lalu', [tr('Target pendapatan ' + y, target ? rp(target) : 'Belum diisi'), tr('Tercapai', target ? pct(L.ti / target * 100) : '—'), tr('Pendapatan sampai hari ini', rp(ytd.ti)), tr('Periode sama tahun lalu', rp(lastYtd.ti)), tr('Perubahan', lastYtd.ti ? pct((ytd.ti - lastYtd.ti) / lastYtd.ti * 100) : '—')], ''),
      panel('Proyeksi kas 3 bulan', cashForecast().map(([m, v]) => tr(m, rp(v))), ''), panel('Saldo per akun', balances(), 'Belum ada akun.'), panel('Beban terbesar tahun ini', expenses(), 'Belum ada beban.'), panel('Umur piutang', meterRows(aging('piutang')), '')]});
}
// Akun pimpinan melihat semua dasbor dalam satu halaman, dipisah per bagian dan bisa dilompati lewat menu di atas
const DASH_PARTS = [['Pimpinan', ownerDash], ['Keuangan', financeDash], ['Penjualan', salesDash], ['Gudang', warehouseDash], ['SDM', hrDash], ['Log aktivitas', logDash]];

/* Log aktivitas: seluruh jejak audit yang tersimpan di server, bisa disaring per akun. Hanya tampil di akun pimpinan.
   Rule server membuat catatan ini tidak bisa diubah atau dihapus. */
const LOG_PAGE = 100, LOG_ACTS = {tambah: ['Tambah', 'in'], ubah: ['Ubah', 'tr'], hapus: ['Hapus', 'out'], unggah: ['Unggah', 'tr'], tutup: ['Tutup buku', 'warn'], buka: ['Buka buku', 'out'], setuju: ['Setujui', 'in']};
const logAcc = a => { const m = a.u && logMembers?.find(x => x.uid === a.u); return m ? '@' + m.name : String(a.by || '').split('/')[0] || 'tidak dikenal'; };
const LOG_ENTS = {contacts: 'riwayat kontak', batches: 'batch', leaves: 'cuti', kasbons: 'kasbon', assets: 'aset', journals: 'jurnal', budgets: 'anggaran', centers: 'pusat biaya', warehouses: 'gudang', transfers: 'pindah stok', customers: 'pelanggan', salespeople: 'tenaga penjual', recurring: 'tagihan berulang', empdocs: 'dokumen karyawan', reviews: 'penilaian'};
const logEnt = e => LOG_ENTS[e] || e;
const logDevice = a => String(a.by || '').split('/')[1] || '';
const logF = {who: '', act: '', ent: '', from: '', to: '', q: '', limit: LOG_PAGE};
let logMembers = null, logMembersFor = '';
function logLoadMembers() {
  if (!company || logMembersFor === company.id) return;
  logMembersFor = company.id;
  Cloud.listMembers(company.id).then(m => { logMembers = m; if ($('logAccounts')) renderRoleDash(); }).catch(() => {});
}
function logRows() {
  const q = norm(logF.q);
  return state.audit.filter(a => (!logF.who || logAcc(a) === logF.who) && (!logF.act || a.act === logF.act) && (!logF.ent || a.ent === logF.ent) && inRange(a.ts.slice(0, 10), logF.from, logF.to)
    && (!q || norm(a.info).includes(q) || norm(a.ent).includes(q))).reverse();
}
const logTime = ts => { const d = new Date(ts); return Number.isNaN(+d) ? ts : d.toLocaleString('id-ID', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}); };
function logAccounts() {
  const now = today(), since = days(now, -30), m = new Map();
  (logMembers || []).forEach(x => m.set('@' + x.name, {role: ROLES[x.role] || x.role, n: 0, day: 0, last: null}));
  for (const a of state.audit) {
    const k = logAcc(a); if (!m.has(k)) m.set(k, {role: '—', n: 0, day: 0, last: null});
    const r = m.get(k), d = a.ts.slice(0, 10); if (d >= since) r.n++; if (d === now) r.day++; r.last = a;
  }
  return [...m.entries()].sort((a, b) => (b[1].last?.ts || '').localeCompare(a[1].last?.ts || ''));
}
function logRender() {
  const rows = logRows(), shown = rows.slice(0, logF.limit), acts = logAccounts();
  $('logAccounts').innerHTML = `<table class="rtable"><thead><tr><th>Akun</th><th>Peran</th><th class="num">Hari ini</th><th class="num">30 hari</th><th>Terakhir mengisi</th><th>Kegiatan terakhir</th></tr></thead><tbody>${acts.map(([k, r]) => `<tr><td data-label="Akun"><b>${esc(k)}</b></td><td data-label="Peran">${esc(r.role)}</td><td data-label="Hari ini" class="num">${r.day}</td><td data-label="30 hari" class="num">${r.n}</td><td data-label="Terakhir mengisi">${r.last ? esc(logTime(r.last.ts)) : 'Belum ada'}</td><td data-label="Kegiatan terakhir">${r.last ? esc(`${r.last.act} ${logEnt(r.last.ent)}`) : '—'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty" data-label="">Belum ada aktivitas.</td></tr>'}</tbody></table>`;
  $('logCount').textContent = `${rows.length.toLocaleString('id-ID')} catatan cocok dari ${state.audit.length.toLocaleString('id-ID')}`;
  $('logBody').innerHTML = shown.map(a => { const b = LOG_ACTS[a.act] || [a.act, 'warn']; return `<tr><td data-label="Waktu" style="white-space:nowrap">${esc(logTime(a.ts))}</td><td data-label="Akun"><b>${esc(logAcc(a))}</b></td><td data-label="Aksi"><span class="badge ${b[1]}">${esc(b[0])}</span></td><td data-label="Data">${esc(logEnt(a.ent))}</td><td data-label="Rincian" class="log-info">${esc(a.info)}</td><td data-label="Perangkat" class="muted">${esc(logDevice(a))}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty" data-label="">Tidak ada catatan yang cocok.</td></tr>';
  $('logMore').hidden = rows.length <= shown.length;
}
function logDash() {
  const now = today(), wk = days(now, -7), todays = state.audit.filter(a => a.ts.startsWith(now)), week = state.audit.filter(a => a.ts.slice(0, 10) >= wk);
  const opt = (vals, cur, label) => `<option value="">${label}</option>` + vals.map(([v, t]) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`).join('');
  const uniq = f => [...new Set(state.audit.map(f))].sort();
  queueMicrotask(() => { if ($('logBody')) { logRender(); logLoadMembers(); } });
  return `<div class="dash-head"><div><h2>Log Aktivitas Server</h2><p class="muted">Riwayat input semua akun. Catatan tersimpan di server dan tidak bisa diubah atau dihapus.</p></div></div>
    <div class="grid cards">${[['Aktivitas hari ini', todays.length.toLocaleString('id-ID'), '', `${new Set(todays.map(logAcc)).size} akun aktif`], ['Aktivitas 7 hari', week.length.toLocaleString('id-ID'), '', `${new Set(week.map(logAcc)).size} akun aktif`], ['Perubahan dan hapus 7 hari', String(week.filter(a => ['ubah', 'hapus', 'buka'].includes(a.act)).length), '', 'Perlu dicermati'], ['Total catatan', state.audit.length.toLocaleString('id-ID'), '', state.audit[0] ? 'Sejak ' + fmtDate(state.audit[0].ts.slice(0, 10)) : '']].map(statCard).join('')}</div>
    <div class="card" style="margin-top:16px"><h3>Ringkasan per akun</h3><div class="table-wrap" id="logAccounts"></div></div>
    <div class="card" style="margin-top:16px"><h3>Riwayat input</h3>
      <div class="toolbar" id="logFilter">
        <label class="f">Akun<select data-log="who">${opt(uniq(logAcc).map(v => [v, v]), logF.who, 'Semua akun')}</select></label>
        <label class="f">Aksi<select data-log="act">${opt(uniq(a => a.act).map(v => [v, LOG_ACTS[v]?.[0] || v]), logF.act, 'Semua aksi')}</select></label>
        <label class="f">Data<select data-log="ent">${opt(uniq(a => a.ent).map(v => [v, logEnt(v)]), logF.ent, 'Semua data')}</select></label>
        <label class="f">Dari<input type="date" data-log="from" value="${esc(logF.from)}"></label>
        <label class="f">Sampai<input type="date" data-log="to" value="${esc(logF.to)}"></label>
        <label class="f" style="flex:1;min-width:160px">Cari<input type="search" data-log="q" value="${esc(logF.q)}" placeholder="No. bukti, nama, nilai"></label>
      </div>
      <p class="muted" id="logCount" style="font-size:12px;margin:0 0 8px"></p>
      <div class="table-wrap"><table class="rtable"><thead><tr><th>Waktu</th><th>Akun</th><th>Aksi</th><th>Data</th><th>Rincian</th><th>Perangkat</th></tr></thead><tbody id="logBody"></tbody></table></div>
      <div style="text-align:center;margin-top:10px"><button type="button" class="btn sm" id="logMore" data-act="logMore" hidden>Tampilkan lebih banyak</button></div>
    </div>`;
}
document.addEventListener('input', e => { const k = e.target.dataset?.log; if (!k) return; logF[k] = e.target.value; logF.limit = LOG_PAGE; logRender(); });
function allDash() {
  return `<p class="muted" style="margin:0">Halaman ini memuat ${DASH_PARTS.length} dasbor. Pilih bagian atau gulir ke bawah.</p>
    <nav class="dash-jump" aria-label="Bagian dasbor">${DASH_PARTS.map(([name], i) => `<button type="button" class="btn sm" data-act="dJump" data-id="${i}">${name}</button>`).join('')}</nav>`
    + DASH_PARTS.map(([name, fn], i) => { try { return `<section class="dash-sec" id="dash-${i}">${fn()}</section>`; } catch (e) { return `<section class="dash-sec" id="dash-${i}"><div class="notice">Dasbor ${name} gagal dimuat: ${esc(e?.message)}</div></section>`; } }).join('');
}
function renderRoleDash() {
  const role = company?.role || 'owner';
  $('financeDash').hidden = true;
  $('roleDash').innerHTML = role === 'owner' ? allDash() : ({sales: salesDash, warehouse: warehouseDash, hr: hrDash, finance: financeDash}[role] || ownerDash)();
  $('roleDash').insertAdjacentHTML('beforeend', `<p class="muted" style="font-size:11px;text-align:center;margin-top:20px">Versi ${APP_VERSION} · peran ${esc(ROLES[role])}</p>`);
  const jump = $('roleDash').querySelector('.dash-jump');
  if (jump) jump.style.top = document.querySelector('header').offsetHeight + 'px'; // tetap terlihat di bawah kepala halaman
  return true;
}
Object.assign(ACTIONS, {dJump: i => $('dash-' + i)?.scrollIntoView({block: 'start'}), logMore: () => { logF.limit += LOG_PAGE; logRender(); }});

/* ---------- Pelengkap tiap bidang ---------- */
const SHIFTS = {pagi: 'Pagi', siang: 'Siang', malam: 'Malam', libur: 'Libur'};
const DOC_TYPES = {kontrak: 'Perjanjian kerja', ktp: 'KTP', sertifikat: 'Sertifikat', sim: 'SIM', lain: 'Lainnya'};
const opt = o => Object.entries(o).map(([id, name]) => ({id, name}));
Object.assign(ERP_TABS, {contacts: ['Riwayat kontak', ['sales']], salespeople: ['Tenaga penjual', []], batches: ['Batch', ['warehouse']], recurring: ['Berulang', []], recon: ['Rekonsiliasi', []]});
Object.assign(FORMS, {
  contacts: {col: 'contacts', title: 'Riwayat kontak', dated: true, fields: [{k: 'customerId', label: 'Pelanggan', type: 'select', opts: () => state.customers}, date_('date', 'Tanggal'), text('channel', 'Cara (telepon, kunjungan, WA)'), {k: 'next', label: 'Tindak lanjut berikutnya', type: 'date', opt: true}, {k: 'note', label: 'Catatan', type: 'area'}]},
  salespeople: {col: 'salespeople', title: 'Tenaga penjual', fields: [text('name', 'Nama', true), money('target', 'Target per bulan (Rp)'), {k: 'rate', label: 'Komisi (%)', type: 'qty'}], used: r => state.trades.some(t => t.salesId === r.id)},
  batches: {col: 'batches', title: 'Batch barang', fields: [{k: 'itemId', label: 'Barang', type: 'select', opts: () => state.items.filter(i => i.kind === 'barang')}, text('batch', 'No. batch', true), {k: 'exp', label: 'Kedaluwarsa', type: 'date', opt: true}, {k: 'qty', label: 'Jumlah', type: 'qty'}, {k: 'note', label: 'Keterangan', type: 'area'}]},
  recurring: {col: 'recurring', title: 'Tagihan berulang', fields: [text('name', 'Nama', true), {k: 'categoryId', label: 'Kategori', type: 'select', opts: () => state.categories.filter(c => c.type === 'out' && manualCat(c))}, {k: 'accountId', label: 'Dibayar dari akun', type: 'select', opts: () => state.accounts}, money('amount', 'Jumlah (Rp)'), {k: 'day', label: 'Tanggal jatuh tempo (1-28)', type: 'int'}, {k: 'active', label: 'Aktif', type: 'check'}],
    prep: d => d.amount > 0 && d.day >= 1 && d.day <= 28 ? '' : 'Isi jumlah dan tanggal 1 sampai 28'},
  empdocs: {col: 'empdocs', title: 'Dokumen karyawan', fields: [{k: 'empId', label: 'Karyawan', type: 'select', opts: () => state.employees}, {k: 'type', label: 'Jenis', type: 'select', opts: () => opt(DOC_TYPES)}, text('no', 'Nomor dokumen'), {k: 'exp', label: 'Berlaku sampai', type: 'date', opt: true}, {k: 'note', label: 'Keterangan', type: 'area'}]},
  reviews: {col: 'reviews', title: 'Penilaian kinerja', dated: true, fields: [{k: 'empId', label: 'Karyawan', type: 'select', opts: () => state.employees}, date_('date', 'Tanggal penilaian'), {k: 'score', label: 'Nilai (1-5)', type: 'int'}, {k: 'note', label: 'Catatan', type: 'area'}], prep: d => d.score >= 1 && d.score <= 5 ? '' : 'Nilai harus 1 sampai 5'},
});
// Data tambahan disimpan seperti data ERP lain
function sanitizeMore(d) {
  const num = v => Math.abs(cleanNum(v));
  return {
    salespeople: list(d.salespeople).map(s => ({id: cleanId(s?.id), name: cleanStr(s?.name, 120), target: num(s?.target), rate: cleanPct(s?.rate, 0)})).filter(s => s.id && s.name),
    contacts: list(d.contacts).map(c => ({id: cleanId(c?.id), created: cleanNum(c?.created), customerId: cleanId(c?.customerId), date: cleanDate(c?.date), channel: cleanStr(c?.channel, 60), next: cleanDate(c?.next), note: cleanStr(c?.note, 300)})).filter(c => c.id && c.date),
    batches: list(d.batches).map(b => ({id: cleanId(b?.id), itemId: cleanId(b?.itemId), batch: cleanStr(b?.batch, 40), exp: cleanDate(b?.exp), qty: cleanQty(b?.qty), note: cleanStr(b?.note, 300)})).filter(b => b.id && b.itemId),
    recurring: list(d.recurring).map(r => ({id: cleanId(r?.id), name: cleanStr(r?.name, 120), categoryId: cleanId(r?.categoryId), accountId: cleanId(r?.accountId), amount: num(r?.amount), day: Math.min(28, Math.max(1, num(r?.day))), active: r?.active !== false, lastYm: cleanStr(r?.lastYm, 7)})).filter(r => r.id && r.name),
    recons: list(d.recons).map(r => ({id: cleanId(r?.id), created: cleanNum(r?.created), date: cleanDate(r?.date), accountId: cleanId(r?.accountId), stmt: cleanNum(r?.stmt), book: cleanNum(r?.book), diff: cleanNum(r?.diff)})).filter(r => r.id && r.date),
    empdocs: list(d.empdocs).map(x => ({id: cleanId(x?.id), empId: cleanId(x?.empId), type: Object.hasOwn(DOC_TYPES, x?.type) ? x.type : 'lain', no: cleanStr(x?.no, 60), exp: cleanDate(x?.exp), note: cleanStr(x?.note, 300)})).filter(x => x.id && x.empId),
    reviews: list(d.reviews).map(x => ({id: cleanId(x?.id), created: cleanNum(x?.created), empId: cleanId(x?.empId), date: cleanDate(x?.date), score: Math.min(5, Math.max(1, num(x?.score))), note: cleanStr(x?.note, 300)})).filter(x => x.id && x.empId && x.date),
    shifts: list(d.shifts).map(x => ({id: cleanId(x?.id), empId: cleanId(x?.empId), date: cleanDate(x?.date), shift: Object.hasOwn(SHIFTS, x?.shift) ? x.shift : 'pagi'})).filter(x => x.id && x.empId && x.date),
  };
}

/* Tab ERP tambahan */
let reconAcc = '';
function renderErpMore(box, table, td, open, add) {
  const go = html => { box.innerHTML = html; return true; };
  if (erpTab === 'contacts') return go(add('+ Kontak', 'formNew') + table(['Tanggal', 'Pelanggan', 'Catatan', 'Tindak lanjut'], sorted(state.contacts).map(c => `<tr>${td('Tanggal', fmtDate(c.date))}${td('Pelanggan', esc(custOf(c.customerId)?.name))}${td('Catatan', esc([c.channel, c.note].filter(Boolean).join(' · ')))}${td('Tindak lanjut', c.next ? fmtDate(c.next) : '—')}${open('formEdit', c.id, 'Ubah')}</tr>`), 'Belum ada riwayat kontak.'));
  if (erpTab === 'salespeople') { const ym = today().slice(0, 7); return go(add('+ Tenaga penjual', 'formNew') + table(['Nama', 'Target', 'Penjualan bulan ini', 'Komisi'], state.salespeople.map(s => { const v = salesBy(s.id, ym); return `<tr>${td('Nama', `<b>${esc(s.name)}</b>`)}${td('Target', rp(s.target), 'num')}${td('Penjualan bulan ini', rp(v), 'num')}${td('Komisi', rp(v * s.rate / 100), 'num')}${open('formEdit', s.id, 'Ubah')}</tr>`; }), 'Belum ada tenaga penjual.')); }
  if (erpTab === 'batches') return go(add('+ Batch', 'formNew') + table(['Barang', 'No. batch', 'Kedaluwarsa', 'Jumlah'], state.batches.slice().sort((a, b) => (a.exp || '9').localeCompare(b.exp || '9')).map(b => `<tr>${td('Barang', esc(itemOf(b.itemId)?.name))}${td('No. batch', esc(b.batch))}${td('Kedaluwarsa', b.exp ? fmtDate(b.exp) : '—', b.exp && b.exp < today() ? 'out' : '')}${td('Jumlah', fmtQty(b.qty), 'num')}${open('formEdit', b.id, 'Ubah')}</tr>`), 'Belum ada batch. Keluarkan barang yang kedaluwarsanya paling dekat lebih dulu.'));
  if (erpTab === 'recurring') { const ym = today().slice(0, 7); return go(add('+ Tagihan berulang', 'formNew') + table(['Nama', 'Jatuh tempo', 'Jumlah', 'Bulan ini'], state.recurring.map(r => `<tr>${td('Nama', `<b>${esc(r.name)}</b>${r.active ? '' : ' <span class="badge warn">Nonaktif</span>'}`)}${td('Jatuh tempo', 'Tanggal ' + r.day)}${td('Jumlah', rp(r.amount), 'num')}${td('Bulan ini', r.lastYm === ym ? '<span class="badge in">Tercatat</span>' : `<button class="btn sm primary" data-act="postRecurring" data-id="${esc(r.id)}">Catat</button>`)}${open('formEdit', r.id, 'Ubah')}</tr>`), 'Belum ada tagihan berulang.')); }
  if (erpTab === 'recon') {
    reconAcc = state.accounts.some(a => a.id === reconAcc) ? reconAcc : state.accounts[0]?.id || '';
    const a = state.accounts.find(x => x.id === reconAcc), rows = sorted(state.tx.filter(t => effect(t, reconAcc) !== 0));
    const cleared = (a?.opening || 0) + rows.reduce((s, t) => s + (t.cleared ? effect(t, reconAcc) : 0), 0), open_ = rows.filter(t => !t.cleared);
    return go(`<div class="toolbar"><label class="f">Akun<select id="reconAcc">${state.accounts.map(x => `<option value="${esc(x.id)}"${x.id === reconAcc ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="f">Saldo rekening koran (Rp)<input id="reconStmt" inputmode="numeric"></label><button class="btn primary" data-act="saveRecon">Simpan rekonsiliasi</button></div>
      <div class="tsum" id="reconSum" data-book="${cleared}" style="margin-bottom:12px">Saldo buku yang sudah cocok <b>${rp(cleared)}</b> · Saldo buku keseluruhan <b>${rp(balance(reconAcc))}</b> · ${open_.length} transaksi belum dicocokkan</div>`
      + table(['Cocok', 'Tanggal', 'No. bukti', 'Uraian', 'Jumlah'], rows.slice(0, 200).map(t => `<tr>${td('Cocok', `<input type="checkbox" data-clr="${esc(t.id)}"${t.cleared ? ' checked' : ''} aria-label="Cocok dengan rekening koran">`)}${td('Tanggal', fmtDate(t.date))}${td('No. bukti', esc(t.ref))}${td('Uraian', esc(t.desc))}${td('Jumlah', rp(effect(t, reconAcc)), 'num')}<td class="no-print"></td></tr>`), 'Belum ada transaksi di akun ini.')
      + `<h3 style="font-size:14px;margin:16px 0 8px">Riwayat rekonsiliasi</h3>` + table(['Tanggal', 'Akun', 'Rekening koran', 'Saldo cocok', 'Selisih'], sorted(state.recons).slice(0, 12).map(r => `<tr>${td('Tanggal', fmtDate(r.date))}${td('Akun', esc(accName(r.accountId)))}${td('Rekening koran', rp(r.stmt), 'num')}${td('Saldo cocok', rp(r.book), 'num')}${td('Selisih', rp(r.diff), 'num ' + (r.diff ? 'out' : ''))}<td class="no-print"></td></tr>`), 'Belum ada rekonsiliasi.'));
  }
  if (erpTab === 'pr' && reorderList().length) { queueMicrotask(() => { const t = box.querySelector('.toolbar'); if (t) t.insertAdjacentHTML('beforeend', ` <button class="btn" data-act="prFromReorder">Buat dari saran pesan ulang (${reorderList().length})</button>`); }); }
  return false;
}
document.addEventListener('change', e => {
  if (e.target.id === 'reconAcc') { reconAcc = e.target.value; return renderErp(); }
  const id = e.target.dataset?.clr; if (!id) return;
  const t = state.tx.find(x => x.id === id); if (!t) return;
  if (e.target.checked) t.cleared = true; else delete t.cleared;
  save();
});
document.addEventListener('input', e => { if (e.target.id !== 'reconStmt') return; const n = parseNum(e.target.value); e.target.value = n ? n.toLocaleString('id-ID') : ''; const b = +$('reconSum').dataset.book, d = n - b; $('reconSum').innerHTML = $('reconSum').innerHTML.split(' · Selisih')[0] + ` · Selisih <b class="${d ? 'out' : 'in'}">${rp(d)}</b>`; });

/* Penjualan: tenaga penjual, batas kredit, harga pelanggan */
const salesBy = (id, ym) => state.trades.reduce((s, t) => t.kind === 'sale' && t.salesId === id && t.date.startsWith(ym) ? s + tradeTotal(t) : s, 0);
const custByName = name => state.customers.find(c => c.name === String(name).trim());
const custOpen = name => state.debts.reduce((s, d) => d.kind === 'piutang' && d.party === name ? s + Math.max(0, remainOf(d)) : s, 0);
const custPrice = (itemPrice, name) => Math.round(itemPrice * (1 - (custByName(name)?.disc || 0) / 100));
function creditProblem(d) {
  const c = custByName(d.party);
  if (d.kind !== 'sale' || d.pay !== 'credit' || !c?.limit) return '';
  const used = custOpen(c.name) - (editingTrade ? Math.max(0, remainOf(tradeDebt(editingTrade) || {amount: 0, id: ''})) : 0), total = used + tradePay(d);
  return total > c.limit ? `Melebihi batas kredit ${c.name}: ${rp(c.limit)} (piutang menjadi ${rp(total)})` : '';
}

/* Gudang: barcode dan saran pesan ulang */
const C39 = {0: 'nnnwwnwnn', 1: 'wnnwnnnnw', 2: 'nnwwnnnnw', 3: 'wnwwnnnnn', 4: 'nnnwwnnnw', 5: 'wnnwwnnnn', 6: 'nnwwwnnnn', 7: 'nnnwnnwnw', 8: 'wnnwnnwnn', 9: 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn', K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn'};
function barcodeSvg(code) {
  let x = 0, bars = '';
  for (const ch of `*${code}*`) {
    [...(C39[ch] || C39['-'])].forEach((p, i) => { const w = p === 'w' ? 3 : 1; if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="50"/>`; x += w; });
    x += 1;
  }
  return `<svg viewBox="0 0 ${x} 50" width="${Math.min(320, x * 1.4)}" height="60" role="img" aria-label="Barcode ${esc(code)}" style="background:#fff" fill="#000">${bars}</svg>`;
}
function printLabel(id) {
  const i = itemOf(id); if (!i) return;
  if (!i.code) return toast('Isi kode barang dulu');
  $('printArea').innerHTML = `<div style="padding:12px;color:#000;background:#fff"><b>${esc(i.name)}</b><div>${barcodeSvg(i.code.toUpperCase())}</div><div>${esc(i.code)} · ${rp(i.price)}</div></div>`;
  document.body.classList.add('print-voucher'); window.print();
}
function reorderList() {
  const st = M().stock.stock, since = days(today(), -90), sold = new Map();
  for (const t of state.trades) if (t.kind === 'sale' && t.date >= since) for (const l of t.lines) sold.set(l.itemId, (sold.get(l.itemId) || 0) + l.qty);
  const coming = new Map(); for (const o of openOrders('po')) for (const l of orderRemain(o)) coming.set(l.itemId, (coming.get(l.itemId) || 0) + l.qty);
  return state.items.filter(i => i.kind === 'barang').map(i => {
    const daily = (sold.get(i.id) || 0) / 90, lead = i.leadDays || 7, point = Math.ceil(daily * lead + i.minQty), have = (st.get(i.id)?.qty || 0) + (coming.get(i.id) || 0);
    return {i, point, have, qty: Math.max(Math.ceil(daily * 30), point - have)};
  }).filter(r => r.point > 0 && r.have <= r.point).sort((a, b) => a.have - b.have);
}

/* SDM: jadwal shift */
let shiftWeek = '';
function weekDates() {
  shiftWeek ||= today();
  const d = new Date(shiftWeek + 'T00:00:00'), mon = days(shiftWeek, -((d.getDay() + 6) % 7));
  return Array.from({length: 7}, (_, i) => days(mon, i));
}
function renderHrMore() {
  if (hrTab === 'doc') {
    $('docBody').innerHTML = state.empdocs.slice().sort((a, b) => (a.exp || '9').localeCompare(b.exp || '9')).map(x => `<tr><td data-label="Nama"><b>${esc(empOf(x.empId)?.name)}</b></td><td data-label="Dokumen">${DOC_TYPES[x.type]} ${esc(x.no)}</td><td data-label="Berlaku s.d." class="${x.exp && x.exp < days(today(), 30) ? 'out' : ''}">${x.exp ? fmtDate(x.exp) : 'Tanpa batas'}</td><td data-label="" class="no-print num"><button class="btn sm" data-act="openDoc" data-id="${esc(x.id)}">Ubah</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty" data-label="">Belum ada dokumen.</td></tr>';
  } else if (hrTab === 'rev') {
    $('revBody').innerHTML = sorted(state.reviews).map(x => `<tr><td data-label="Tanggal">${fmtDate(x.date)}</td><td data-label="Nama"><b>${esc(empOf(x.empId)?.name)}</b></td><td data-label="Nilai" class="num">${x.score}/5</td><td data-label="Catatan">${esc(x.note)}</td><td data-label="" class="no-print num"><button class="btn sm" data-act="openRev" data-id="${esc(x.id)}">Ubah</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty" data-label="">Belum ada penilaian.</td></tr>';
  } else if (hrTab === 'shift') {
    const w = weekDates(); $('shiftDate').value = shiftWeek;
    $('shiftHead').innerHTML = `<tr><th>Nama</th>${w.map(d => `<th>${d.slice(8)}/${d.slice(5, 7)}</th>`).join('')}</tr>`;
    $('shiftBody').innerHTML = state.employees.filter(e => empActive(e, today().slice(0, 7))).map(e => `<tr><td><b>${esc(e.name)}</b></td>${w.map(d => { const s = state.shifts.find(x => x.empId === e.id && x.date === d); return `<td><select data-shift="${esc(e.id)}" data-date="${d}" aria-label="Shift ${d}"><option value="">—</option>${Object.entries(SHIFTS).map(([k, v]) => `<option value="${k}"${s?.shift === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>`; }).join('')}</tr>`).join('') || '<tr><td class="empty">Belum ada karyawan aktif.</td></tr>';
  }
}
$('shiftDate').oninput = () => { shiftWeek = cleanDate($('shiftDate').value) || today(); renderHrMore(); };
document.addEventListener('change', e => {
  const empId = e.target.dataset?.shift; if (!empId) return;
  const date = e.target.dataset.date, cur = state.shifts.find(x => x.empId === empId && x.date === date);
  if (!e.target.value) state.shifts = state.shifts.filter(x => x !== cur);
  else if (cur) cur.shift = e.target.value;
  else state.shifts.push({id: 'sh' + hash(empId + date) + shardOf(date), empId, date, shift: e.target.value});
  persist();
});
$('btnNewDoc').onclick = () => { if (!state.employees.length) return toast('Tambahkan data karyawan dulu'); openForm('empdocs'); };
$('btnNewRev').onclick = () => { if (!state.employees.length) return toast('Tambahkan data karyawan dulu'); openForm('reviews'); };

/* Pimpinan dan keuangan */
function cashForecast() {
  const ym = today().slice(0, 7), base = [1, 2, 3].reduce((s, i) => s + cashOf(addMonths(ym, -i), 'in') - cashOf(addMonths(ym, -i), 'out'), 0) / 3;
  const rec = state.recurring.filter(r => r.active).reduce((s, r) => s + r.amount, 0); let cash = totalBalance();
  return [1, 2, 3].map(i => {
    const m = addMonths(ym, i), inn = state.debts.reduce((s, d) => d.kind === 'piutang' && d.due?.startsWith(m) ? s + Math.max(0, remainOf(d)) : s, 0), out = state.debts.reduce((s, d) => d.kind === 'utang' && d.due?.startsWith(m) ? s + Math.max(0, remainOf(d)) : s, 0);
    cash += base + inn - out - (base ? 0 : rec);
    return [ymLabel(m), Math.round(cash)];
  });
}
function targetYear() {
  const y = today().slice(0, 4);
  return state.budgets.filter(b => b.year === y && ['4-101', '4-102'].includes(catOf(b.categoryId)?.code)).reduce((s, b) => s + b.amount, 0);
}
function taxCalendar() {
  const now = today(), ym = now.slice(0, 7), next = addMonths(ym, 1), day15 = now.slice(8) <= '15' ? ym + '-15' : next + '-15', endM = lastDayOf(ym), day20 = now.slice(8) <= '20' ? ym + '-20' : next + '-20';
  const rows = [['Setor PPh 21 dan PPh potput', day15, Math.max(0, journalBal(ACC_PPH21)) + Math.max(0, journalBal(ACC_PPH_POT))], ['Lapor SPT Masa PPh 21/26', day20, 0], ['Setor PPh final UMKM', day15, 0]];
  if (state.tax.pkp) rows.push(['Setor dan lapor SPT Masa PPN', endM, Math.max(0, journalBal(ACC_PPN))]);
  if (journalBal(ACC_BPJS) > 0) rows.push(['Bayar iuran BPJS', day15, journalBal(ACC_BPJS)]);
  return rows.sort((a, b) => a[1].localeCompare(b[1]));
}
function moreObligations() {
  const out = [], now = today(), ym = now.slice(0, 7), role = company?.role || 'owner';
  if (['owner', 'finance'].includes(role)) {
    const due = state.recurring.filter(r => r.active && r.lastYm !== ym && +now.slice(8) >= r.day - 3);
    if (due.length) out.push(['warn', `${due.length} tagihan berulang belum dicatat bulan ini: ${due.slice(0, 3).map(r => esc(r.name)).join(', ')}.`]);
  }
  return out;
}
Object.assign(ACTIONS, {
  printLabel,
  openDoc: id => openForm('empdocs', id), openRev: id => openForm('reviews', id),
  postRecurring: id => {
    const r = state.recurring.find(x => x.id === id), d = today(); if (!r) return;
    if (isLocked(d)) return toast(lockMsg());
    const t = {id: uid(), created: Date.now(), type: 'out', date: d, ref: nextRef('out', d), amount: r.amount, accountId: r.accountId, categoryId: r.categoryId, toAccountId: null, desc: r.name};
    state.tx.push(t); r.lastYm = d.slice(0, 7); log('tambah', 'transaksi', t.id, txSummary(t)); save(); toast('Tercatat · ' + t.ref);
  },
  saveRecon: () => {
    const stmt = parseNum($('reconStmt').value), book = +$('reconSum').dataset.book;
    if (!$('reconStmt').value) return toast('Isi saldo rekening koran');
    const r = {id: uid(), created: Date.now(), date: today(), accountId: reconAcc, stmt, book, diff: stmt - book};
    state.recons.push(r); log('tambah', 'rekonsiliasi', r.id, `${accName(reconAcc)} · koran ${rp(stmt)} · selisih ${rp(r.diff)}`); save(); toast(r.diff ? 'Tersimpan, masih ada selisih ' + rp(r.diff) : 'Rekonsiliasi cocok');
  },
  prFromReorder: () => {
    const lines = reorderList().map(r => ({itemId: r.i.id, qty: r.qty, price: M().stock.stock.get(r.i.id)?.qty ? Math.round(M().stock.stock.get(r.i.id).value / M().stock.stock.get(r.i.id).qty) : r.i.openCost}));
    orderSeedFrom = null; openOrder(null, {kind: 'pr', date: today(), status: 'draft', partyId: null, note: 'Dibuat dari saran pesan ulang', lines});
  },
});
function moreReport(type, from, to, period) {
  if (type === 'komisi') {
    const rows = state.salespeople.map(s => { const v = state.trades.reduce((x, t) => t.kind === 'sale' && t.salesId === s.id && inRange(t.date, from, to) ? x + tradeTotal(t) : x, 0); return [s, v]; });
    return kop('Penjualan dan Komisi', period) + `<table><thead><tr><th>Nama</th><th class="num">Penjualan</th><th class="num">Komisi %</th><th class="num">Komisi</th></tr></thead>${rows.map(([s, v]) => `<tr><td>${esc(s.name)}</td><td class="num">${rp(v)}</td><td class="num">${String(s.rate).replace('.', ',')}%</td><td class="num">${rp(v * s.rate / 100)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Belum ada tenaga penjual.</td></tr>'}<tr class="total"><td>Total</td><td class="num">${rp(rows.reduce((s, r) => s + r[1], 0))}</td><td></td><td class="num">${rp(rows.reduce((s, r) => s + r[1] * r[0].rate / 100, 0))}</td></tr></table>` + signBlock();
  }
  if (type === 'pph21') {
    const y = (to || today()).slice(0, 4), m = new Map();
    for (const p of state.payrolls) if (p.period.startsWith(y)) for (const l of p.lines) { const r = m.get(l.empId) || {name: l.name, ptkp: l.ptkp, n: 0, bruto: 0, iur: 0, pph: 0}; r.n++; r.bruto += l.bruto; r.iur += l.ee.jht + l.ee.jp; r.pph += l.pph; r.name = l.name; m.set(l.empId, r); }
    return kop('Rekap Penghasilan dan PPh 21 Setahun', 'Tahun ' + esc(y)) + `<table><thead><tr><th>Nama</th><th>PTKP</th><th class="num">Bulan</th><th class="num">Bruto</th><th class="num">Iuran JHT/JP</th><th class="num">PPh 21</th></tr></thead>${[...m.values()].map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.ptkp)}</td><td class="num">${r.n}</td><td class="num">${rp(r.bruto)}</td><td class="num">${rp(r.iur)}</td><td class="num">${rp(r.pph)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Belum ada penggajian tahun ini.</td></tr>'}</table><p class="muted" style="font-size:12px">Bahan penyusunan bukti potong. Bukti potong resmi tetap diterbitkan lewat Coretax.</p>` + signBlock();
  }
  if (type === 'ringkasan') {
    const y = (to || today()).slice(0, 4), prev = String(+y - 1), months = Array.from({length: 12}, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
    const rows = months.map(ym => { const l = lrData(ym + '-01', lastDayOf(ym)), p = lrData(prev + ym.slice(4) + '-01', lastDayOf(prev + ym.slice(4))); return {ym, l, p, cash: cashOf(ym, 'in') - cashOf(ym, 'out')}; });
    const sum = f => rows.reduce((s, r) => s + f(r), 0);
    return kop('Ringkasan Bulanan', 'Tahun ' + esc(y)) + `<table><thead><tr><th>Bulan</th><th class="num">Pendapatan</th><th class="num">Tahun lalu</th><th class="num">Laba kotor</th><th class="num">Laba bersih</th><th class="num">Arus kas</th></tr></thead>${rows.map(r => `<tr><td>${ymLabel(r.ym)}</td><td class="num">${rp(r.l.ti)}</td><td class="num">${rp(r.p.ti)}</td><td class="num">${rp(r.l.ti - r.l.hpp)}</td><td class="num">${rp(r.l.net)}</td><td class="num">${rp(r.cash)}</td></tr>`).join('')}<tr class="total"><td>Total</td><td class="num">${rp(sum(r => r.l.ti))}</td><td class="num">${rp(sum(r => r.p.ti))}</td><td class="num">${rp(sum(r => r.l.ti - r.l.hpp))}</td><td class="num">${rp(sum(r => r.l.net))}</td><td class="num">${rp(sum(r => r.cash))}</td></tr></table>` + signBlock();
  }
  return '';
}
