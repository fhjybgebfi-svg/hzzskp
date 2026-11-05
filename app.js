// app.js
// PART 1 — Logika Auth (Login / Register / Guest / Redirect)
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// =========================================================
// CONSTANTS
// =========================================================
const TOS_KEY = "gpyth_tos_agreed";
const REDIRECT_URL = "main.html";

// =========================================================
// DOM HELPERS
// =========================================================
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  const screens = document.querySelectorAll(".screen");
  screens.forEach(s => s.classList.remove("active"));
  const el = $(id);
  if (el) el.classList.add("active");
}

function showLoginError(msg) {
  const el = $("login-error");
  if (el) el.textContent = msg || "";
}

// =========================================================
// EMAIL HELPER
// =========================================================
function usernameToEmail(u) {
  return `${String(u).trim().toLowerCase()}@gpyth.chat`;
}

// =========================================================
// T&C SCREEN
// =========================================================
function initTosScreen() {
  const checkbox = $("tos-checkbox");
  const btn = $("btn-tos-agree");

  if (checkbox && btn) {
    checkbox.addEventListener("change", () => {
      btn.disabled = !checkbox.checked;
    });

    btn.addEventListener("click", () => {
      if (!checkbox.checked) return;
      try { localStorage.setItem(TOS_KEY, "true"); } catch (e) {}
      startLoadingFlow();
    });
  }
}

// =========================================================
// LOADING FLOW
// =========================================================
function startLoadingFlow() {
  showScreen("screen-loading");

  const audio = $("loading-audio");
  if (audio) {
    try {
      audio.volume = 0.4;
      const p = audio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (e) { /* diamkan kalau nggak ada audio */ }
  }

  const MIN_DURATION = 2500;
  const startedAt = Date.now();
  let resolved = false;

  const finish = (user) => {
    if (resolved) return;
    resolved = true;
    const elapsed = Date.now() - startedAt;
    const wait = Math.max(0, MIN_DURATION - elapsed);
    setTimeout(() => {
      if (audio) try { audio.pause(); } catch (e) {}
      if (user) {
        window.location.href = REDIRECT_URL;
      } else {
        showScreen("screen-login");
      }
    }, wait);
  };

  let unsub = null;
  try {
    unsub = onAuthStateChanged(auth, (user) => {
      if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
      finish(user);
    });
  } catch (e) {
    console.error("onAuthStateChanged err:", e);
    finish(null);
  }

  // Fallback kalau onAuthStateChanged nggak trigger
  setTimeout(() => {
    if (resolved) return;
    finish(auth ? auth.currentUser : null);
  }, MIN_DURATION + 2500);
}

// =========================================================
// AUTH ERROR MAPPER
// =========================================================
function mapAuthError(code) {
  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Username atau password salah.";
    case "auth/email-already-in-use":
      return "Username sudah dipakai, coba yang lain.";
    case "auth/weak-password":
      return "Password terlalu lemah (minimal 6 karakter).";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan. Coba lagi nanti.";
    case "auth/network-request-failed":
      return "Koneksi bermasalah. Cek internet lu.";
    case "auth/invalid-api-key":
      return "API key Firebase salah. Cek firebase-config.js.";
    case "auth/operation-not-allowed":
      return "Metode login ini belum diaktifkan di Firebase Console.";
    case "auth/invalid-email":
      return "Format username tidak valid.";
    default:
      return "Terjadi kesalahan. Coba lagi.";
  }
}

// =========================================================
// VALIDASI INPUT
// =========================================================
function validateInputs() {
  const userInput = $("login-username");
  const passInput = $("login-password");
  const u = userInput ? userInput.value.trim() : "";
  const p = passInput ? passInput.value : "";

  if (!u || !p) {
    showLoginError("Username & password wajib diisi.");
    return null;
  }
  if (u.length < 3) {
    showLoginError("Username minimal 3 karakter.");
    return null;
  }
  if (p.length < 6) {
    showLoginError("Password minimal 6 karakter.");
    return null;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(u)) {
    showLoginError("Username hanya boleh huruf, angka, dan underscore (_).");
    return null;
  }
  return { username: u.toLowerCase(), password: p };
}

// =========================================================
// BIKIN DOKUMEN USER BARU
// =========================================================
async function createUserDoc(uid, username, email) {
  const ref = doc(db, "users", uid);
  const newProfile = {
    uid,
    username,
    email,
    isVerified: false,
    isAdmin: false,
    isPremium: false,
    followers: 0,
    following: 0,
    photoURL: "",
    bannerURL: "",
    bio: "",
    musicURL: "",
    typingIn: null,
    lastSeen: serverTimestamp(),
    createdAt: serverTimestamp()
  };
  await setDoc(ref, newProfile);
  return newProfile;
}

// =========================================================
// LOGIN FORM
// =========================================================
function initLoginForm() {
  const form = $("login-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showLoginError("");

    const v = validateInputs();
    if (!v) return;

    const btn = $("btn-login");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "MEMPROSES...";
    }

    try {
      await signInWithEmailAndPassword(auth, usernameToEmail(v.username), v.password);
      window.location.href = REDIRECT_URL;
    } catch (err) {
      console.error("login err:", err);
      showLoginError(mapAuthError(err.code));
      if (btn) {
        btn.disabled = false;
        btn.textContent = "MASUK";
      }
    }
  });
}

// =========================================================
// REGISTER BUTTON
// =========================================================
function initRegisterButton() {
  const btn = $("btn-register");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    showLoginError("");

    const v = validateInputs();
    if (!v) return;

    btn.disabled = true;
    btn.textContent = "MEMBUAT AKUN...";

    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        usernameToEmail(v.username),
        v.password
      );

      // Bikin dokumen user di Firestore (kalau gagal, tetap lanjut ke main)
      try {
        await createUserDoc(cred.user.uid, v.username, usernameToEmail(v.username));
      } catch (dbErr) {
        console.warn("Gagal bikin dokumen user:", dbErr);
      }

      window.location.href = REDIRECT_URL;
    } catch (err) {
      console.error("register err:", err);
      showLoginError(mapAuthError(err.code));
      btn.disabled = false;
      btn.textContent = "DAFTAR AKUN";
    }
  });
}

// =========================================================
// GUEST BUTTON
// =========================================================
function initGuestButton() {
  const btn = $("btn-guest");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    showLoginError("");
    btn.disabled = true;
    btn.textContent = "MENGHUBUNGKAN...";

    try {
      await signInAnonymously(auth);
      try { localStorage.setItem("gpyth_guest", "true"); } catch (e) {}
      window.location.href = REDIRECT_URL;
    } catch (err) {
      console.error("guest err:", err);
      let msg = "Gagal masuk sebagai tamu.";
      if (err.code === "auth/operation-not-allowed") {
        msg = "Mode Tamu belum diaktifkan di Firebase (Authentication → Anonymous → Enable).";
      }
      showLoginError(msg);
      btn.disabled = false;
      btn.textContent = "Masuk sebagai Tamu (baca saja)";
    }
  });
}

// =========================================================
// BOOT
// =========================================================
function boot() {
  initTosScreen();
  initLoginForm();
  initRegisterButton();
  initGuestButton();

  let agreed = false;
  try { agreed = localStorage.getItem(TOS_KEY) === "true"; } catch (e) {}

  if (agreed) {
    startLoadingFlow();
  } else {
    showScreen("screen-tos");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}