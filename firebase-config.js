// firebase-config.js
// Satu-satunya tempat config Firebase. Semua file lain import dari sini.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =========================================================
// 🔥 GANTI CONFIG INI DENGAN PUNYA LU
// =========================================================
apiKey: "AIzaSyCqKxhxy1-i-tMopV9TOu_w1qE9PTf6AqE",
  authDomain: "mhszksp.firebaseapp.com",
  projectId: "mhszksp",
  storageBucket: "mhszksp.firebasestorage.app",
  messagingSenderId: "1003892042214",
  appId: "1:1003892042214:web:df7a4909125fe9b6590e27"
};
// =========================================================

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);