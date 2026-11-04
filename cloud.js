// Login (Google atau username + kata sandi) dan penyimpanan data di Firebase.
// SDK Firebase dimuat saat dibutuhkan; bila gagal (offline), aplikasi tetap jalan dengan data di perangkat.
import config from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const CHUNK = 800000; // batas 1 MB per dokumen Firestore
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
// Akun username dibuat dengan alamat email fiktif di domain .invalid (RFC 2606) yang tak pernah bisa menerima email,
// sehingga tidak ada pihak luar yang bisa mengambil alih akun lewat "lupa kata sandi".
const emailOf = u => `${u}@pengguna.invalid`;
const err = (code, msg = code) => Object.assign(new Error(msg), {code});

let A, F, auth, db, user = null;

export const enabled = () => !!(config.apiKey && config.projectId && config.authDomain && config.appId);

export async function init() {
  if (!enabled()) return {enabled: false};
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`)]);
    A = authMod; F = fsMod;
    const app = appMod.initializeApp(config);
    auth = A.getAuth(app);
    auth.languageCode = 'id';
    // Salinan data di perangkat: aplikasi tetap bisa dipakai offline dan kuota baca server lebih hemat
    try { db = F.initializeFirestore(app, {localCache: F.persistentLocalCache({tabManager: F.persistentMultipleTabManager()})}); }
    catch { db = F.getFirestore(app); }
    try { await A.getRedirectResult(auth); } catch {}
    user = await new Promise(res => { const off = A.onAuthStateChanged(auth, u => { off(); res(u); }); });
    return {enabled: true, online: true, user};
  } catch (error) {
    return {enabled: true, online: false, user: null, error};
  }
}

export async function signInGoogle() {
  const p = new A.GoogleAuthProvider();
  p.setCustomParameters({prompt: 'select_account'});
  try { user = (await A.signInWithPopup(auth, p)).user; return user; }
  catch (e) {
    // Popup diblokir (mis. di aplikasi terpasang iOS) → pakai alihan halaman
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      await A.signInWithRedirect(auth, p); return null;
    }
    throw e;
  }
}

export async function signInUsername(username, pw) {
  user = (await A.signInWithEmailAndPassword(auth, emailOf(username), pw)).user;
  return user;
}

export async function registerUsername(username, pw) {
  const cred = await A.createUserWithEmailAndPassword(auth, emailOf(username), pw);
  user = cred.user;
  try { await claimUsername(username); }
  catch (e) { await A.deleteUser(cred.user).catch(() => {}); user = null; throw e; }
  return user;
}

// Username unik dicatat di koleksi usernames/{username}; aturan server menolak bila sudah dimiliki orang lain
export async function claimUsername(username) {
  if (!USERNAME_RE.test(username)) throw err('username-invalid');
  await F.runTransaction(db, async tx => {
    const ref = F.doc(db, 'usernames', username);
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().uid !== user.uid) throw err('username-taken');
    if (!snap.exists()) tx.set(ref, {uid: user.uid});
    tx.set(F.doc(db, 'users', user.uid), {username, createdAt: F.serverTimestamp()}, {merge: true});
  });
}

export async function getUsername() {
  const snap = await F.getDoc(F.doc(db, 'users', user.uid));
  return snap.exists() ? snap.data().username || null : null;
}

export const currentUser = () => user;

const dataDoc = id => F.doc(db, 'users', user.uid, 'data', id);

export async function pull() {
  const meta = await F.getDoc(dataDoc('meta'));
  if (!meta.exists()) return null;
  const m = meta.data();
  const parts = await Promise.all(Array.from({length: m.chunks}, (_, i) => F.getDoc(dataDoc('c' + i))));
  return {payload: parts.map(p => p.data()?.s || '').join(''), updatedAt: m.updatedAt, deviceId: m.deviceId};
}

// Simpan ke server secara atomik. `base` = versi server terakhir yang diketahui perangkat ini;
// bila server sudah diubah perangkat lain sejak itu, penyimpanan ditolak (konflik) agar tidak menimpa data.
export async function push(payload, updatedAt, deviceId, base) {
  const n = Math.max(1, Math.ceil(payload.length / CHUNK));
  await F.runTransaction(db, async tx => {
    const snap = await tx.get(dataDoc('meta'));
    const cur = snap.exists() ? snap.data() : null;
    if (cur && cur.updatedAt !== base && cur.deviceId !== deviceId) throw err('conflict');
    for (let i = 0; i < n; i++) tx.set(dataDoc('c' + i), {s: payload.slice(i * CHUNK, (i + 1) * CHUNK)});
    for (let i = n; i < (cur?.chunks || 0); i++) tx.delete(dataDoc('c' + i));
    tx.set(dataDoc('meta'), {chunks: n, updatedAt, deviceId, encrypted: payload.startsWith('{"enc":1')});
  });
}

export async function wipe() {
  const snap = await F.getDoc(dataDoc('meta'));
  const batch = F.writeBatch(db);
  for (let i = 0; i < Math.max(snap.exists() ? snap.data().chunks : 0, 1); i++) batch.delete(dataDoc('c' + i));
  batch.delete(dataDoc('meta'));
  await batch.commit();
}

// Hapus akun: data keuangan, username, profil, lalu akun login (wajib login ulang < 5 menit terakhir)
export async function deleteAccount(username) {
  const last = Date.parse(user?.metadata?.lastSignInTime || 0);
  if (!last || Date.now() - last > 5 * 60 * 1000) throw err('recent-login');
  await wipe();
  if (username) await F.deleteDoc(F.doc(db, 'usernames', username)).catch(() => {});
  await F.deleteDoc(F.doc(db, 'users', user.uid)).catch(() => {});
  await A.deleteUser(user);
  user = null;
}

export function watch(cb) {
  return F.onSnapshot(dataDoc('meta'), snap => { if (snap.exists() && !snap.metadata.hasPendingWrites) cb(snap.data()); }, () => {});
}

// Menunggu perubahan yang masih antre terkirim ke server; false bila belum selesai dalam 8 detik
export function flush() {
  return Promise.race([F.waitForPendingWrites(db).then(() => true), new Promise(r => setTimeout(() => r(false), 8000))]);
}

export async function signOut() {
  await A.signOut(auth); user = null;
  // Salinan data perusahaan di perangkat ikut dihapus saat keluar
  try { await F.terminate(db); await F.clearIndexedDbPersistence(db); } catch {}
}

/* ---------- Perusahaan bersama: anggota, peran, undangan, data per kelompok ---------- */
const coDoc = (cid, ...p) => F.doc(db, 'companies', cid, ...p);

export async function getCompanyId() {
  const snap = await F.getDoc(F.doc(db, 'users', user.uid));
  return snap.exists() ? snap.data().companyId || null : null;
}
export async function getCompany(cid) { const s = await F.getDoc(coDoc(cid)); return s.exists() ? s.data() : null; }
export async function getMember(cid) { const s = await F.getDoc(coDoc(cid, 'members', user.uid)); return s.exists() ? s.data() : null; }

export async function createCompany(name, memberName) {
  const ref = F.doc(F.collection(db, 'companies'));
  const b = F.writeBatch(db);
  b.set(ref, {name, ownerUid: user.uid, createdAt: F.serverTimestamp()});
  b.set(F.doc(ref, 'members', user.uid), {role: 'owner', name: memberName, active: true});
  b.set(F.doc(db, 'users', user.uid), {companyId: ref.id}, {merge: true});
  await b.commit();
  return ref.id;
}
export async function createInvite(cid, role) {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(15)), x => x.toString(16).padStart(2, '0')).join('');
  await F.setDoc(F.doc(db, 'invites', code), {cid, role, expires: Date.now() + 7 * 864e5, by: user.uid});
  return code;
}
export async function joinCompany(code, memberName) {
  const inv = await F.getDoc(F.doc(db, 'invites', code));
  if (!inv.exists() || inv.data().expires < Date.now()) throw err('invite-invalid');
  const {cid, role} = inv.data();
  const b = F.writeBatch(db);
  b.set(coDoc(cid, 'members', user.uid), {role, name: memberName, active: true, invite: code});
  b.delete(F.doc(db, 'invites', code));
  b.set(F.doc(db, 'users', user.uid), {companyId: cid}, {merge: true});
  await b.commit();
  return cid;
}
export async function listMembers(cid) {
  const s = await F.getDocs(F.collection(db, 'companies', cid, 'members'));
  return s.docs.map(d => ({uid: d.id, ...d.data()}));
}
export function watchMember(cid, cb) {
  return F.onSnapshot(coDoc(cid, 'members', user.uid), s => cb(s.exists() ? s.data() : null), () => cb(null));
}
export const setMember = (cid, uid, data) => F.updateDoc(coDoc(cid, 'members', uid), data);
export const removeMember = (cid, uid) => F.deleteDoc(coDoc(cid, 'members', uid));
export async function leaveCompany(cid) {
  const b = F.writeBatch(db);
  b.delete(coDoc(cid, 'members', user.uid));
  b.set(F.doc(db, 'users', user.uid), {companyId: F.deleteField()}, {merge: true});
  await b.commit();
}
// Memantau satu koleksi data; cb menerima perubahan dokumen, onDenied bila peran tidak boleh membukanya
export function watchBuckets(cid, sub, cb, onDenied) {
  return F.onSnapshot(F.collection(db, 'companies', cid, sub), snap => {
    cb(snap.docChanges().map(c => ({id: c.doc.id, removed: c.type === 'removed', r: c.doc.data().r || {}})));
  }, onDenied);
}
// Satu kelompok = satu penulisan; hanya data yang berubah yang ditimpa, jadi dua pengguna tidak saling menghapus
export function writeBucket(cid, sub, id, set, del) {
  const data = {r: {...set}}, paths = Object.keys(set).map(k => new F.FieldPath('r', k));
  for (const k of del) { data.r[k] = F.deleteField(); paths.push(new F.FieldPath('r', k)); }
  return F.setDoc(F.doc(db, 'companies', cid, sub, id), data, {mergeFields: paths});
}
