// ============================================================
// app.js — Logika Authentication (Login / Register / Guest)
// ============================================================

import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ============================================================
   CONSTANTS & STATE
============================================================ */
const DOMAIN = "@gpyth.chat";
const TNC_KEY = "gpyth_tnc_accepted";
const MIN_LOADING_MS = 1500;
const startTime = Date.now();

let initialAuthResolved = false;

/* ============================================================
   HELPERS
============================================================ */
function $(id) {
  return document.getElementById(id);
}

function showScreen(name) {
  const screens = {
    loading: $("loadingScreen"),
    tnc:     $("tncScreen"),
    auth:    $("authScreen")
  };
  Object.values(screens).forEach((el) => {
    if (el) el.classList.add("hidden");
  });
  if (screens[name]) screens[name].classList.remove("hidden");
}

function showError(message) {
  const box = $("authError");
  if (!box) return;
  box.textContent = message;
  box.classList.add("show");
}

function clearError() {
  const box = $("authError");
  if (!box) return;
  box.textContent = "";
  box.classList.remove("show");
}

function setButtonLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = "Memproses...";
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText) {
      btn.textContent = btn.dataset.originalText;
    }
  }
}

function friendlyAuthError(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Username atau password salah.";
    case "auth/email-already-in-use":
      return "Username sudah dipakai.";
    case "auth/weak-password":
      return "Password minimal 6 karakter.";
    case "auth/invalid-email":
      return "Format username tidak valid.";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan. Coba lagi nanti.";
    case "auth/network-request-failed":
      return "Koneksi internet bermasalah.";
    default:
      return "Terjadi kesalahan: " + (code || "unknown");
  }
}

/* ============================================================
   T&C LOGIC
============================================================ */
function isTncAccepted() {
  try {
    return localStorage.getItem(TNC_KEY) === "true";
  } catch {
    return false;
  }
}

function acceptTnc() {
  try {
    localStorage.setItem(TNC_KEY, "true");
  } catch {
    /* storage bisa gagal di private mode — abaikan */
  }
}

/* ============================================================
   SCREEN FLOW
============================================================ */
function proceedAfterLoading() {
  const loading = $("loadingScreen");
  if (loading) {
    loading.classList.add("fade-out");
    setTimeout(() => loading.classList.add("hidden"), 400);
  }
  if (isTncAccepted()) {
    showScreen("auth");
    // coba putar audio bila ada source
    tryPlayLoadingAudio();
  } else {
    showScreen("tnc");
  }
}

function tryPlayLoadingAudio() {
  const audio = $("loadingAudio");
  if (!audio) return;
  if (!audio.querySelector("source") && !audio.src) return;
  audio.volume = 0.35;
  const p = audio.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

/* ============================================================
   EVENT LISTENERS (ALL GUARDED WITH ID CHECK)
============================================================ */

// --- T&C ACCEPT ---
if (document.getElementById("btnAcceptTnc")) {
  document.getElementById("btnAcceptTnc").addEventListener("click", () => {
    acceptTnc();
    showScreen("auth");
    tryPlayLoadingAudio();
  });
}

// --- SWITCH: LOGIN -> REGISTER ---
if (document.getElementById("btnShowRegister")) {
  document.getElementById("btnShowRegister").addEventListener("click", () => {
    clearError();
    const loginForm = $("loginForm");
    const regForm = $("registerForm");
    if (loginForm) loginForm.classList.add("hidden");
    if (regForm) regForm.classList.remove("hidden");
    const u = $("regUsername");
    if (u) u.focus();
  });
}

// --- SWITCH: REGISTER -> LOGIN ---
if (document.getElementById("btnShowLogin")) {
  document.getElementById("btnShowLogin").addEventListener("click", () => {
    clearError();
    const loginForm = $("loginForm");
    const regForm = $("registerForm");
    if (regForm) regForm.classList.add("hidden");
    if (loginForm) loginForm.classList.remove("hidden");
    const u = $("loginUsername");
    if (u) u.focus();
  });
}

// --- LOGIN SUBMIT ---
if (document.getElementById("loginForm")) {
  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const usernameEl = $("loginUsername");
    const passwordEl = $("loginPassword");
    const btn = $("btnLogin");

    const username = (usernameEl?.value || "").trim().toLowerCase();
    const password = passwordEl?.value || "";

    if (!username || !password) {
      showError("Isi username dan password dulu.");
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      showError("Username tidak valid.");
      return;
    }

    setButtonLoading(btn, true);
    try {
      await signInWithEmailAndPassword(auth, username + DOMAIN, password);
      // redirect ditangani oleh onAuthStateChanged
    } catch (err) {
      showError(friendlyAuthError(err?.code));
      setButtonLoading(btn, false);
    }
  });
}

