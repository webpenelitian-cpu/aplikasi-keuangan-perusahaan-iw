// Konfigurasi Firebase untuk login & penyimpanan server.
// Nilainya dari Firebase Console → Project settings → General → Your apps → SDK setup and configuration.
// Nilai ini memang publik (bukan rahasia); keamanan data dijaga oleh aturan di firestore.rules.
// Kosongkan semua nilai untuk memakai aplikasi tanpa server (data hanya di perangkat).
export default {
  apiKey: 'AIzaSyBLpOzIbdCxlsH5RbS0tdaFwESnCCzSZGk',
  authDomain: 'aplikasi-keuangan-perusahaan.firebaseapp.com',
  projectId: 'aplikasi-keuangan-perusahaan',
  appId: '1:301640242929:web:7d99a5d94b76dfe7c53b50',
};
// App Check (opsional): kunci situs reCAPTCHA v3 dari Firebase Console → App Check → Apps → Register.
// Bila diisi, hanya aplikasi ini yang bisa memakai server Firebase proyek; skrip lain yang meniru akan ditolak
// setelah App Check di-"Enforce" untuk Firestore dan Authentication. Kosongkan untuk menonaktifkan.
export const appCheckKey = '';
