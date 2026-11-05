// main.js — PART 6 (final) — Auth + Beranda + Profil + Chat + Admin + Premium + Kapsul + Call
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, query, orderBy, limit, onSnapshot, where, getDocs,
  addDoc, deleteDoc, doc, getDoc, setDoc, updateDoc,
  arrayUnion, arrayRemove, increment, writeBatch, serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  escapeHtml, parseEmojis, formatText, timeAgo, presenceLabel,
  compressImage, blobToBase64, emojiImg
} from "./utils.js";

// =========================================================
// STATE
// =========================================================
const state = {
  user: null, profile: null,
  isGuest: false, isAdmin: false,
  feedUnsub: null, profileUnsub: null, postsCountUnsub: null,
  chatListUnsub: null, messagesUnsub: null, typingUnsub: null,
  selectedImageBase64: null, posting: false, likeBusy: new Set(),
  pendingAvatar: null, pendingBanner: null, cropper: null,
  viewingUid: null, followBusy: new Set(),
  currentChatId: null, currentChat: null, currentMessages: [], replyTarget: null,
  markedRead: new Set(), userCache: {},
  mediaRecorder: null, audioChunks: [], recordStartTime: 0, recordTimerInterval: null,
  myTypingTimer: null,
  // Part 6
  pendingUnlockTime: null,
  adminSplashBase64: null,
  adminSplashLoaded: false,
  // Voice call
  peer: null, localStream: null, currentCall: null,
  callUnsub: null, incomingCallListenerUnsub: null,
  callId: null, callRole: null, callTimeout: null, muted: false
};

// =========================================================
// HELPERS
// =========================================================
const $ = (id) => document.getElementById(id);

function showToast(msg, type = "info") {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = "toast"; }, 3000);
}

function generateAvatar(initial) {
  const letter = (initial || "?").charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff2d9b"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs><rect width="80" height="80" rx="40" fill="url(#g)"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" fill="#fff" font-family="Arial,sans-serif" font-size="34" font-weight="700">${letter}</text></svg>`;
  try { return `data:image/svg+xml;base64,${btoa(svg)}`; } catch (e) { return ""; }
}

function checkGuestBlocked(action = "ini") {
  if (state.isGuest) { showToast(`Tamu tidak bisa ${action}.`, "error"); return true; }
  return false;
}

async function getUserCached(uid) {
  if (!uid) return null;
  if (state.userCache[uid] && state.userCache[uid]._fetchedAt > Date.now() - 120000) return state.userCache[uid];
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) { const data = { ...snap.data(), _fetchedAt: Date.now() }; state.userCache[uid] = data; return data; }
  } catch (e) {}
  return null;
}

// =========================================================
// TAB
// =========================================================
function switchTab(tab) {
  document.querySelectorAll(".tab-panel").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(el => el.classList.remove("active"));
  const tabEl = $(`tab-${tab}`), navEl = $(`nav-${tab}`);
  if (tabEl) tabEl.classList.add("active");
  if (navEl) navEl.classList.add("active");
  const main = document.querySelector(".main-content");
  if (main) main.scrollTop = 0;
}
function initNav() {
  ["beranda", "chat", "grup", "profil"].forEach(tab => {
    const btn = $(`nav-${tab}`);
    if (btn) btn.addEventListener("click", () => switchTab(tab));
  });
}

// =========================================================
// PROFIL
// =========================================================
async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) return { id: snap.id, ...snap.data() };
    const uname = user.isAnonymous ? "Tamu" : (user.email ? user.email.split("@")[0] : "user");
    const np = {
      uid: user.uid, username: uname, email: user.email || "",
      isVerified: false, isAdmin: false, isPremium: false,
      followers: 0, following: 0, followersList: [], followingList: [],
      photoURL: "", bannerURL: "", bio: "", musicURL: "", typingIn: null,
      lastSeen: serverTimestamp(), createdAt: serverTimestamp()
    };
    await setDoc(ref, np, { merge: true });
    return np;
  } catch (e) { console.error("ensureUserDoc err:", e); return null; }
}

function renderTopbar() {
  const p = state.profile || {};
  const uname = p.username || (state.isGuest ? "Tamu" : "User");
  if ($("topbar-username")) $("topbar-username").textContent = uname;
  if ($("topbar-avatar")) $("topbar-avatar").src = p.photoURL || generateAvatar(uname);
  if ($("topbar-verified")) $("topbar-verified").classList.toggle("hidden", !p.isVerified);
  if ($("topbar-admin")) $("topbar-admin").classList.toggle("hidden", !state.isAdmin);
  if ($("topbar-premium")) $("topbar-premium").classList.toggle("hidden", !p.isPremium);
  if ($("topbar-status")) {
    $("topbar-status").textContent = state.isGuest ? "Mode Tamu" : "Online";
    $("topbar-status").style.color = state.isGuest ? "#9090a8" : "#22c55e";
  }
}

function renderProfilPage() {
  const p = state.profile || {};
  const uname = p.username || (state.isGuest ? "Tamu" : "User");
  if ($("profil-username")) $("profil-username").textContent = uname;
  if ($("profil-avatar")) $("profil-avatar").src = p.photoURL || generateAvatar(uname);
  if ($("profil-bio")) $("profil-bio").innerHTML = p.bio ? parseEmojis(p.bio) : "Belum ada bio.";
  if ($("stat-followers")) $("stat-followers").textContent = String(p.followers ?? 0);
  if ($("stat-following")) $("stat-following").textContent = String(p.following ?? 0);
  if ($("profil-verified")) $("profil-verified").classList.toggle("hidden", !p.isVerified);
  if ($("profil-admin")) $("profil-admin").classList.toggle("hidden", !state.isAdmin);
  if ($("profil-premium")) $("profil-premium").classList.toggle("hidden", !p.isPremium);
  if ($("menu-admin")) $("menu-admin").classList.toggle("hidden", !state.isAdmin);
  const banner = $("profil-banner");
  if (banner) {
    if (p.bannerURL) { banner.style.backgroundImage = `url(${p.bannerURL})`; banner.classList.add("has-image"); }
    else { banner.style.backgroundImage = ""; banner.classList.remove("has-image"); }
  }
  if (state.isGuest) {
    ["btn-edit-profil", "btn-bagikan", "fab-beranda", "fab-chat", "fab-grup"].forEach(id => {
      const el = $(id);
      if (el) { el.disabled = true; el.style.opacity = "0.4"; el.style.cursor = "not-allowed"; }
    });
  }
  renderTopbar();
}

function startProfileListener() {
  if (state.profileUnsub) { try { state.profileUnsub(); } catch (e) {} }
  if (!state.user) return;
  state.profileUnsub = onSnapshot(doc(db, "users", state.user.uid), (snap) => {
    if (snap.exists()) { state.profile = snap.data(); renderProfilPage(); }
  }, (err) => console.warn("profile onSnapshot err:", err));
}

function startPostsCountListener() {
  if (state.postsCountUnsub) { try { state.postsCountUnsub(); } catch (e) {} }
  if (!state.user) return;
  const q = query(collection(db, "posts"), where("uid", "==", state.user.uid));
  state.postsCountUnsub = onSnapshot(q, (snap) => {
    if ($("stat-posts")) $("stat-posts").textContent = String(snap.size);
  }, (err) => console.warn("postsCount err:", err));
}

// =========================================================
// LOGOUT
// =========================================================
function initLogout() {
  const btn = $("btn-logout");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("Keluar dari akun?")) return;
    btn.disabled = true;
    try {
      [state.feedUnsub, state.profileUnsub, state.postsCountUnsub, state.chatListUnsub,
       state.messagesUnsub, state.typingUnsub, state.callUnsub, state.incomingCallListenerUnsub].forEach(u => {
        if (u) try { u(); } catch (e) {}
      });
      endCall(true);
      if (state.peer) { try { state.peer.destroy(); } catch (e) {} }
      await signOut(auth);
      try { localStorage.removeItem("gpyth_guest"); } catch (e) {}
      window.location.href = "index.html";
    } catch (e) { showToast("Gagal logout.", "error"); btn.disabled = false; }
  });
}