// --- REGISTER SUBMIT ---
if (document.getElementById("registerForm")) {
  document.getElementById("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const usernameEl = $("regUsername");
    const passwordEl = $("regPassword");
    const confirmEl = $("regConfirm");
    const btn = $("btnRegister");

    const username = (usernameEl?.value || "").trim().toLowerCase();
    const password = passwordEl?.value || "";
    const confirm  = confirmEl?.value || "";

    if (!username || !password || !confirm) {
      showError("Isi semua kolom.");
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      showError("Username 3–20 karakter (huruf/angka/underscore).");
      return;
    }
    if (password.length < 6) {
      showError("Password minimal 6 karakter.");
      return;
    }
    if (password !== confirm) {
      showError("Konfirmasi password tidak cocok.");
      return;
    }

    setButtonLoading(btn, true);
    try {
      // cek ketersediaan username
      const unameRef = doc(db, "usernames", username);
      const unameSnap = await getDoc(unameRef);
      if (unameSnap.exists()) {
        showError("Username sudah dipakai, coba yang lain.");
        setButtonLoading(btn, false);
        return;
      }

      const cred = await createUserWithEmailAndPassword(auth, username + DOMAIN, password);

      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          username,
          displayName: username,
          bio: "",
          photoURL: null,
          banner: null,
          musicLink: "",
          isVerified: false,
          isPremium: false,
          isAdmin: username === "maklov1",
          isGuest: false,
          followers: 0,
          following: 0,
          followingList: [],
          createdAt: serverTimestamp()
        });
        await setDoc(unameRef, { uid: cred.user.uid, username });
      } catch (docErr) {
        // rollback auth supaya user bisa daftar ulang
        try { await signOut(auth); } catch {}
        showError("Gagal membuat profil. Coba lagi.");
        setButtonLoading(btn, false);
        return;
      }
      // onAuthStateChanged akan redirect ke main.html
    } catch (err) {
      showError(friendlyAuthError(err?.code));
      setButtonLoading(btn, false);
    }
  });
}

// --- GUEST MODE ---
if (document.getElementById("btnGuest")) {
  document.getElementById("btnGuest").addEventListener("click", async () => {
    clearError();
    const btn = $("btnGuest");
    setButtonLoading(btn, true);
    try {
      const cred = await signInAnonymously(auth);
      // buat user doc guest
      try {
        await setDoc(doc(db, "users", cred.user.uid), {
          uid: cred.user.uid,
          username: "Tamu_" + cred.user.uid.slice(0, 6),
          displayName: "Tamu",
          bio: "Mode tamu (read-only)",
          photoURL: null,
          banner: null,
          musicLink: "",
          isVerified: false,
          isPremium: false,
          isAdmin: false,
          isGuest: true,
          followers: 0,
          following: 0,
          followingList: [],
          createdAt: serverTimestamp()
        });
      } catch (docErr) {
        // tidak fatal — main.js akan repair bila perlu
        console.warn("[app.js] gagal buat user doc guest:", docErr);
      }
      // redirect via onAuthStateChanged
    } catch (err) {
      showError(friendlyAuthError(err?.code));
      setButtonLoading(btn, false);
    }
  });
}

/* ============================================================
   ENTER-KEY FALLBACK (input field -> submit)
   (Default behavior <form> sudah handle)
============================================================ */

/* ============================================================
   AUTH STATE OBSERVER
============================================================ */
onAuthStateChanged(auth, (user) => {
  const elapsed = Date.now() - startTime;
  const remaining = Math.max(0, MIN_LOADING_MS - elapsed);

  if (user) {
    // Sudah login — redirect setelah loading minimal
    setTimeout(() => {
      window.location.href = "main.html";
    }, remaining);
    return;
  }

  // Belum login — tampilkan T&C / Auth setelah loading minimal
  if (!initialAuthResolved) {
    initialAuthResolved = true;
    setTimeout(() => {
      // cek ulang, siapa tahu user login selama delay
      if (!auth.currentUser) proceedAfterLoading();
    }, remaining);
  }
});