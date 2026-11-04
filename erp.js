'use strict';
/* Modul ERP: perusahaan bersama (banyak pengguna), penjualan & CRM, pembelian & gudang, akuntansi lanjutan, dan SDM lanjutan.
   Berkas ini dimuat setelah app.js dan memakai fungsi serta data yang sama. */

const ROLES = {owner: 'Pimpinan', finance: 'Keuangan', sales: 'Penjualan', warehouse: 'Gudang & pembelian', hr: 'SDM', viewer: 'Hanya lihat'};
const ROLE_VIEWS = {sales: ['dashboard', 'transaksi', 'jualbeli', 'erp', 'hutang', 'pengaturan'], warehouse: ['dashboard', 'transaksi', 'jualbeli', 'erp', 'hutang', 'pengaturan'],
  hr: ['dashboard', 'karyawan', 'pengaturan'], viewer: ['dashboard', 'laporan', 'pengaturan']};
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
  return {customers: [], orders: [], warehouses: [], transfers: [], centers: [], assets: [], journals: [], budgets: [], attendance: [], leaves: [], kasbons: []};
}
function sanitizeErp(d) {
  const num = v => Math.abs(cleanNum(v)), oneOf = (v, o, def) => Object.hasOwn(o, v) ? v : def, acc = a => ({code: cleanStr(a?.code, 20), name: cleanStr(a?.name, 120)});
  return {
    customers: list(d.customers).map(c => ({id: cleanId(c?.id), name: cleanStr(c?.name, 120), pic: cleanStr(c?.pic, 120), phone: cleanStr(c?.phone, 40), email: cleanStr(c?.email, 120),
      address: cleanStr(c?.address, 300), npwp: cleanStr(c?.npwp, 30), terms: num(c?.terms), wapu: c?.wapu === true})).filter(c => c.id && c.name),
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
  ['customers', 'warehouses', 'centers', 'assets', 'journals'].forEach(c => add(c));
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
const SYNC_COLS = {accounts: 0, categories: 0, items: 0, vendors: 0, customers: 0, warehouses: 0, centers: 0, assets: 0, budgets: 0,
  tx: 1, debts: 1, trades: 1, returns: 1, adjusts: 1, orders: 1, transfers: 1, journals: 1, audit: 1, employees: 2, payrolls: 3, attendance: 3, leaves: 3, kasbons: 3};
const SETTING_KEYS = ['company', 'hr', 'tax', 'lockedUntil'];
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const shardOf = id => hash(id).charCodeAt(0) % 4;
function bucketOf(col, id, rec) {
  const kind = SYNC_COLS[col], dated = kind === 1 || kind === 3;
  const when = dated ? String(rec.date || rec.ts || '').slice(0, 7) || 'x' : '';
  return {sub: kind >= 2 ? 'hrdata' : 'buckets', id: `${col}~${when}~${shardOf(id)}`};
}
function flatten(s) {
  const m = new Map(), put = (col, id, rec, b) => m.set(col + '/' + id, {rid: id, rec, json: JSON.stringify(rec), sub: b.sub, bid: b.id});
  for (const col of Object.keys(SYNC_COLS))
    for (const r of s[col] || []) { const id = col === 'audit' ? 'a' + hash(auditKey(r)) + hash(r.ts) : r.id; put(col, id, r, bucketOf(col, id, r)); }
  for (const k of SETTING_KEYS) put('settings', k, {v: s[k]}, {sub: 'buckets', id: 'settings~~0'});
  return m;
}
let shadow = new Map(), remote = new Map(), remoteReady = {buckets: false, hrdata: false}, rebuildTimer = null, unwatch = [];
const companyShadow = () => { shadow = flatten(state); };
function companyData() {
  const d = {version: DATA_VERSION, audit: [], accounts: [], categories: [], tx: [], debts: [], security: state?.security || {autoLockMin: 5}};
  for (const col of Object.keys(SYNC_COLS)) d[col] ||= [];
  for (const [bid, r] of remote) {
    const col = bid.split('~')[0];
    if (col === 'settings') { for (const k of SETTING_KEYS) if (r[k]) d[k] = r[k].v; continue; }
    if (d[col]) d[col].push(...Object.values(r));
  }
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
    group(e).set[e.rid] = e.rec;
    // data yang pindah kelompok (mis. tanggal berubah) dihapus dari kelompok lama
    if (old && old.bid !== e.bid) group(old).del.push(old.rid);
  }
  for (const [k, o] of shadow) if (!now.has(k)) group(o).del.push(o.rid);
  shadow = now;
  try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch {}
  if (!groups.size) return Promise.resolve();
  setSync('Menyimpan ke server…');
  const writes = [...groups.values()].map(g => Cloud.writeBucket(company.id, g.sub, g.bid, g.set, g.del));
  return Promise.allSettled(writes).then(res => {
    if (res.some(r => r.status === 'rejected')) { toast('Sebagian perubahan ditolak server: peran Anda tidak mengizinkannya.'); companyRebuild(); }
    else setSync('Tersimpan di server · ' + new Date().toLocaleTimeString('id-ID', {hour: '2-digit', minute: '2-digit'}));
  });
}
function companyRebuild() {
  // Data dari pengguna lain ditunda selama formulir terbuka agar isian tidak hilang, lalu dicoba lagi
  clearTimeout(rebuildTimer);
  if (document.querySelector('dialog[open]')) { rebuildTimer = setTimeout(companyRebuild, 1000); return; }
  try { state = sanitizeState(companyData()); } catch { return; }
  companyShadow(); migrate(); memo = null; renderAll();
  try { localStorage.setItem(storeKey, JSON.stringify(state)); } catch {}
}
function companyWatch() {
  return new Promise(resolve => {
    const done = () => { if (remoteReady.buckets && remoteReady.hrdata) resolve(); };
    const apply = (sub, changes) => {
      for (const c of changes) { if (c.removed) remote.delete(c.id); else remote.set(c.id, c.r); }
      const first = !remoteReady[sub]; remoteReady[sub] = true;
      if (first) done(); else if (state) companyRebuild();
    };
    unwatch.push(Cloud.watchBuckets(company.id, 'buckets', c => apply('buckets', c), () => { remoteReady.buckets = true; done(); }));
    unwatch.push(Cloud.watchBuckets(company.id, 'hrdata', c => apply('hrdata', c), () => { remoteReady.hrdata = true; done(); }));
  });
}
async function openCompany() {
  let cid = null, member = null, co = null;
  try { cid = await Cloud.getCompanyId(); if (cid) { member = await Cloud.getMember(cid); co = await Cloud.getCompany(cid); } } catch { return false; }
  if (!cid || !member?.active) return false;
  company = {id: cid, name: co?.name || '', role: member.role};
  storeKey = KEY + ':co:' + cid;
  await companyWatch();
  setSync('Tersinkron dengan server perusahaan');
  start(companyData());
  return true;
}
function applyRole() {
  const role = company?.role || 'owner', views = ROLE_VIEWS[role];
  document.body.dataset.role = role;
  document.querySelectorAll('nav button').forEach(b => { b.hidden = !!views && !views.includes(b.dataset.view); });
  document.querySelectorAll('#view-pengaturan .card').forEach((c, i) => { c.hidden = i > 0 && !['owner', 'finance'].includes(role); });
  $('btnWipe').hidden = role !== 'owner';
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
      const cid = await Cloud.createCompany(name.trim().slice(0, 120), cloudInfo?.username || '');
      company = {id: cid, name: name.trim(), role: 'owner'}; storeKey = KEY + ':co:' + cid; vault = null; shadow = new Map();
      log('tambah', 'perusahaan', '', `Perusahaan bersama dibuat: ${name.trim()}`);
      await companyPersist();
      toast('Perusahaan dibuat. Memuat ulang…'); setTimeout(() => location.reload(), 1200);
    } catch (e) { company = null; toast(e?.code === 'permission-denied' ? 'Ditolak server: aturan Firestore terbaru belum dipasang.' : 'Gagal membuat perusahaan.'); }
  },
  joinCompany: async () => {
    const code = prompt('Masukkan kode undangan:'); if (!code?.trim()) return;
    try { await Cloud.joinCompany(code.trim().toLowerCase(), cloudInfo?.username || ''); location.reload(); }
    catch { toast('Kode undangan tidak berlaku.'); }
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
  customers: {col: 'customers', title: 'Pelanggan', fields: [text('name', 'Nama', true), text('pic', 'Kontak (PIC)'), text('phone', 'Telepon'), text('email', 'Email'), text('npwp', 'NPWP'), {k: 'terms', label: 'Tempo (hari)', type: 'int'}, {k: 'address', label: 'Alamat', type: 'area'}, {k: 'wapu', label: 'Pelanggan WAPU', type: 'check'}]},
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
    after: k => { const t = state.tx.find(x => x.kasbonId === k.id), data = {type: 'out', date: k.date, ref: k.ref, amount: k.amount, accountId: k.accountId, categoryId: sysCat(ACC_KASBON.code)?.id, toAccountId: null, desc: `Kasbon ${empOf(k.empId)?.name || ''}`, kasbonId: k.id}; if (t) Object.assign(t, data); else state.tx.push({id: uid(), created: Date.now(), ...data}); },
    gone: k => { state.tx = state.tx.filter(x => x.kasbonId !== k.id); }},
};
const formKeyOf = () => ({wh: 'wh', customers: 'customers', centers: 'centers', assets: 'assets', journals: 'journals', budgets: 'budgets'}[erpTab]);
function openForm(key, id) {
  formKey = key; const f = FORMS[key];
  formRec = id ? state[f.col].find(x => x.id === id) : null;
  const v = formRec ? (f.load ? f.load(formRec) : formRec) : {date: today(), to: today(), year: today().slice(0, 4)};
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
    if ((x.req || x.type === 'date') && !d[x.k]) return fail('Isi ' + x.label.toLowerCase());
    if (x.type === 'date' && !cleanDate(d[x.k])) return fail('Tanggal tidak valid');
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
  for (const a of state.adjusts) for (const l of a.lines) put('', l.itemId, l.diff);
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
    log('setuju', 'cuti', l.id, `${empOf(l.empId)?.name} ${l.date} s.d. ${l.to}`); save();
  },
});