// =========================================================
// COMPOSER
// =========================================================
function openComposer() {
  if (checkGuestBlocked("membuat postingan")) return;
  state.selectedImageBase64 = null;
  if ($("composer-text")) $("composer-text").value = "";
  if ($("composer-image-preview")) $("composer-image-preview").classList.add("hidden");
  if ($("composer-image")) $("composer-image").src = "";
  if ($("composer-counter")) $("composer-counter").textContent = "0/500";
  if ($("composer-submit")) { $("composer-submit").disabled = false; $("composer-submit").textContent = "Posting"; }
  if ($("composer-file")) $("composer-file").value = "";
  if ($("composer-modal")) $("composer-modal").classList.remove("hidden");
  setTimeout(() => $("composer-text")?.focus(), 100);
}
function closeComposer() {
  if ($("composer-modal")) $("composer-modal").classList.add("hidden");
  state.selectedImageBase64 = null;
}
async function handleImagePick(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  if ($("composer-image-preview")) $("composer-image-preview").classList.remove("hidden");
  try {
    const base64 = await compressImage(file, 900, 0.7);
    state.selectedImageBase64 = base64;
    if ($("composer-image")) $("composer-image").src = base64;
  } catch (err) {
    showToast(err.message || "Gagal proses foto.", "error");
    if ($("composer-image-preview")) $("composer-image-preview").classList.add("hidden");
    state.selectedImageBase64 = null;
    if ($("composer-file")) $("composer-file").value = "";
  }
}
function removeComposerImage() {
  state.selectedImageBase64 = null;
  if ($("composer-image-preview")) $("composer-image-preview").classList.add("hidden");
  if ($("composer-image")) $("composer-image").src = "";
  if ($("composer-file")) $("composer-file").value = "";
}
async function submitPost() {
  if (checkGuestBlocked("posting")) return;
  if (state.posting) return;
  const caption = ($("composer-text")?.value || "").trim();
  const imageBase64 = state.selectedImageBase64;
  if (!caption && !imageBase64) return showToast("Isi teks atau pilih foto.", "error");
  state.posting = true;
  const btn = $("composer-submit");
  if (btn) { btn.disabled = true; btn.textContent = "Mengirim..."; }
  try {
    await addDoc(collection(db, "posts"), {
      uid: state.user.uid, username: state.profile?.username || "User",
      caption, imageBase64: imageBase64 || "",
      likedBy: [], commentsCount: 0, createdAt: serverTimestamp()
    });
    closeComposer();
    showToast("Postingan terkirim!", "success");
  } catch (err) {
    showToast("Gagal posting.", "error");
    if (btn) { btn.disabled = false; btn.textContent = "Posting"; }
  } finally { state.posting = false; }
}
function initComposer() {
  if ($("fab-beranda")) $("fab-beranda").addEventListener("click", openComposer);
  if ($("composer-close")) $("composer-close").addEventListener("click", closeComposer);
  if ($("composer-backdrop")) $("composer-backdrop").addEventListener("click", closeComposer);
  if ($("composer-submit")) $("composer-submit").addEventListener("click", submitPost);
  if ($("composer-file")) $("composer-file").addEventListener("change", handleImagePick);
  if ($("composer-image-remove")) $("composer-image-remove").addEventListener("click", removeComposerImage);
  if ($("composer-text")) $("composer-text").addEventListener("input", () => {
    if ($("composer-counter")) $("composer-counter").textContent = `${$("composer-text").value.length}/500`;
  });
}

