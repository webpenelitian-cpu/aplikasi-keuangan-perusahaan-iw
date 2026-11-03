// Login (Google atau username + kata sandi) dan penyimpanan data di Firebase.
// SDK Firebase dimuat saat dibutuhkan; bila gagal (offline), aplikasi tetap jalan dengan data di perangkat.
import config from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const CHUNK = 800000; // batas 1 MB per dokumen Firestore
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
// Akun username dibuat dengan alamat email fiktif di domain .invalid (RFC 2606) yang tak pernah bisa menerima email,
// sehingga tidak ada pihak luar yang bisa mengambil alih akun lewat "lupa kata sandi".
const emailOf = u => `${u}@pengguna.invalid`;

let A, F, auth, db, user = null, lastChunks = 0;

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
    db = F.getFirestore(app);
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
  if (!USERNAME_RE.test(username)) throw Object.assign(new Error('bad'), {code: 'username-invalid'});
  await F.runTransaction(db, async tx => {
    const ref = F.doc(db, 'usernames', username);
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().uid !== user.uid) throw Object.assign(new Error('taken'), {code: 'username-taken'});
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
  lastChunks = m.chunks;
  const parts = await Promise.all(Array.from({length: m.chunks}, (_, i) => F.getDoc(dataDoc('c' + i))));
  return {payload: parts.map(p => p.data()?.s || '').join(''), updatedAt: m.updatedAt, deviceId: m.deviceId};
}

export async function push(payload, updatedAt, deviceId) {
  const n = Math.max(1, Math.ceil(payload.length / CHUNK));
  const batch = F.writeBatch(db);
  for (let i = 0; i < n; i++) batch.set(dataDoc('c' + i), {s: payload.slice(i * CHUNK, (i + 1) * CHUNK)});
  for (let i = n; i < lastChunks; i++) batch.delete(dataDoc('c' + i));
  batch.set(dataDoc('meta'), {chunks: n, updatedAt, deviceId, encrypted: payload.startsWith('{"enc":1')});
  await batch.commit();
  lastChunks = n;
}

export async function wipe() {
  const batch = F.writeBatch(db);
  for (let i = 0; i < Math.max(lastChunks, 1); i++) batch.delete(dataDoc('c' + i));
  batch.delete(dataDoc('meta'));
  await batch.commit();
  lastChunks = 0;
}

export function watch(cb) {
  return F.onSnapshot(dataDoc('meta'), snap => { if (snap.exists() && !snap.metadata.hasPendingWrites) cb(snap.data()); }, () => {});
}

export async function signOut() { await A.signOut(auth); user = null; }