// =========================================================
// FEED
// =========================================================
function startFeedListener() {
  if (state.feedUnsub) return;
  const feed = $("feed-container");
  if (!feed) return;
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
  state.feedUnsub = onSnapshot(q, (snap) => {
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    posts.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? Date.now();
      const tb = b.createdAt?.toMillis?.() ?? Date.now();
      return tb - ta;
    });
    if (posts.length === 0) {
      feed.innerHTML = `<div class="empty-state"><div class="empty-icon">🏠</div><div class="empty-title">Belum ada postingan</div><div class="empty-desc">Jadilah yang pertama posting!</div></div>`;
      return;
    }
    feed.innerHTML = "";
    posts.forEach(p => feed.appendChild(renderPostCard(p)));
  }, (err) => {
    feed.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Gagal memuat feed</div><div class="empty-desc">${escapeHtml(err.message || "")}</div></div>`;
  });
}
function renderPostCard(post) {
  const isOwn = post.uid === state.user?.uid;
  const likedBy = Array.isArray(post.likedBy) ? post.likedBy : [];
  const isLiked = state.user ? likedBy.includes(state.user.uid) : false;
  const avatar = generateAvatar(post.username || "?");
  const captionHtml = post.caption ? `<p class="post-caption">${parseEmojis(post.caption)}</p>` : "";
  const imageHtml = post.imageBase64 ? `<div class="post-image-wrap"><img class="post-image" src="${post.imageBase64}" alt="post" loading="lazy" /></div>` : "";
  const card = document.createElement("article");
  card.className = "post-card";
  card.innerHTML = `
    <header class="post-header">
      <img class="post-avatar post-clickable" src="${avatar}" alt="avatar" />
      <div class="post-meta post-clickable">
        <div class="post-username">${escapeHtml(post.username || "User")}</div>
        <div class="post-time">${timeAgo(post.createdAt)}</div>
      </div>
      ${isOwn ? `<button class="post-delete-btn" data-action="delete">🗑</button>` : ""}
    </header>
    ${captionHtml}${imageHtml}
    <footer class="post-actions">
      <button class="post-like-btn ${isLiked ? "liked" : ""}" data-action="like">
        <span class="like-icon">${isLiked ? "❤️" : "🤍"}</span>
        <span class="like-count">${likedBy.length}</span>
      </button>
    </footer>`;
  const likeBtn = card.querySelector('[data-action="like"]');
  if (likeBtn) likeBtn.addEventListener("click", () => toggleLike(post.id, isLiked));
  const delBtn = card.querySelector('[data-action="delete"]');
  if (delBtn) delBtn.addEventListener("click", () => deletePost(post.id));
  card.querySelectorAll(".post-clickable").forEach(el => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => openViewUser(post.uid));
  });
  return card;
}
async function toggleLike(postId, isCurrentlyLiked) {
  if (checkGuestBlocked("like")) return;
  if (state.likeBusy.has(postId)) return;
  state.likeBusy.add(postId);
  try {
    const ref = doc(db, "posts", postId);
    if (isCurrentlyLiked) await updateDoc(ref, { likedBy: arrayRemove(state.user.uid) });
    else await updateDoc(ref, { likedBy: arrayUnion(state.user.uid) });
  } catch (e) { showToast("Gagal like.", "error"); }
  finally { setTimeout(() => state.likeBusy.delete(postId), 400); }
}
async function deletePost(postId) {
  if (checkGuestBlocked("hapus")) return;
  if (!confirm("Hapus postingan ini?")) return;
  try { await deleteDoc(doc(db, "posts", postId)); showToast("Dihapus.", "success"); }
  catch (e) { showToast("Gagal hapus.", "error"); }
}

// =========================================================
// EDIT PROFIL
// =========================================================
function openEditProfil() {
  if (checkGuestBlocked("edit profil")) return;
  state.pendingAvatar = null; state.pendingBanner = null;
  const p = state.profile || {};
  const uname = p.username || "User";
  if ($("edit-avatar-preview")) $("edit-avatar-preview").src = p.photoURL || generateAvatar(uname);
  if ($("edit-banner-preview")) $("edit-banner-preview").style.backgroundImage = p.bannerURL ? `url(${p.bannerURL})` : "";
  if ($("edit-username-input")) $("edit-username-input").value = uname;
  if ($("edit-bio-input")) $("edit-bio-input").value = p.bio || "";
  if ($("edit-bio-counter")) $("edit-bio-counter").textContent = `${(p.bio || "").length}/150`;
  if ($("edit-avatar-file")) $("edit-avatar-file").value = "";
  if ($("edit-banner-file")) $("edit-banner-file").value = "";
  if ($("edit-profil-modal")) $("edit-profil-modal").classList.remove("hidden");
}
function closeEditProfil() {
  if ($("edit-profil-modal")) $("edit-profil-modal").classList.add("hidden");
  state.pendingAvatar = null; state.pendingBanner = null;
  closeCropper();
}
async function saveEditProfil() {
  if (state.isGuest || !state.user) return;
  const saveBtn = $("edit-profil-save");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Menyimpan..."; }
  try {
    const bio = ($("edit-bio-input")?.value || "").trim().slice(0, 150);
    const updates = { bio };
    if (state.pendingAvatar) updates.photoURL = state.pendingAvatar;
    if (state.pendingBanner) updates.bannerURL = state.pendingBanner;
    await updateDoc(doc(db, "users", state.user.uid), updates);
    showToast("Profil tersimpan!", "success");
    closeEditProfil();
  } catch (e) { showToast("Gagal menyimpan.", "error"); }
  finally { if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Simpan"; } }
}
function initEditProfil() {
  if ($("btn-edit-profil")) $("btn-edit-profil").addEventListener("click", openEditProfil);
  if ($("edit-profil-close")) $("edit-profil-close").addEventListener("click", closeEditProfil);
  if ($("edit-profil-backdrop")) $("edit-profil-backdrop").addEventListener("click", closeEditProfil);
  if ($("edit-profil-save")) $("edit-profil-save").addEventListener("click", saveEditProfil);
  if ($("edit-avatar-btn") && $("edit-avatar-file")) $("edit-avatar-btn").addEventListener("click", () => $("edit-avatar-file").click());
  if ($("edit-banner-btn") && $("edit-banner-file")) $("edit-banner-btn").addEventListener("click", () => $("edit-banner-file").click());
  if ($("edit-avatar-file")) $("edit-avatar-file").addEventListener("change", handleAvatarPick);
  if ($("edit-banner-file")) $("edit-banner-file").addEventListener("change", handleBannerPick);
  if ($("edit-bio-input")) $("edit-bio-input").addEventListener("input", () => {
    if ($("edit-bio-counter")) $("edit-bio-counter").textContent = `${$("edit-bio-input").value.length}/150`;
  });
}
function handleAvatarPick(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  if (!file.type || !file.type.startsWith("image/")) return showToast("Bukan gambar.", "error");
  if (file.size > 5 * 1024 * 1024) return showToast("Max 5MB.", "error");
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = $("cropper-image");
    if (!img) return;
    img.src = ev.target.result;
    if ($("cropper-modal")) $("cropper-modal").classList.remove("hidden");
    setTimeout(() => {
      if (state.cropper) { try { state.cropper.destroy(); } catch (e) {} state.cropper = null; }
      if (typeof Cropper !== "undefined") {
        state.cropper = new Cropper(img, { aspectRatio: 1, viewMode: 1, dragMode: "move", autoCropArea: 0.9, background: false, guides: false });
      }
    }, 120);
  };
  reader.readAsDataURL(file);
}
function closeCropper() {
  if ($("cropper-modal")) $("cropper-modal").classList.add("hidden");
  if (state.cropper) { try { state.cropper.destroy(); } catch (e) {} state.cropper = null; }
  if ($("edit-avatar-file")) $("edit-avatar-file").value = "";
}
function applyCrop() {
  if (!state.cropper) { closeCropper(); return; }
  try {
    const canvas = state.cropper.getCroppedCanvas({ width: 320, height: 320, imageSmoothingQuality: "high" });
    const base64 = canvas.toDataURL("image/jpeg", 0.85);
    state.pendingAvatar = base64;
    if ($("edit-avatar-preview")) $("edit-avatar-preview").src = base64;
    closeCropper();
  } catch (e) { showToast("Gagal crop.", "error"); closeCropper(); }
}
function initCropperControls() {
  if ($("cropper-close")) $("cropper-close").addEventListener("click", closeCropper);
  if ($("cropper-backdrop")) $("cropper-backdrop").addEventListener("click", closeCropper);
  if ($("cropper-save")) $("cropper-save").addEventListener("click", applyCrop);
}
async function handleBannerPick(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  try {
    const base64 = await compressImage(file, 1200, 0.72);
    state.pendingBanner = base64;
    if ($("edit-banner-preview")) $("edit-banner-preview").style.backgroundImage = `url(${base64})`;
  } catch (err) { showToast(err.message || "Gagal proses banner.", "error"); }
}

// =========================================================
// FOLLOW
// =========================================================
async function followUser(targetUid) {
  if (!state.user) throw new Error("Belum login");
  if (targetUid === state.user.uid) throw new Error("Tidak bisa follow diri sendiri");
  const batch = writeBatch(db);
  batch.update(doc(db, "users", state.user.uid), { following: increment(1), followingList: arrayUnion(targetUid) });
  batch.update(doc(db, "users", targetUid), { followers: increment(1), followersList: arrayUnion(state.user.uid) });
  await batch.commit();
}
async function unfollowUser(targetUid) {
  if (!state.user) throw new Error("Belum login");
  if (targetUid === state.user.uid) throw new Error("Tidak bisa unfollow diri sendiri");
  const batch = writeBatch(db);
  batch.update(doc(db, "users", state.user.uid), { following: increment(-1), followingList: arrayRemove(targetUid) });
  batch.update(doc(db, "users", targetUid), { followers: increment(-1), followersList: arrayRemove(state.user.uid) });
  await batch.commit();
}
function isFollowing(targetUid) { return (state.profile?.followingList || []).includes(targetUid); }

// =========================================================
// VIEW USER
// =========================================================
async function openViewUser(uid) {
  if (!uid) return;
  if (uid === state.user?.uid) { showToast("Ini profil lu.", "info"); switchTab("profil"); return; }
  try {
    const data = await getUserCached(uid);
    if (!data) return showToast("User tidak ditemukan.", "error");
    state.viewingUid = uid;
    const uname = data.username || "User";
    if ($("view-user-avatar")) $("view-user-avatar").src = data.photoURL || generateAvatar(uname);
    if ($("view-user-name")) $("view-user-name").textContent = uname;
    if ($("view-user-bio")) $("view-user-bio").innerHTML = data.bio ? parseEmojis(data.bio) : "Belum ada bio.";
    if ($("view-user-followers")) $("view-user-followers").textContent = String(data.followers ?? 0);
    if ($("view-user-following")) $("view-user-following").textContent = String(data.following ?? 0);
    const banner = $("view-user-banner");
    if (banner) {
      banner.style.backgroundImage = data.bannerURL ? `url(${data.bannerURL})` : "";
      banner.classList.toggle("has-image", !!data.bannerURL);
    }
    const btn = $("view-user-follow");
    if (btn) {
      if (state.isGuest) { btn.disabled = true; btn.textContent = "Login untuk follow"; btn.classList.remove("following"); }
      else {
        btn.disabled = false;
        const following = isFollowing(uid);
        btn.textContent = following ? "Unfollow" : "Follow";
        btn.classList.toggle("following", following);
      }
    }
    if ($("view-user-chat")) $("view-user-chat").disabled = state.isGuest;
    if ($("view-user-modal")) $("view-user-modal").classList.remove("hidden");
  } catch (e) { showToast("Gagal memuat.", "error"); }
}
function closeViewUser() {
  if ($("view-user-modal")) $("view-user-modal").classList.add("hidden");
  state.viewingUid = null;
}
async function toggleFollowViewUser() {
  const targetUid = state.viewingUid;
  if (!targetUid) return;
  if (checkGuestBlocked("follow")) return;
  if (state.followBusy.has(targetUid)) return;
  state.followBusy.add(targetUid);
  const btn = $("view-user-follow");
  const wasFollowing = isFollowing(targetUid);
  if (btn) btn.disabled = true;
  try {
    if (wasFollowing) { await unfollowUser(targetUid); showToast("Unfollowed.", "info"); }
    else { await followUser(targetUid); showToast("Following!", "success"); }
    const snap = await getDoc(doc(db, "users", targetUid));
    if (snap.exists()) {
      const d = snap.data();
      if ($("view-user-followers")) $("view-user-followers").textContent = String(d.followers ?? 0);
    }
    setTimeout(() => {
      if (btn) {
        const nowFollowing = isFollowing(targetUid);
        btn.textContent = nowFollowing ? "Unfollow" : "Follow";
        btn.classList.toggle("following", nowFollowing);
      }
    }, 300);
  } catch (e) { showToast("Gagal follow.", "error"); }
  finally { setTimeout(() => { if (btn) btn.disabled = false; state.followBusy.delete(targetUid); }, 400); }
}
function initViewUser() {
  if ($("view-user-close")) $("view-user-close").addEventListener("click", closeViewUser);
  if ($("view-user-backdrop")) $("view-user-backdrop").addEventListener("click", closeViewUser);
  if ($("view-user-follow")) $("view-user-follow").addEventListener("click", toggleFollowViewUser);
  if ($("view-user-chat")) $("view-user-chat").addEventListener("click", async () => {
    const targetUid = state.viewingUid;
    if (!targetUid) return;
    if (checkGuestBlocked("chat")) return;
    closeViewUser();
    await openDMWithUser(targetUid);
  });
}

// =========================================================
// CHAT LIST
// =========================================================
function startChatListListener() {
  if (state.chatListUnsub) { try { state.chatListUnsub(); } catch (e) {} }
  if (!state.user) return;
  const q = query(collection(db, "chats"), where("members", "array-contains", state.user.uid));
  state.chatListUnsub = onSnapshot(q, (snap) => {
    const chats = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    chats.sort((a, b) => {
      const ta = a.lastMessageAt?.toMillis?.() ?? 0;
      const tb = b.lastMessageAt?.toMillis?.() ?? 0;
      return tb - ta;
    });
    renderChatList(chats);
  }, (err) => {
    const el = $("chat-list-container");
    if (el) el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Gagal memuat</div><div class="empty-desc">${escapeHtml(err.message || "")}</div></div>`;
  });
}
async function renderChatList(chats) {
  const el = $("chat-list-container");
  if (!el) return;
  const groups = chats.filter(c => c.type === "group");
  if (chats.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Belum ada chat</div><div class="empty-desc">Klik + di bawah untuk mulai.</div></div>`;
  } else {
    el.innerHTML = "";
    for (const chat of chats) {
      const item = await renderChatListItem(chat);
      if (item) el.appendChild(item);
    }
  }
  const gl = $("grup-list-container");
  if (gl) {
    if (groups.length === 0) {
      gl.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">Belum ada grup</div><div class="empty-desc">Klik + untuk buat/join.</div></div>`;
    } else {
      gl.innerHTML = "";
      for (const g of groups) {
        const item = await renderChatListItem(g);
        if (item) gl.appendChild(item);
      }
    }
  }
}
async function renderChatListItem(chat) {
  let displayName = chat.name || "Grup";
  let avatar = generateAvatar(displayName);
  const isGroup = chat.type === "group";
  if (chat.type === "dm") {
    const otherUid = (chat.members || []).find(uid => uid !== state.user.uid);
    if (!otherUid) return null;
    const other = await getUserCached(otherUid);
    if (other) { displayName = other.username || "User"; avatar = other.photoURL || generateAvatar(displayName); }
  }
  const lastMsg = chat.lastMessage || "Belum ada pesan";
  const timeStr = chat.lastMessageAt ? timeAgo(chat.lastMessageAt) : "";
  const prefix = isGroup ? "👥 " : "";
  const item = document.createElement("button");
  item.className = "chat-list-item";
  item.innerHTML = `
    <img class="chat-list-avatar" src="${avatar}" alt="avatar" />
    <div class="chat-list-info">
      <div class="chat-list-name">${prefix}${escapeHtml(displayName)}</div>
      <div class="chat-list-preview">${parseEmojis(lastMsg.slice(0, 60))}</div>
    </div>
    <div class="chat-list-time">${timeStr}</div>`;
  item.addEventListener("click", () => openChatRoom(chat.id));
  return item;
}

// =========================================================
// CHAT ROOM
// =========================================================
async function openChatRoom(chatId) {
  try {
    const snap = await getDoc(doc(db, "chats", chatId));
    if (!snap.exists()) return showToast("Chat tidak ditemukan.", "error");
    state.currentChatId = chatId;
    state.currentChat = { id: snap.id, ...snap.data() };
    state.currentMessages = []; state.markedRead = new Set();
    cancelReply(); clearCapsuleIndicator();
    await updateChatRoomHeader();
    const callBtn = $("chat-room-call");
    if (callBtn) callBtn.classList.toggle("hidden", state.currentChat.type !== "dm");
    if ($("chat-room")) $("chat-room").classList.remove("hidden");
    startMessagesListener(); startTypingListener();
    if ($("chat-input")) $("chat-input").value = "";
  } catch (e) { showToast("Gagal buka chat.", "error"); }
}
async function updateChatRoomHeader() {
  const chat = state.currentChat;
  if (!chat) return;
  let name = chat.name || "Grup";
  let status = "Grup";
  if (chat.type === "dm") {
    const otherUid = (chat.members || []).find(uid => uid !== state.user.uid);
    if (otherUid) {
      const other = await getUserCached(otherUid);
      if (other) { name = other.username || "User"; status = presenceLabel(other.lastSeen); }
    }
  } else { status = `${(chat.members || []).length} anggota`; }
  if ($("chat-room-name")) $("chat-room-name").textContent = name;
  if ($("chat-room-status")) $("chat-room-status").textContent = status;
  if ($("chat-room-avatar")) $("chat-room-avatar").textContent = chat.type === "group" ? "👥" : "👤";
}
function closeChatRoom() {
  if (state.messagesUnsub) { try { state.messagesUnsub(); } catch (e) {} state.messagesUnsub = null; }
  if (state.typingUnsub) { try { state.typingUnsub(); } catch (e) {} state.typingUnsub = null; }
  clearMyTyping();
  state.currentChatId = null; state.currentChat = null; state.currentMessages = []; state.markedRead = new Set();
  cancelReply(); hideReactionPicker(); clearCapsuleIndicator();
  if ($("chat-room")) $("chat-room").classList.add("hidden");
}
function startMessagesListener() {
  if (state.messagesUnsub) { try { state.messagesUnsub(); } catch (e) {} }
  const chatId = state.currentChatId;
  if (!chatId) return;
  const q = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(200));
  state.messagesUnsub = onSnapshot(q, (snap) => {
    if (state.currentChatId !== chatId) return;
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.currentMessages = messages;
    renderMessages(messages);
    markUnreadMessages(messages);
    updatePinBanner();
  }, (err) => {
    const el = $("chat-messages");
    if (el) el.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Gagal memuat</div><div class="empty-desc">${escapeHtml(err.message || "")}</div></div>`;
  });
}
function renderMessages(messages) {
  const el = $("chat-messages");
  if (!el) return;
  const now = Date.now();
  const visible = messages.filter(m => {
    if (!m.unlockTime) return true;
    const unlockMs = m.unlockTime?.toMillis ? m.unlockTime.toMillis() : 0;
    if (unlockMs <= now) return true;
    if (m.uid === state.user.uid) return true;
    return false;
  });
  if (visible.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-title">Belum ada pesan</div></div>`;
    return;
  }
  el.innerHTML = "";
  visible.forEach(m => el.appendChild(renderMessage(m)));
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}
function renderMessage(msg) {
  const isOut = msg.uid === state.user.uid;
  const row = document.createElement("div");
  row.className = `msg-row ${isOut ? "out" : "in"}`;
  row.dataset.msgId = msg.id;
  const now = Date.now();
  const isLocked = msg.unlockTime && (msg.unlockTime?.toMillis?.() || 0) > now;
  if (isLocked) {
    row.innerHTML = `<div class="msg-bubble msg-locked">🔒 Terkunci — terbuka ${timeAgo(msg.unlockTime)}</div>`;
    return row;
  }
  const quoteHtml = msg.replyTo ? `<div class="msg-quote"><div class="msg-quote-name">${escapeHtml(msg.replyTo.username || "")}</div><div class="msg-quote-text">${formatText((msg.replyTo.text || "").slice(0, 80))}</div></div>` : "";
  const nameHtml = (!isOut && state.currentChat?.type === "group") ? `<div class="msg-name">${escapeHtml(msg.username || "User")}</div>` : "";
  let bodyHtml = "";
  if (msg.type === "image" && msg.imageBase64) {
    bodyHtml = `<div class="msg-image-wrap"><img class="msg-image" src="${msg.imageBase64}" alt="foto" loading="lazy" /></div>`;
    if (msg.text) bodyHtml += `<div class="msg-text">${formatText(msg.text)}</div>`;
  } else if (msg.type === "audio" && msg.audioBase64) {
    bodyHtml = `<div class="msg-audio"><audio controls src="${msg.audioBase64}" preload="metadata"></audio><span class="msg-audio-dur">${msg.audioDuration || 0}s</span></div>`;
  } else {
    bodyHtml = `<div class="msg-text">${formatText(msg.text || "")}</div>`;
  }
  const readBy = msg.readBy || [];
  const others = (state.currentChat?.members || []).filter(u => u !== state.user.uid);
  const readByAll = others.length > 0 && others.every(u => readBy.includes(u));
  const readByAny = readBy.some(u => u !== state.user.uid);
  const tick = isOut ? `<span class="msg-tick ${readByAny ? "read" : ""}">${readByAny ? "✓✓" : "✓"}</span>` : "";
  const reactionsHtml = renderReactions(msg.reactions || {});
  const unlockBadge = msg.unlockTime ? `<span class="msg-capsule-badge">⏰</span>` : "";
  row.innerHTML = `
    <div class="msg-swipe-reply">↩</div>
    <div class="msg-swipe-delete">🗑</div>
    <div class="msg-bubble">
      ${quoteHtml}${nameHtml}${bodyHtml}
      <div class="msg-meta"><span class="msg-time">${unlockBadge}${formatMsgTime(msg.createdAt)}</span>${tick}</div>
      ${reactionsHtml}
    </div>`;
  attachMessageHandlers(row, msg);
  return row;
}
function formatMsgTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
}
function renderReactions(reactions) {
  const entries = Object.entries(reactions).filter(([e, uids]) => uids && uids.length > 0);
  if (entries.length === 0) return "";
  return `<div class="msg-reactions">${entries.map(([emoji, uids]) =>
    `<span class="reaction-item" data-emoji="${escapeHtml(emoji)}">${emojiImg(emoji, true)}${uids.length > 1 ? `<span class="reaction-count">${uids.length}</span>` : ""}</span>`
  ).join("")}</div>`;
}
function attachMessageHandlers(row, msg) {
  let touchStartX = 0, touchStartY = 0, longPressTimer = null, moved = false;
  const startLP = (x, y) => { longPressTimer = setTimeout(() => { if (!moved) showReactionPicker(x, y, msg); }, 500); };
  const cancelLP = () => { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } };
  row.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    touchStartX = t.clientX; touchStartY = t.clientY;
    moved = false; row.style.transition = "none";
    startLP(t.clientX, t.clientY);
  }, { passive: true });
  row.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    const dx = t.clientX - touchStartX, dy = t.clientY - touchStartY;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { moved = true; cancelLP(); }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 15) {
      e.preventDefault();
      if (dx > 0) {
        row.style.transform = `translateX(${Math.min(dx, 80)}px)`;
        if (dx > 55) row.setAttribute("data-swipe", "reply");
        else row.removeAttribute("data-swipe");
      } else if (msg.uid === state.user.uid) {
        row.style.transform = `translateX(${Math.max(dx, -80)}px)`;
        if (dx < -55) row.setAttribute("data-swipe", "delete");
        else row.removeAttribute("data-swipe");
      }
    }
  }, { passive: false });
  const onEnd = () => {
    cancelLP();
    row.style.transition = "transform 0.2s ease";
    const sw = row.getAttribute("data-swipe");
    if (sw === "reply") startReply(msg);
    else if (sw === "delete") deleteChatMessage(msg);
    row.style.transform = "translateX(0)";
    row.removeAttribute("data-swipe");
  };
  row.addEventListener("touchend", onEnd);
  row.addEventListener("touchcancel", onEnd);
  row.addEventListener("contextmenu", (e) => { e.preventDefault(); showReactionPicker(e.clientX, e.clientY, msg); });
  const reactEl = row.querySelector(".msg-reactions");
  if (reactEl) {
    reactEl.addEventListener("click", (e) => {
      const item = e.target.closest(".reaction-item");
      if (item) toggleReaction(msg.id, item.dataset.emoji);
    });
  }
}
function initReactionPicker() {
  const picker = $("reaction-picker");
  if (!picker) return;
  const emojis = ["❤️", "👍", "😂", "😮", "😢", "🔥"];
  picker.innerHTML = emojis.map(e => `<button data-emoji="${e}">${emojiImg(e)}</button>`).join("") +
    `<button data-action="reply">↩️</button><button data-action="pin">📌</button><button data-action="delete">🗑️</button>`;
  picker.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const msg = picker._targetMsg;
    if (!msg) return;
    if (btn.dataset.emoji) toggleReaction(msg.id, btn.dataset.emoji);
    else if (btn.dataset.action === "reply") startReply(msg);
    else if (btn.dataset.action === "pin") togglePin(msg);
    else if (btn.dataset.action === "delete") deleteChatMessage(msg);
    hideReactionPicker();
  });
}
function showReactionPicker(x, y, msg) {
  const picker = $("reaction-picker");
  if (!picker) return;
  picker._targetMsg = msg;
  picker.classList.remove("hidden"); picker.classList.add("show");
  const w = picker.offsetWidth || 320;
  const left = Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8));
  const top = Math.max(8, y - 70);
  picker.style.left = left + "px";
  picker.style.top = top + "px";
  setTimeout(() => {
    const hide = (ev) => {
      if (!picker.contains(ev.target)) {
        hideReactionPicker();
        document.removeEventListener("click", hide);
        document.removeEventListener("touchstart", hide);
      }
    };
    document.addEventListener("click", hide);
    document.addEventListener("touchstart", hide);
  }, 60);
}
function hideReactionPicker() {
  const picker = $("reaction-picker");
  if (!picker) return;
  picker.classList.add("hidden"); picker.classList.remove("show");
  picker._targetMsg = null;
}
async function toggleReaction(msgId, emoji) {
  if (state.isGuest) return showToast("Tamu tidak bisa reaksi.", "error");
  try {
    const ref = doc(db, "chats", state.currentChatId, "messages", msgId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const reactions = { ...(snap.data().reactions || {}) };
    const uids = [...(reactions[emoji] || [])];
    const idx = uids.indexOf(state.user.uid);
    if (idx >= 0) uids.splice(idx, 1);
    else uids.push(state.user.uid);
    if (uids.length === 0) delete reactions[emoji];
    else reactions[emoji] = uids;
    await updateDoc(ref, { reactions });
  } catch (e) { showToast("Gagal reaksi.", "error"); }
}
async function togglePin(msg) {
  if (state.isGuest) return showToast("Tamu tidak bisa pin.", "error");
  try {
    await updateDoc(doc(db, "chats", state.currentChatId, "messages", msg.id), { pinned: !msg.pinned });
    showToast(msg.pinned ? "Pin dilepas." : "Disematkan.", "success");
  } catch (e) { showToast("Gagal pin.", "error"); }
}
function updatePinBanner() {
  const banner = $("chat-pin-banner");
  if (!banner) return;
  const pinned = state.currentMessages.filter(m => m.pinned).sort((a, b) =>
    (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
  )[0];
  if (pinned) {
    banner.classList.remove("hidden");
    const textEl = banner.querySelector(".chat-pin-banner-text");
    if (textEl) textEl.innerHTML = formatText((pinned.text || (pinned.type === "image" ? "📷 Foto" : "🎤 Voice")).slice(0, 60));
    banner.dataset.pinId = pinned.id;
  } else {
    banner.classList.add("hidden");
    banner.dataset.pinId = "";
  }
}
async function deleteChatMessage(msg) {
  if (!msg.uid || msg.uid !== state.user?.uid) return showToast("Hanya hapus pesan sendiri.", "error");
  if (!confirm("Hapus pesan?")) return;
  try { await deleteDoc(doc(db, "chats", state.currentChatId, "messages", msg.id)); showToast("Dihapus.", "success"); }
  catch (e) { showToast("Gagal hapus.", "error"); }
}
function startReply(msg) {
  state.replyTarget = { id: msg.id, username: msg.username, text: msg.text || (msg.type === "image" ? "📷 Foto" : "🎤 Voice") };
  const pv = $("reply-preview");
  if (pv) {
    const n = pv.querySelector(".reply-preview-name");
    const t = pv.querySelector(".reply-preview-text");
    if (n) n.textContent = msg.username || "User";
    if (t) t.textContent = (state.replyTarget.text || "").slice(0, 80);
    pv.classList.remove("hidden");
  }
  $("chat-input")?.focus();
}
function cancelReply() {
  state.replyTarget = null;
  if ($("reply-preview")) $("reply-preview").classList.add("hidden");
}
async function sendChatMessage(payload) {
  if (!state.currentChatId || !state.user) return;
  const msgData = {
    uid: state.user.uid, username: state.profile?.username || "User",
    photoURL: state.profile?.photoURL || "",
    text: payload.text || "",
    type: payload.type || "text",
    imageBase64: payload.imageBase64 || "",
    audioBase64: payload.audioBase64 || "",
    audioDuration: payload.audioDuration || 0,
    replyTo: state.replyTarget || null,
    readBy: [state.user.uid],
    pinned: false, reactions: {},
    unlockTime: state.pendingUnlockTime || null,
    createdAt: serverTimestamp()
  };
  await addDoc(collection(db, "chats", state.currentChatId, "messages"), msgData);
  let previewText = "";
  if (msgData.type === "image") previewText = "📷 Foto";
  else if (msgData.type === "audio") previewText = "🎤 Voice";
  else previewText = msgData.text || "";
  await updateDoc(doc(db, "chats", state.currentChatId), {
    lastMessage: previewText.slice(0, 100),
    lastMessageAt: serverTimestamp(),
    lastMessageBy: state.user.uid
  });
  cancelReply(); clearMyTyping(); clearCapsuleIndicator();
}
async function handleSendText() {
  if (checkGuestBlocked("kirim pesan")) return;
  const input = $("chat-input");
  const text = (input?.value || "").trim();
  if (!text) return;
  try { await sendChatMessage({ type: "text", text }); if (input) input.value = ""; }
  catch (e) { showToast("Gagal kirim.", "error"); }
}
async function handleChatImagePick(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  if ($("chat-image-file")) $("chat-image-file").value = "";
  try {
    showToast("Mengompres...", "info");
    const base64 = await compressImage(file, 900, 0.7);
    await sendChatMessage({ type: "image", imageBase64: base64 });
    showToast("Foto terkirim!", "success");
  } catch (err) { showToast(err.message || "Gagal kirim.", "error"); }
}
async function markUnreadMessages(messages) {
  if (!state.user || !state.currentChatId) return;
  const toMark = messages.filter(m =>
    m.uid !== state.user.uid && !state.markedRead.has(m.id) && !(m.readBy || []).includes(state.user.uid)
  );
  if (toMark.length === 0) return;
  toMark.forEach(m => state.markedRead.add(m.id));
  try {
    const batch = writeBatch(db);
    toMark.forEach(m => {
      batch.update(doc(db, "chats", state.currentChatId, "messages", m.id), { readBy: arrayUnion(state.user.uid) });
    });
    await batch.commit();
  } catch (e) {}
}
function setMyTyping() {
  if (state.isGuest || !state.user || !state.currentChatId) return;
  updateDoc(doc(db, "users", state.user.uid), { typingIn: state.currentChatId }).catch(() => {});
}
function clearMyTyping() {
  if (state.isGuest || !state.user) return;
  if (state.myTypingTimer) { clearTimeout(state.myTypingTimer); state.myTypingTimer = null; }
  updateDoc(doc(db, "users", state.user.uid), { typingIn: null }).catch(() => {});
}
function onChatTypingInput() {
  if (state.isGuest || !state.user || !state.currentChatId) return;
  setMyTyping();
  if (state.myTypingTimer) clearTimeout(state.myTypingTimer);
  state.myTypingTimer = setTimeout(clearMyTyping, 2000);
}
function startTypingListener() {
  if (state.typingUnsub) { try { state.typingUnsub(); } catch (e) {} }
  const chatId = state.currentChatId;
  if (!chatId) return;
  const q = query(collection(db, "users"), where("typingIn", "==", chatId));
  state.typingUnsub = onSnapshot(q, (snap) => {
    if (state.currentChatId !== chatId) return;
    const others = snap.docs.filter(d => d.id !== state.user?.uid);
    const statusEl = $("chat-room-status");
    if (!statusEl) return;
    if (others.length > 0) {
      const names = others.map(d => d.data().username || "User").slice(0, 2).join(", ");
      statusEl.textContent = `${names} sedang mengetik...`;
      statusEl.className = "chat-room-status typing";
    } else {
      updateChatRoomHeader();
      statusEl.className = "chat-room-status";
    }
  }, (err) => console.warn("typing err:", err));
}
function initVoiceRecording() {
  if ($("chat-mic-btn")) $("chat-mic-btn").addEventListener("click", startVoiceRecord);
  if ($("record-stop")) $("record-stop").addEventListener("click", stopVoiceRecord);
  if ($("record-cancel")) $("record-cancel").addEventListener("click", cancelVoiceRecord);
}
async function startVoiceRecord() {
  if (checkGuestBlocked("rekam suara")) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return showToast("Browser tidak support.", "error");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioChunks = [];
    const mimeType = typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    state.mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    state.mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) state.audioChunks.push(e.data); };
    state.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const duration = Math.round((Date.now() - state.recordStartTime) / 1000);
      if (duration < 1) { showToast("Terlalu pendek.", "error"); state.mediaRecorder = null; return; }
      const blob = new Blob(state.audioChunks, { type: mimeType || "audio/webm" });
      try {
        const base64 = await blobToBase64(blob);
        await sendChatMessage({ type: "audio", audioBase64: base64, audioDuration: duration });
        showToast("Voice terkirim!", "success");
      } catch (e) { showToast("Gagal kirim.", "error"); }
      state.mediaRecorder = null; state.audioChunks = [];
    };
    state.mediaRecorder.start();
    state.recordStartTime = Date.now();
    if ($("record-overlay")) $("record-overlay").classList.remove("hidden");
    if ($("record-timer")) $("record-timer").textContent = "00:00";
    state.recordTimerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - state.recordStartTime) / 1000);
      const mm = String(Math.floor(sec / 60)).padStart(2, "0");
      const ss = String(sec % 60).padStart(2, "0");
      if ($("record-timer")) $("record-timer").textContent = `${mm}:${ss}`;
      if (sec >= 60) stopVoiceRecord();
    }, 250);
  } catch (e) { showToast("Tidak bisa akses mikrofon.", "error"); }
}
function stopVoiceRecord() {
  if (state.recordTimerInterval) { clearInterval(state.recordTimerInterval); state.recordTimerInterval = null; }
  if ($("record-overlay")) $("record-overlay").classList.add("hidden");
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    try { state.mediaRecorder.stop(); } catch (e) {}
  }
}
function cancelVoiceRecord() {
  if (state.recordTimerInterval) { clearInterval(state.recordTimerInterval); state.recordTimerInterval = null; }
  if ($("record-overlay")) $("record-overlay").classList.add("hidden");
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    state.mediaRecorder.onstop = null;
    try { state.mediaRecorder.stop(); } catch (e) {}
  }
  state.mediaRecorder = null; state.audioChunks = [];
  showToast("Dibatalkan.", "info");
}
function initChatUI() {
  if ($("chat-room-back")) $("chat-room-back").addEventListener("click", closeChatRoom);
  if ($("chat-send-btn")) $("chat-send-btn").addEventListener("click", handleSendText);
  if ($("chat-attach-btn")) $("chat-attach-btn").addEventListener("click", () => $("chat-image-file")?.click());
  if ($("chat-image-file")) $("chat-image-file").addEventListener("change", handleChatImagePick);
  if ($("reply-cancel")) $("reply-cancel").addEventListener("click", cancelReply);
  if ($("chat-capsule-btn")) $("chat-capsule-btn").addEventListener("click", openCapsuleModal);
  if ($("chat-input")) {
    $("chat-input").addEventListener("input", onChatTypingInput);
    $("chat-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendText(); }
    });
    $("chat-input").addEventListener("blur", clearMyTyping);
  }
  if ($("chat-pin-close")) {
    $("chat-pin-close").addEventListener("click", (e) => { e.stopPropagation(); $("chat-pin-banner")?.classList.add("hidden"); });
  }
  if ($("chat-pin-banner")) {
    $("chat-pin-banner").addEventListener("click", (e) => {
      if (e.target.closest("#chat-pin-close")) return;
      const pinId = $("chat-pin-banner")?.dataset.pinId;
      if (pinId) {
        const el = document.querySelector(`[data-msg-id="${pinId}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
  if ($("chat-room-call")) $("chat-room-call").addEventListener("click", startOutgoingCall);
  window.addEventListener("beforeunload", clearMyTyping);
  window.addEventListener("pagehide", clearMyTyping);
}

// =========================================================
// DM & GROUP
// =========================================================
async function openDMWithUser(targetUid) {
  if (!state.user || targetUid === state.user.uid) return;
  const uids = [state.user.uid, targetUid].sort();
  const chatId = `dm_${uids.join("_")}`;
  const chatRef = doc(db, "chats", chatId);
  try {
    const snap = await getDoc(chatRef);
    if (!snap.exists()) {
      await setDoc(chatRef, { type: "dm", members: uids, lastMessage: "", lastMessageAt: serverTimestamp(), createdAt: serverTimestamp() });
    }
    switchTab("chat");
    await openChatRoom(chatId);
  } catch (e) { showToast("Gagal buka chat.", "error"); }
}
async function generateGroupId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 20; i++) {
    let id = "HZ-";
    for (let j = 0; j < 4; j++) id += chars[Math.floor(Math.random() * chars.length)];
    const snap = await getDoc(doc(db, "chats", id));
    if (!snap.exists()) return id;
  }
  throw new Error("Gagal generate ID.");
}
async function createGroup(name) {
  if (checkGuestBlocked("buat grup")) return;
  if (!name || name.length < 2) return showToast("Nama minimal 2 karakter.", "error");
  try {
    const id = await generateGroupId();
    await setDoc(doc(db, "chats", id), {
      type: "group", groupId: id, name, members: [state.user.uid],
      createdBy: state.user.uid, lastMessage: "", lastMessageAt: serverTimestamp(), createdAt: serverTimestamp()
    });
    showToast(`Grup dibuat: ${id}`, "success");
    closeNewGroupModal();
    switchTab("chat");
    await openChatRoom(id);
  } catch (e) { showToast("Gagal buat grup.", "error"); }
}
async function joinGroup(rawId) {
  if (checkGuestBlocked("join grup")) return;
  const id = (rawId || "").trim().toUpperCase();
  if (!/^HZ-[A-Z0-9]{4}$/.test(id)) return showToast("Format: HZ-XXXX", "error");
  try {
    const ref = doc(db, "chats", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return showToast("Grup tidak ditemukan.", "error");
    const data = snap.data();
    if (data.type !== "group") return showToast("Bukan grup.", "error");
    if ((data.members || []).includes(state.user.uid)) showToast("Sudah di grup ini.", "info");
    else { await updateDoc(ref, { members: arrayUnion(state.user.uid) }); showToast("Join berhasil!", "success"); }
    closeNewGroupModal();
    switchTab("chat");
    await openChatRoom(id);
  } catch (e) { showToast("Gagal join.", "error"); }
}
function openNewChatModal() {
  if (checkGuestBlocked("chat")) return;
  if ($("search-user-input")) $("search-user-input").value = "";
  if ($("search-user-results")) $("search-user-results").innerHTML = `<p class="search-user-hint">Ketik username lengkap.</p>`;
  if ($("new-chat-modal")) $("new-chat-modal").classList.remove("hidden");
  setTimeout(() => $("search-user-input")?.focus(), 100);
}
function closeNewChatModal() { if ($("new-chat-modal")) $("new-chat-modal").classList.add("hidden"); }
async function searchUserExact(rawName) {
  const uname = (rawName || "").trim().toLowerCase();
  const el = $("search-user-results");
  if (!el) return;
  if (!uname) { el.innerHTML = `<p class="search-user-hint">Ketik username lengkap.</p>`; return; }
  el.innerHTML = `<p class="search-user-hint">Mencari...</p>`;
  try {
    const q = query(collection(db, "users"), where("username", "==", uname));
    const snap = await getDocs(q);
    if (snap.empty) { el.innerHTML = `<p class="search-user-hint">Username "${escapeHtml(uname)}" tidak ditemukan.</p>`; return; }
    el.innerHTML = "";
    snap.forEach(d => {
      const data = d.data();
      if (data.uid === state.user.uid) return;
      const item = document.createElement("button");
      item.className = "search-user-item";
      item.innerHTML = `
        <img class="search-user-avatar" src="${data.photoURL || generateAvatar(data.username)}" alt="avatar" />
        <div class="search-user-info">
          <div class="search-user-name">${escapeHtml(data.username || "")}</div>
          <div class="search-user-bio">${data.bio ? parseEmojis(data.bio.slice(0, 40)) : "Belum ada bio."}</div>
        </div>`;
      item.addEventListener("click", async () => { closeNewChatModal(); await openDMWithUser(data.uid); });
      el.appendChild(item);
    });
    if (el.children.length === 0) el.innerHTML = `<p class="search-user-hint">Tidak ada user lain.</p>`;
  } catch (e) { el.innerHTML = `<p class="search-user-hint">Gagal mencari.</p>`; }
}
function openNewGroupModal() {
  if (checkGuestBlocked("grup")) return;
  if ($("group-name-input")) $("group-name-input").value = "";
  if ($("group-id-input")) $("group-id-input").value = "";
  showGroupPanel("create");
  if ($("new-group-modal")) $("new-group-modal").classList.remove("hidden");
}
function closeNewGroupModal() { if ($("new-group-modal")) $("new-group-modal").classList.add("hidden"); }
function showGroupPanel(which) {
  if ($("group-tab-create")) $("group-tab-create").classList.toggle("active", which === "create");
  if ($("group-tab-join")) $("group-tab-join").classList.toggle("active", which === "join");
  if ($("group-create-panel")) $("group-create-panel").classList.toggle("hidden", which !== "create");
  if ($("group-join-panel")) $("group-join-panel").classList.toggle("hidden", which !== "join");
}
function initNewChatGroupModals() {
  if ($("fab-chat")) $("fab-chat").addEventListener("click", openNewChatModal);
  if ($("new-chat-close")) $("new-chat-close").addEventListener("click", closeNewChatModal);
  if ($("new-chat-backdrop")) $("new-chat-backdrop").addEventListener("click", closeNewChatModal);
  if ($("search-user-input")) {
    let t = null;
    $("search-user-input").addEventListener("input", (e) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => searchUserExact(e.target.value), 400);
    });
  }
  if ($("fab-grup")) $("fab-grup").addEventListener("click", openNewGroupModal);
  if ($("new-group-close")) $("new-group-close").addEventListener("click", closeNewGroupModal);
  if ($("new-group-backdrop")) $("new-group-backdrop").addEventListener("click", closeNewGroupModal);
  if ($("group-tab-create")) $("group-tab-create").addEventListener("click", () => showGroupPanel("create"));
  if ($("group-tab-join")) $("group-tab-join").addEventListener("click", () => showGroupPanel("join"));
  if ($("group-create-btn")) $("group-create-btn").addEventListener("click", () => createGroup(($("group-name-input")?.value || "").trim()));
  if ($("group-join-btn")) $("group-join-btn").addEventListener("click", () => joinGroup($("group-id-input")?.value));
}

// =========================================================
// KAPSUL WAKTU
// =========================================================
function openCapsuleModal() {
  if (checkGuestBlocked("kapsul waktu")) return;
  const dt = $("capsule-datetime");
  if (dt) {
    const now = new Date(Date.now() + 5 * 60000);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    dt.value = local;
    dt.min = local;
  }
  if ($("capsule-modal")) $("capsule-modal").classList.remove("hidden");
}
function closeCapsuleModal() { if ($("capsule-modal")) $("capsule-modal").classList.add("hidden"); }
function setCapsuleTime() {
  const dt = $("capsule-datetime");
  if (!dt || !dt.value) return showToast("Pilih waktu dulu.", "error");
  const date = new Date(dt.value);
  if (isNaN(date.getTime())) return showToast("Waktu tidak valid.", "error");
  if (date.getTime() <= Date.now() + 30000) return showToast("Minimal 1 menit dari sekarang.", "error");
  state.pendingUnlockTime = Timestamp.fromDate(date);
  if ($("capsule-indicator")) {
    $("capsule-indicator").classList.remove("hidden");
    $("capsule-indicator").querySelector("span").textContent = `⏰ Pesan berikutnya terbuka ${timeAgo(state.pendingUnlockTime)}`;
  }
  closeCapsuleModal();
  showToast("Kapsul waktu aktif untuk pesan berikutnya.", "success");
}
function clearCapsuleIndicator() {
  state.pendingUnlockTime = null;
  if ($("capsule-indicator")) $("capsule-indicator").classList.add("hidden");
}
function initCapsule() {
  if ($("capsule-close")) $("capsule-close").addEventListener("click", closeCapsuleModal);
  if ($("capsule-backdrop")) $("capsule-backdrop").addEventListener("click", closeCapsuleModal);
  if ($("capsule-save")) $("capsule-save").addEventListener("click", setCapsuleTime);
  if ($("capsule-indicator-clear")) $("capsule-indicator-clear").addEventListener("click", clearCapsuleIndicator);
}

// =========================================================
// PREMIUM
// =========================================================
function openPremiumModal() {
  if (checkGuestBlocked("premium")) return;
  if ($("premium-modal")) $("premium-modal").classList.remove("hidden");
}
function closePremiumModal() { if ($("premium-modal")) $("premium-modal").classList.add("hidden"); }
function initPremium() {
  if ($("premium-close")) $("premium-close").addEventListener("click", closePremiumModal);
  if ($("premium-backdrop")) $("premium-backdrop").addEventListener("click", closePremiumModal);
}

// =========================================================
// SHOP
// =========================================================
function openShop() {
  window.open("https://t.me/maklov1", "_blank", "noopener");
}

// =========================================================
// ADMIN DASHBOARD
// =========================================================
function openAdminDashboard() {
  if (!state.isAdmin) return showToast("Hanya admin.", "error");
  showAdminTab("users");
  if ($("admin-modal")) $("admin-modal").classList.remove("hidden");
  loadAdminUsers();
}
function closeAdminDashboard() { if ($("admin-modal")) $("admin-modal").classList.add("hidden"); }
function showAdminTab(tab) {
  document.querySelectorAll(".admin-tab").forEach(el => el.classList.toggle("active", el.dataset.tab === tab));
  ["users", "splash", "stats"].forEach(t => {
    const p = $(`admin-${t}-panel`);
    if (p) p.classList.toggle("hidden", t !== tab);
  });
  if (tab === "splash" && !state.adminSplashLoaded) loadAdminSplash();
  if (tab === "stats") loadAdminStats();
}
async function loadAdminUsers(searchTerm = "") {
  const el = $("admin-users-list");
  if (!el) return;
  el.innerHTML = "Memuat...";
  try {
    let users = [];
    if (searchTerm) {
      const q = query(collection(db, "users"), where("username", "==", searchTerm.toLowerCase()));
      const snap = await getDocs(q);
      users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      const q = query(collection(db, "users"), limit(100));
      const snap = await getDocs(q);
      users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    users.sort((a, b) => (a.username || "").localeCompare(b.username || ""));
    if (users.length === 0) { el.innerHTML = `<p class="search-user-hint">Tidak ada user.</p>`; return; }
    el.innerHTML = "";
    users.forEach(u => el.appendChild(renderAdminUserItem(u)));
  } catch (e) {
    el.innerHTML = `<p class="search-user-hint">Gagal: ${escapeHtml(e.message)}</p>`;
  }
}
function renderAdminUserItem(user) {
  const uname = user.username || "user";
  const avatar = user.photoURL || generateAvatar(uname);
  const item = document.createElement("div");
  item.className = "admin-user-item";
  item.innerHTML = `
    <img class="admin-user-avatar" src="${avatar}" alt="avatar" />
    <div class="admin-user-info">
      <div class="admin-user-name">
        ${escapeHtml(uname)}
        ${user.isVerified ? ' <span class="badge-verified">✓</span>' : ""}
        ${user.isAdmin ? ' <span class="badge-admin">👑</span>' : ""}
        ${user.isPremium ? ' <span class="badge-premium">💎</span>' : ""}
      </div>
      <div class="admin-user-meta">${user.followers || 0} followers · ${escapeHtml(user.email || "")}</div>
    </div>
    <div class="admin-user-actions">
      <button class="admin-act-btn" data-act="followers" title="Suntik followers">+F</button>
      <button class="admin-act-btn ${user.isVerified ? "on" : ""}" data-act="verify" title="Toggle verified">✓</button>
      <button class="admin-act-btn ${user.isAdmin ? "on" : ""}" data-act="admin" title="Toggle admin">👑</button>
      <button class="admin-act-btn ${user.isPremium ? "on" : ""}" data-act="premium" title="Toggle premium">💎</button>
    </div>`;
  item.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", () => handleAdminAction(btn.dataset.act, user));
  });
  return item;
}
async function handleAdminAction(act, user) {
  if (!state.isAdmin) return showToast("Hanya admin.", "error");
  try {
    if (act === "followers") {
      const raw = prompt(`Tambah followers untuk "${user.username}"?\n(Masukkan angka, boleh minus)`, "100");
      if (!raw) return;
      const amt = parseInt(raw, 10);
      if (isNaN(amt) || amt === 0) return showToast("Angka tidak valid.", "error");
      await updateDoc(doc(db, "users", user.uid), { followers: increment(amt) });
      showToast(`Followers ${user.username} ${amt > 0 ? "+" : ""}${amt}`, "success");
      loadAdminUsers($("admin-user-search")?.value || "");
    } else if (act === "verify") {
      await updateDoc(doc(db, "users", user.uid), { isVerified: !user.isVerified });
      showToast(`Verified ${user.username}: ${!user.isVerified}`, "success");
      loadAdminUsers($("admin-user-search")?.value || "");
    } else if (act === "admin") {
      await updateDoc(doc(db, "users", user.uid), { isAdmin: !user.isAdmin });
      showToast(`Admin ${user.username}: ${!user.isAdmin}`, "success");
      loadAdminUsers($("admin-user-search")?.value || "");
    } else if (act === "premium") {
      await updateDoc(doc(db, "users", user.uid), { isPremium: !user.isPremium });
      showToast(`Premium ${user.username}: ${!user.isPremium}`, "success");
      loadAdminUsers($("admin-user-search")?.value || "");
    }
  } catch (e) { showToast("Gagal: " + (e.message || ""), "error"); }
}
async function loadAdminSplash() {
  state.adminSplashLoaded = true;
  try {
    const snap = await getDoc(doc(db, "settings", "splash"));
    const preview = $("admin-splash-preview");
    const textEl = $("admin-splash-text");
    const linkEl = $("admin-splash-link");
    if (snap.exists()) {
      const d = snap.data();
      state.adminSplashBase64 = d.bannerBase64 || null;
      if (preview) preview.style.backgroundImage = d.bannerBase64 ? `url(${d.bannerBase64})` : "";
      if (textEl) textEl.value = d.text || "";
      if (linkEl) linkEl.value = d.downloadLink || "https://t.me/maklov4";
    } else {
      if (linkEl) linkEl.value = "https://t.me/maklov4";
    }
  } catch (e) { showToast("Gagal load splash.", "error"); }
}
async function handleAdminSplashUpload(e) {
  const file = e.target?.files?.[0];
  if (!file) return;
  try {
    const base64 = await compressImage(file, 1200, 0.75);
    state.adminSplashBase64 = base64;
    if ($("admin-splash-preview")) $("admin-splash-preview").style.backgroundImage = `url(${base64})`;
    showToast("Banner siap. Klik Simpan.", "info");
  } catch (err) { showToast(err.message || "Gagal proses.", "error"); }
}
async function saveAdminSplash() {
  if (!state.isAdmin) return;
  try {
    const text = $("admin-splash-text")?.value || "";
    const link = $("admin-splash-link")?.value || "";
    const data = { text, downloadLink: link };
    if (state.adminSplashBase64) data.bannerBase64 = state.adminSplashBase64;
    await setDoc(doc(db, "settings", "splash"), data, { merge: true });
    showToast("Splash tersimpan!", "success");
  } catch (e) { showToast("Gagal simpan.", "error"); }
}
async function loadAdminStats() {
  const el = $("admin-stats-content");
  if (!el) return;
  el.textContent = "Memuat...";
  try {
    const [usersSnap, postsSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "posts"))
    ]);
    let verified = 0, admin = 0, premium = 0;
    usersSnap.forEach(d => {
      const data = d.data();
      if (data.isVerified) verified++;
      if (data.isAdmin) admin++;
      if (data.isPremium) premium++;
    });
    el.innerHTML = `
      <div class="admin-stat-item"><span class="admin-stat-value">${usersSnap.size}</span><span class="admin-stat-label">Total Users</span></div>
      <div class="admin-stat-item"><span class="admin-stat-value">${postsSnap.size}</span><span class="admin-stat-label">Total Posts</span></div>
      <div class="admin-stat-item"><span class="admin-stat-value">${verified}</span><span class="admin-stat-label">Verified</span></div>
      <div class="admin-stat-item"><span class="admin-stat-value">${admin}</span><span class="admin-stat-label">Admins</span></div>
      <div class="admin-stat-item"><span class="admin-stat-value">${premium}</span><span class="admin-stat-label">Premium</span></div>`;
  } catch (e) {
    el.innerHTML = `<p class="search-user-hint">Gagal: ${escapeHtml(e.message)}</p>`;
  }
}
function initAdminDashboard() {
  if ($("admin-close")) $("admin-close").addEventListener("click", closeAdminDashboard);
  if ($("admin-backdrop")) $("admin-backdrop").addEventListener("click", closeAdminDashboard);
  document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => showAdminTab(tab.dataset.tab));
  });
  if ($("admin-user-search")) {
    let t = null;
    $("admin-user-search").addEventListener("input", (e) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => loadAdminUsers(e.target.value.trim()), 500);
    });
  }
  if ($("admin-splash-upload")) $("admin-splash-upload").addEventListener("click", () => $("admin-splash-file")?.click());
  if ($("admin-splash-file")) $("admin-splash-file").addEventListener("change", handleAdminSplashUpload);
  if ($("admin-splash-save")) $("admin-splash-save").addEventListener("click", saveAdminSplash);
}

// =========================================================
// VOICE CALL (PeerJS)
// =========================================================
function initPeer() {
  if (typeof Peer === "undefined") { console.warn("PeerJS tidak dimuat"); return; }
  if (state.peer) return;
  try {
    state.peer = new Peer();
    state.peer.on("open", (id) => console.log("PeerJS ready:", id));
    state.peer.on("error", (err) => console.warn("PeerJS err:", err));
    state.peer.on("call", async (incomingCall) => {
      if (state.currentCall) { try { incomingCall.close(); } catch (e) {} return; }
      state.currentCall = incomingCall;
      try {
        incomingCall.answer(state.localStream);
        incomingCall.on("stream", playRemoteStream);
        incomingCall.on("close", () => endCall(true));
        incomingCall.on("error", (e) => { console.warn("call err:", e); endCall(true); });
      } catch (e) { console.warn("answer err:", e); endCall(true); }
    });
  } catch (e) { console.warn("initPeer err:", e); }
}
function playRemoteStream(remoteStream) {
  let audioEl = $("remote-audio");
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = "remote-audio";
    audioEl.autoplay = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
  }
  audioEl.srcObject = remoteStream;
  audioEl.play().catch((e) => console.warn("play err:", e));
  const status = $("call-ongoing-status");
  if (status) status.textContent = "Terhubung";
}
function startCallListener() {
  if (state.incomingCallListenerUnsub) { try { state.incomingCallListenerUnsub(); } catch (e) {} }
  if (!state.user) return;
  const q = query(collection(db, "calls"), where("calleeUid", "==", state.user.uid), where("status", "==", "ringing"));
  state.incomingCallListenerUnsub = onSnapshot(q, (snap) => {
    snap.docChanges().forEach(change => {
      if (change.type === "added" && !state.currentCall && !state.callId) {
        const data = change.doc.data();
        state.callId = change.doc.id;
        state.callRole = "callee";
        const nameEl = $("call-incoming-name");
        if (nameEl) nameEl.textContent = data.callerName || "User";
        if ($("call-incoming-modal")) $("call-incoming-modal").classList.remove("hidden");
        state.callTimeout = setTimeout(() => {
          rejectCall();
        }, 45000);
      }
    });
  }, (err) => console.warn("call listener err:", err));
}
async function startOutgoingCall() {
  if (checkGuestBlocked("panggilan")) return;
  if (!state.currentChat || state.currentChat.type !== "dm") return;
  if (!state.peer) return showToast("Layanan panggilan belum siap. Coba lagi.", "error");
  const otherUid = (state.currentChat.members || []).find(u => u !== state.user.uid);
  if (!otherUid) return;
  const other = await getUserCached(otherUid);
  if (!other) return showToast("User tidak ditemukan.", "error");

  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.callRole = "caller";
    const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    state.callId = callId;
    await setDoc(doc(db, "calls", callId), {
      callerUid: state.user.uid,
      callerName: state.profile?.username || "User",
      calleeUid: otherUid,
      calleeName: other.username || "User",
      status: "ringing",
      createdAt: serverTimestamp()
    });
    if ($("call-ongoing-name")) $("call-ongoing-name").textContent = other.username || "User";
    if ($("call-ongoing-status")) $("call-ongoing-status").textContent = "Memanggil...";
    if ($("call-ongoing-modal")) $("call-ongoing-modal").classList.remove("hidden");
    state.callUnsub = onSnapshot(doc(db, "calls", callId), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.status === "accepted" && state.callRole === "caller" && state.peer && !state.currentCall) {
        try {
          const call = state.peer.call(d.calleePeerId, state.localStream);
          state.currentCall = call;
          call.on("stream", playRemoteStream);
          call.on("close", () => endCall(true));
          call.on("error", (e) => { console.warn("call err:", e); endCall(true); });
          if ($("call-ongoing-status")) $("call-ongoing-status").textContent = "Terhubung";
        } catch (e) { console.warn("call err:", e); endCall(true); }
      } else if (d.status === "rejected" || d.status === "ended") {
        endCall(true);
      }
    });
    state.callTimeout = setTimeout(() => {
      if (state.callRole === "caller" && $("call-ongoing-status")?.textContent === "Memanggil...") {
        showToast("Tidak ada jawaban.", "info");
        endCall();
      }
    }, 45000);
  } catch (e) {
    console.error("startCall err:", e);
    showToast("Gagal panggil (mic denied?).", "error");
    endCall();
  }
}
async function acceptCall() {
  if (!state.callId) return;
  if ($("call-incoming-modal")) $("call-incoming-modal").classList.add("hidden");
  if (state.callTimeout) { clearTimeout(state.callTimeout); state.callTimeout = null; }
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if ($("call-ongoing-name")) $("call-ongoing-name").textContent = $("call-incoming-name")?.textContent || "User";
    if ($("call-ongoing-status")) $("call-ongoing-status").textContent = "Menghubungkan...";
    if ($("call-ongoing-modal")) $("call-ongoing-modal").classList.remove("hidden");
    await updateDoc(doc(db, "calls", state.callId), {
      status: "accepted",
      calleePeerId: state.peer?.id || ""
    });
  } catch (e) {
    console.error("accept err:", e);
    showToast("Gagal terima (mic denied?).", "error");
    endCall();
  }
}
async function rejectCall() {
  if ($("call-incoming-modal")) $("call-incoming-modal").classList.add("hidden");
  if (state.callTimeout) { clearTimeout(state.callTimeout); state.callTimeout = null; }
  if (state.callId) {
    try { await updateDoc(doc(db, "calls", state.callId), { status: "rejected" }); } catch (e) {}
  }
  endCall(true);
}
async function endCall(silent = false) {
  if (state.callTimeout) { clearTimeout(state.callTimeout); state.callTimeout = null; }
  if (state.callUnsub) { try { state.callUnsub(); } catch (e) {} state.callUnsub = null; }
  if (state.currentCall) { try { state.currentCall.close(); } catch (e) {} state.currentCall = null; }
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }
  if (state.callId) {
    const cid = state.callId;
    state.callId = null;
    try {
      await updateDoc(doc(db, "calls", cid), { status: "ended" });
    } catch (e) {}
  }
  const remAudio = $("remote-audio");
  if (remAudio) remAudio.srcObject = null;
  if ($("call-ongoing-modal")) $("call-ongoing-modal").classList.add("hidden");
  if ($("call-incoming-modal")) $("call-incoming-modal").classList.add("hidden");
  state.callRole = null;
  state.muted = false;
  if ($("call-mute")) $("call-mute").textContent = "🎤";
  if (!silent) showToast("Panggilan berakhir.", "info");
}
function toggleMute() {
  if (!state.localStream) return;
  state.muted = !state.muted;
  state.localStream.getAudioTracks().forEach(t => { t.enabled = !state.muted; });
  if ($("call-mute")) $("call-mute").textContent = state.muted ? "🔇" : "🎤";
}
function initCallUI() {
  if ($("call-accept")) $("call-accept").addEventListener("click", acceptCall);
  if ($("call-reject")) $("call-reject").addEventListener("click", rejectCall);
  if ($("call-end")) $("call-end").addEventListener("click", () => endCall());
  if ($("call-mute")) $("call-mute").addEventListener("click", toggleMute);
}

// =========================================================
// MENU HANDLERS (profil)
// =========================================================
function initMenu() {
  if ($("btn-menu")) $("btn-menu").addEventListener("click", () => showToast("Menu utama — pakai tab di bawah.", "info"));
  if ($("btn-bagikan")) {
    $("btn-bagikan").addEventListener("click", async () => {
      const url = window.location.origin;
      if (navigator.share) {
        try { await navigator.share({ title: "Gpyth Chat", url }); } catch (e) {}
      } else {
        try { await navigator.clipboard.writeText(url); showToast("Link disalin!", "success"); }
        catch (e) { showToast(url, "info"); }
      }
    });
  }
  document.querySelectorAll(".profil-menu .menu-item").forEach(item => {
    item.addEventListener("click", () => {
      if (item.id === "btn-logout") return;
      const menu = item.dataset.menu;
      if (menu === "premium") openPremiumModal();
      else if (menu === "admin") openAdminDashboard();
      else if (menu === "shop") openShop();
      else if (menu === "musik") showToast("Musik profil hadir nanti.", "info");
      else if (menu === "pengaturan") showToast("Pengaturan hadir nanti.", "info");
    });
  });
}

// =========================================================
// AUTH GUARD + INIT
// =========================================================
async function initAuth() {
  let resolved = false;
  const showApp = () => {
    if (resolved) return;
    resolved = true;
    if ($("auth-loading")) $("auth-loading").classList.add("hidden");
    if ($("app")) $("app").classList.remove("hidden");
  };
  const redirectToLogin = () => {
    if (resolved) return;
    resolved = true;
    window.location.href = "index.html";
  };
  const handleUser = async (user) => {
    state.user = user;
    state.isGuest = user.isAnonymous;
    state.profile = await ensureUserDoc(user);
    state.isAdmin = !!(state.profile?.isAdmin || state.profile?.username === "maklov1");
    renderProfilPage();
    startProfileListener();
    startPostsCountListener();
    startFeedListener();
    startChatListListener();
    initPeer();
    startCallListener();
    showApp();
  };
  try {
    onAuthStateChanged(auth, async (user) => {
      if (!user) { redirectToLogin(); return; }
      await handleUser(user);
    });
  } catch (e) { redirectToLogin(); }
  setTimeout(async () => {
    if (resolved) return;
    if (auth && auth.currentUser) await handleUser(auth.currentUser);
    else redirectToLogin();
  }, 3000);
}

// =========================================================
// BOOT
// =========================================================
function boot() {
  initNav();
  initLogout();
  initComposer();
  initEditProfil();
  initCropperControls();
  initViewUser();
  initChatUI();
  initReactionPicker();
  initVoiceRecording();
  initNewChatGroupModals();
  initCapsule();
  initPremium();
  initAdminDashboard();
  initCallUI();
  initMenu();
  initAuth();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}