// ============================================================
// main.js — Logika Utama Gpyth Chat
// Feed · Chat · Groups · Profile · Admin · PeerJS Call
// ============================================================

/* ==================== IMPORTS ==================== */
import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, increment,
  getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  parseEmojis, formatText, escapeHtml, compressImage, cropToRatio,
  blobToBase64, formatTime, formatRelativeTime, formatSmartTime,
  formatDuration, debounce, uid, generateGroupId,
  toast, playNotificationSound, getInitials, getAvatarColor,
  REACTION_EMOJIS, truncate, sleep
} from "./utils.js";

/* ==================== HELPERS ==================== */
const $ = (id) => document.getElementById(id);
const $el = (el) => el;

function safeGet(id) { return document.getElementById(id); }
function safeOn(id, evt, handler) {
  const el = safeGet(id);
  if (el) el.addEventListener(evt, handler);
}
function safeHtml(id, html) {
  const el = safeGet(id);
  if (el) el.innerHTML = html;
}
function show(id) { const el = safeGet(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = safeGet(id); if (el) el.classList.add('hidden'); }

function openModal(id) {
  const el = safeGet(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = safeGet(id);
  if (el) el.classList.remove('open');
}

function chatRoomId(members, type = 'dm', groupId = null) {
  if (type === 'group' && groupId) return `group_${groupId}`;
  return `dm_${[...members].sort().join('_')}`;
}

async function getOrCreateDM(otherUid) {
  const myUid = currentUser.uid;
  const id = chatRoomId([myUid, otherUid]);
  const ref = doc(db, 'chats', id);
  const snap = await getDoc(ref);
  if (snap.exists()) return id;

  const otherData = await getUserData(otherUid);
  const otherName = otherData?.displayName || otherData?.username || 'User';
  const myName = currentUserData?.displayName || currentUserData?.username || 'Me';

  await setDoc(ref, {
    type: 'dm',
    members: [myUid, otherUid],
    memberNames: { [myUid]: myName, [otherUid]: otherName },
    lastMessage: '',
    lastSenderId: '',
    lastMessageAt: serverTimestamp(),
    pinnedMessage: null,
    readAt: {},
    createdAt: serverTimestamp()
  });
  return id;
}

/* ==================== STATE ==================== */
let currentUser = null;
let currentUserData = null;
let currentTab = 'feed';

let feedUnsub = null;
let chatListUnsub = null;
let activeChat = null;          // { id, type, otherUid, groupData, chatData }
let activeChatDocUnsub = null;  // chat doc meta (pinned, etc)
let activeMessagesUnsub = null;
let activeTypingUnsub = null;
let lastSeenInterval = null;
let typingResetTimeout = null;
let typingBroadcastTimeout = null;

let composerImageData = null;
let replyTo = null;
let capsuleMinutes = 0;

const usersCache = {};
const readMarked = new Set();
const unreadCounts = {};

// Cropper instance
let cropperInstance = null;

// Recording
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;

// PeerJS
let peer = null;
let currentCall = null;         // { id, otherUid, otherData, direction, status }
let callDocUnsub = null;
let incomingCallUnsub = null;
let localStream = null;
let remoteAudioEl = null;

/* ==================== AVATAR RENDER ==================== */
function renderAvatarInto(container, user, fallbackId, imgId) {
  if (!container) return;
  const fallback = fallbackId ? safeGet(fallbackId) : null;
  const img = imgId ? safeGet(imgId) : null;
  if (!user) {
    if (fallback) { fallback.textContent = '?'; fallback.style.background = getAvatarColor('?'); fallback.classList.remove('hidden'); }
    if (img) img.classList.add('hidden');
    return;
  }
  const photo = user.photoURL;
  const initials = getInitials(user.displayName || user.username || '?');
  if (photo && img) {
    img.src = photo;
    img.classList.remove('hidden');
    if (fallback) fallback.classList.add('hidden');
  } else {
    if (img) img.classList.add('hidden');
    if (fallback) {
      fallback.textContent = initials;
      fallback.style.background = getAvatarColor(user.uid || user.username || '?');
      fallback.style.color = '#08120f';
      fallback.classList.remove('hidden');
    }
  }
}

/* ==================== TAB SWITCH ==================== */
function switchTab(name) {
  currentTab = name;
  ['feed', 'chat', 'groups', 'profile'].forEach((t) => {
    const panel = safeGet('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    const btn = safeGet('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.classList.toggle('active', t === name);
    if (btn) btn.classList.toggle('active', t === name);
  });
  if (name === 'chat') refreshChatListUI();
  if (name === 'profile') refreshProfileUI();
}

['feed', 'chat', 'groups', 'profile'].forEach((t) => {
  safeOn('tabBtn' + t.charAt(0).toUpperCase() + t.slice(1), 'click', () => switchTab(t));
});

/* ==================== AUTH OBSERVER ==================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  currentUser = user;
  await loadCurrentUserData();
  initHeader();
  initFeed();
  initChatList();
  initChatRoom();
  initGroups();
  initProfile();
  initModals();
  initAdmin();
  initCall();
  startPresenceHeartbeat();
  listenIncomingCalls();
});

async function loadCurrentUserData() {
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    if (snap.exists()) {
      currentUserData = { uid: currentUser.uid, ...snap.data() };
    } else {
      currentUserData = {
        uid: currentUser.uid,
        username: currentUser.isAnonymous ? 'Tamu_' + currentUser.uid.slice(0, 6) : 'user',
        displayName: currentUser.isAnonymous ? 'Tamu' : 'User',
        isGuest: currentUser.isAnonymous,
        isAdmin: false, isVerified: false, isPremium: false,
        followers: 0, following: 0, followingList: []
      };
      await setDoc(doc(db, 'users', currentUser.uid), currentUserData);
    }
    usersCache[currentUser.uid] = currentUserData;
  } catch (err) {
    console.error('[loadCurrentUserData]', err);
    toast('Gagal memuat profil.', 'error');
  }
}

async function getUserData(uid) {
  if (usersCache[uid]) return usersCache[uid];
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) {
      usersCache[uid] = { uid, ...snap.data() };
      return usersCache[uid];
    }
  } catch (_) {}
  return null;
}

/* ==================== HEADER ==================== */
function initHeader() {
  renderAvatarInto(
    safeGet('headerAvatarBtn'),
    currentUserData,
    'headerAvatarFallback',
    'headerAvatarImg'
  );
  renderAvatarInto(
    safeGet('composerAvatar'),
    currentUserData,
    'composerAvatarFallback',
    null
  );

  // Admin button
  const isAdmin = currentUserData?.username === 'maklov1' || currentUserData?.isAdmin === true;
  const adminBtn = safeGet('headerAdminBtn');
  if (adminBtn) adminBtn.classList.toggle('hidden', !isAdmin);

  safeOn('headerAdminBtn', 'click', () => {
    switchTab('profile');
    setTimeout(() => {
      const el = safeGet('adminSection');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  });

  safeOn('headerAvatarBtn', 'click', () => switchTab('profile'));
}

/* ==================== PRESENCE / LAST SEEN ==================== */
function startPresenceHeartbeat() {
  if (lastSeenInterval) clearInterval(lastSeenInterval);
  const update = async () => {
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        lastSeen: serverTimestamp()
      });
    } catch (_) {}
  };
  update();
  lastSeenInterval = setInterval(update, 20000);
}

function isOnline(user) {
  if (!user || !user.lastSeen) return false;
  const t = user.lastSeen.toDate ? user.lastSeen.toDate() : new Date(user.lastSeen);
  return Date.now() - t.getTime() < 60000;
}

/* ==================== FEED ==================== */
function initFeed() {
  if (feedUnsub) feedUnsub();
  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));

  feedUnsub = onSnapshot(q, (snap) => {
    const container = safeGet('feedList');
    if (!container) return;
    if (snap.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="emoji">🌌</div>
          <h3>Belum ada postingan</h3>
          <p>Jadilah yang pertama!</p>
        </div>`;
      return;
    }
    let html = '';
    snap.forEach((d) => {
      const p = d.data();
      const id = d.id;
      const liked = (p.likedBy || []).includes(currentUser.uid);
      const isOwner = p.authorId === currentUser.uid;
      const authorName = escapeHtml(p.authorName || 'User');
      const authorPhoto = p.authorPhoto || null;
      const initials = getInitials(authorName);

      html += `<div class="post-card" data-post-id="${id}">
        <div class="post-header">
          <div class="post-avatar">
            ${authorPhoto
              ? `<img src="${authorPhoto}" alt="" />`
              : `<div class="avatar-fallback" style="background:${getAvatarColor(p.authorId)};color:#08120f;">${initials}</div>`}
          </div>
          <div class="post-meta">
            <div class="post-author">${authorName}
              ${p.authorVerified ? '<span class="badge badge-verified">✓</span>' : ''}
            </div>
            <div class="post-time">${formatRelativeTime(p.createdAt)}</div>
          </div>
        </div>
        ${p.text ? `<div class="post-content">${formatText(p.text)}</div>` : ''}
        ${p.image ? `<div class="post-image" data-image="${id}"><img src="${p.image}" alt="" loading="lazy" /></div>` : ''}
        <div class="post-actions">
          <button class="post-action-btn ${liked ? 'liked' : ''}" data-like="${id}">
            <span>${liked ? '❤' : '♡'}</span>
            <span>${(p.likedBy || []).length}</span>
          </button>
          ${isOwner ? `<button class="post-action-btn danger" data-delete="${id}" style="margin-left:auto;">🗑 Hapus</button>` : ''}
        </div>
      </div>`;
    });
    container.innerHTML = html;

    // Attach click listeners
    container.querySelectorAll('[data-like]').forEach((btn) => {
      btn.addEventListener('click', () => toggleLike(btn.dataset.like));
    });
    container.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => confirmDeletePost(btn.dataset.delete));
    });
    container.querySelectorAll('[data-image]').forEach((img) => {
      img.addEventListener('click', () => {
        const realImg = img.querySelector('img');
        if (realImg) openImageViewer(realImg.src);
      });
    });
  }, (err) => console.error('[feed]', err));

  // Composer bind
  safeOn('composerImageBtn', 'click', () => safeGet('composerImageInput')?.click());
  safeOn('composerImageInput', 'change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, 1080, 1080, 0.72);
      composerImageData = b64;
      const preview = safeGet('composerImagePreview');
      const img = safeGet('composerImagePreviewImg');
      if (img) img.src = b64;
      if (preview) preview.classList.add('show');
    } catch (err) {
      toast('Gagal memproses gambar.', 'error');
    }
    e.target.value = '';
  });
  safeOn('composerRemoveImage', 'click', () => {
    composerImageData = null;
    const preview = safeGet('composerImagePreview');
    if (preview) preview.classList.remove('show');
  });
  safeOn('composerPostBtn', 'click', submitPost);

  const ta = safeGet('composerText');
  if (ta) {
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(220, ta.scrollHeight) + 'px';
    });
  }
}

async function submitPost() {
  const ta = safeGet('composerText');
  const text = (ta?.value || '').trim();
  if (!text && !composerImageData) {
    toast('Tulis sesuatu atau pilih gambar.', 'info');
    return;
  }
  if (currentUserData?.isGuest) {
    toast('Mode tamu tidak bisa posting.', 'error');
    return;
  }
  const btn = safeGet('composerPostBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }
  try {
    await addDoc(collection(db, 'posts'), {
      authorId: currentUser.uid,
      authorName: currentUserData?.displayName || currentUserData?.username || 'User',
      authorPhoto: currentUserData?.photoURL || null,
      authorVerified: currentUserData?.isVerified || false,
      text,
      image: composerImageData || null,
      likedBy: [],
      createdAt: serverTimestamp()
    });
    if (ta) { ta.value = ''; ta.style.height = 'auto'; }
    composerImageData = null;
    safeGet('composerImagePreview')?.classList.remove('show');
    toast('Postingan dibuat!', 'success');
  } catch (err) {
    console.error(err);
    toast('Gagal posting.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Posting'; }
  }
}

async function toggleLike(postId) {
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }
  const ref = doc(db, 'posts', postId);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const liked = (snap.data().likedBy || []).includes(currentUser.uid);
    await updateDoc(ref, {
      likedBy: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid)
    });
  } catch (err) {
    toast('Gagal like.', 'error');
  }
}

function confirmDeletePost(postId) {
  showConfirm(
    'Hapus Postingan',
    'Yakin ingin menghapus postingan ini?',
    async () => {
      try {
        await deleteDoc(doc(db, 'posts', postId));
        toast('Postingan dihapus.', 'success');
      } catch (_) { toast('Gagal menghapus.', 'error'); }
    }
  );
}

/* ==================== CHAT LIST ==================== */
function initChatList() {
  if (chatListUnsub) chatListUnsub();
  const q = query(
    collection(db, 'chats'),
    where('members', 'array-contains', currentUser.uid),
    orderBy('lastMessageAt', 'desc'),
    limit(60)
  );

  chatListUnsub = onSnapshot(q, async (snap) => {
    const container = safeGet('chatListContainer');
    if (!container) return;
    if (snap.empty) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="emoji">✉</div>
          <h3>Belum ada chat</h3>
          <p>Cari user di kolom atas untuk mulai.</p>
        </div>`;
      updateChatBadge(0);
      return;
    }

    const chatRows = [];
    for (const d of snap.docs) {
      const data = d.data();
      chatRows.push({ id: d.id, ...data });
    }

    // Hydrate other users for DMs
    for (const chat of chatRows) {
      if (chat.type === 'dm') {
        const otherUid = (chat.members || []).find((u) => u !== currentUser.uid);
        chat.otherUid = otherUid;
        chat.otherData = otherUid ? await getUserData(otherUid) : null;
      }
    }

    const searchTerm = (safeGet('chatSearchInput')?.value || '').toLowerCase().trim();
    let totalUnread = 0;
    let html = '';

    for (const chat of chatRows) {
      let displayName, avatarHtml, otherUser = null, online = false;
      if (chat.type === 'group') {
        displayName = chat.groupName || 'Grup';
        avatarHtml = `<div class="avatar-fallback" style="background:${getAvatarColor(chat.id)};color:#08120f;">${getInitials(displayName)}</div>`;
      } else {
        otherUser = chat.otherData;
        displayName = otherUser?.displayName || otherUser?.username || 'User';
        online = isOnline(otherUser);
        if (otherUser?.photoURL) {
          avatarHtml = `<img src="${otherUser.photoURL}" alt="" />`;
        } else {
          avatarHtml = `<div class="avatar-fallback" style="background:${getAvatarColor(chat.otherUid)};color:#08120f;">${getInitials(displayName)}</div>`;
        }
      }

      if (searchTerm && !displayName.toLowerCase().includes(searchTerm)) continue;

      // unread
      const readAt = chat.readAt?.[currentUser.uid];
      const readAtMs = readAt?.toDate ? readAt.toDate().getTime() : 0;
      const lastAtMs = chat.lastMessageAt?.toDate ? chat.lastMessageAt.toDate().getTime() : 0;
      const unread = chat.lastSenderId && chat.lastSenderId !== currentUser.uid && lastAtMs > readAtMs;
      if (unread) totalUnread++;

      const preview = chat.lastMessage || '';
      const previewText = chat.type === 'group' && chat.lastSenderId
        ? `<b>${escapeHtml(chat.memberNames?.[chat.lastSenderId] || 'User')}:</b> ${escapeHtml(truncate(preview, 40))}`
        : escapeHtml(truncate(preview, 40));

      html += `<div class="chat-item ${activeChat?.id === chat.id ? 'active' : ''}"
                    data-chat-id="${chat.id}" data-chat-type="${chat.type}"
                    data-other-uid="${chat.otherUid || ''}">
        <div class="chat-avatar-wrap">
          <div class="chat-avatar">${avatarHtml}</div>
          <span class="online-dot ${online ? 'online' : ''}"></span>
        </div>
        <div class="chat-info">
          <div class="chat-name">
            ${escapeHtml(displayName)}
            ${chat.type === 'group' ? `<span class="text-dim" style="font-size:11px;">${chat.groupId || ''}</span>` : ''}
            ${otherUser?.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}
          </div>
          <div class="chat-preview">${previewText || '<span class="text-dim">Belum ada pesan</span>'}</div>
        </div>
        <div class="chat-meta">
          <div class="chat-time">${chat.lastMessageAt ? formatSmartTime(chat.lastMessageAt) : ''}</div>
          ${unread ? `<div class="unread-badge">•</div>` : ''}
        </div>
      </div>`;
    }

    container.innerHTML = html || `<div class="empty-state"><div class="emoji">🔍</div><h3>Tidak ditemukan</h3></div>`;
    updateChatBadge(totalUnread);

    container.querySelectorAll('[data-chat-id]').forEach((el) => {
      el.addEventListener('click', () => {
        openChat(el.dataset.chatId, el.dataset.chatType, el.dataset.otherUid || null);
      });
    });
  }, (err) => console.error('[chatList]', err));

  // Search
  const search = safeGet('chatSearchInput');
  if (search) {
    search.addEventListener('input', debounce(async () => {
      const term = search.value.trim().toLowerCase();
      if (term.length < 2) { initChatList(); return; }
      // Live search for existing chats
      const container = safeGet('chatListContainer');
      if (!container) return;
      // Try to find matching user
      try {
        const uSnap = await getDoc(doc(db, 'usernames', term));
        if (uSnap.exists() && uSnap.data().uid !== currentUser.uid) {
          const targetUid = uSnap.data().uid;
          const targetData = await getUserData(targetUid);
          const name = targetData?.displayName || targetData?.username || term;
          const avatar = targetData?.photoURL
            ? `<img src="${targetData.photoURL}" alt="" />`
            : `<div class="avatar-fallback" style="background:${getAvatarColor(targetUid)};color:#08120f;">${getInitials(name)}</div>`;
          container.innerHTML = `
            <div class="chat-item" data-start-dm="${targetUid}">
              <div class="chat-avatar-wrap"><div class="chat-avatar">${avatar}</div></div>
              <div class="chat-info">
                <div class="chat-name">${escapeHtml(name)} ${targetData?.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}</div>
                <div class="chat-preview text-neon">Tap untuk mulai chat</div>
              </div>
            </div>`;
          container.querySelector('[data-start-dm]')?.addEventListener('click', async () => {
            try {
              const chatId = await getOrCreateDM(targetUid);
              openChat(chatId, 'dm', targetUid);
            } catch (err) { toast('Gagal buka chat.', 'error'); }
          });
        }
      } catch (_) {}
    }, 350));
  }
}

function updateChatBadge(count) {
  const badge = safeGet('chatTabBadge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function refreshChatListUI() {
  // will be re-triggered by snapshot; force a quick re-render via search clear
  const search = safeGet('chatSearchInput');
  if (search && search.value.trim()) {
    search.value = '';
    initChatList();
  }
}

/* ==================== CHAT ROOM ==================== */
function initChatRoom() {
  safeOn('chatRoomBack', 'click', closeChatRoom);
  safeOn('chatRoomOptionsBtn', 'click', () => openModal('chatOptionsModal'));
  safeOn('chatRoomCallBtn', 'click', startOutgoingCall);
  safeOn('chatRoomCallBtn', 'click', () => {
    if (activeChat?.type === 'group') {
      toast('Voice call hanya tersedia di DM.', 'info');
    }
  });

  // Input
  const input = safeGet('chatInput');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(130, input.scrollHeight) + 'px';
      handleTypingBroadcast();
      const sendBtn = safeGet('chatSendBtn');
      const voiceBtn = safeGet('chatVoiceBtn');
      const hasText = input.value.trim().length > 0;
      if (sendBtn) sendBtn.classList.toggle('hidden', !hasText);
      if (voiceBtn) voiceBtn.classList.toggle('hidden', hasText);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 768) {
        e.preventDefault();
        sendTextMessage();
      }
    });
  }

  safeOn('chatSendBtn', 'click', sendTextMessage);
  safeOn('replyCancelBtn', 'click', clearReplyPreview);
  safeOn('pinnedBannerClose', 'click', clearPinnedMessage);

  // Image
  safeOn('chatAttachBtn', 'click', () => safeGet('chatAttachInput')?.click());
  safeOn('chatAttachInput', 'change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file, 1080, 1080, 0.72);
      await sendImageMessage(b64);
    } catch (err) { toast('Gagal proses gambar.', 'error'); }
    e.target.value = '';
  });

  // Voice
  safeOn('chatVoiceBtn', 'click', startRecording);
  safeOn('recorderCancelBtn', 'click', () => stopRecording(false));
  safeOn('recorderSendBtn', 'click', () => stopRecording(true));

  // Chat options
  safeOn('chatOptionProfile', 'click', () => {
    closeModal('chatOptionsModal');
    if (activeChat?.type === 'dm' && activeChat.otherUid) {
      openUserProfileModal(activeChat.otherUid);
    } else if (activeChat?.type === 'group') {
      openGroupInfoModal();
    }
  });
  safeOn('chatOptionClear', 'click', () => {
    closeModal('chatOptionsModal');
    showConfirm('Bersihkan Chat', 'Hapus semua pesan di chat ini?', async () => {
      if (!activeChat) return;
      try {
        const msgsRef = collection(db, 'chats', activeChat.id, 'messages');
        const msgs = await getDocs(msgsRef);
        const batch = writeBatch(db);
        msgs.forEach((m) => batch.delete(m.ref));
        batch.update(doc(db, 'chats', activeChat.id), { lastMessage: '', lastSenderId: '', pinnedMessage: null });
        await batch.commit();
        toast('Chat dibersihkan.', 'success');
      } catch (err) { toast('Gagal.', 'error'); }
    });
  });
  safeOn('btnChatOptionsClose', 'click', () => closeModal('chatOptionsModal'));

  // Capsule button (add dynamically)
  const inputArea = safeGet('chatInputArea');
  if (inputArea && !safeGet('chatCapsuleBtn')) {
    const btn = document.createElement('button');
    btn.id = 'chatCapsuleBtn';
    btn.type = 'button';
    btn.className = 'chat-tool-btn';
    btn.title = 'Kapsul Waktu';
    btn.innerHTML = '⏱';
    btn.style.display = 'none';
    inputArea.insertBefore(btn, inputArea.firstChild);
    btn.addEventListener('click', () => {
      const m = prompt('Kapsul waktu (menit, 0 = matikan):', '5');
      if (m === null) return;
      const n = parseInt(m, 10);
      if (isNaN(n) || n < 0) return;
      capsuleMinutes = n;
      btn.style.color = n > 0 ? 'var(--neon)' : 'var(--text-3)';
      btn.style.background = n > 0 ? 'var(--neon-soft)' : '';
      if (n > 0) toast(`Kapsul aktif: ${n} menit`, 'info');
    });
    if (inputArea) inputArea.insertBefore(btn, inputArea.firstChild);
  }
}

async function openChat(chatId, chatType, otherUid) {
  try {
    const chatRef = doc(db, 'chats', chatId);
    const chatSnap = await getDoc(chatRef);
    if (!chatSnap.exists()) { toast('Chat tidak ditemukan.', 'error'); return; }
    const chatData = { id: chatId, ...chatSnap.data() };

    let otherData = null;
    if (chatType === 'dm' && otherUid) {
      otherData = await getUserData(otherUid);
    }

    activeChat = {
      id: chatId, type: chatType, otherUid, otherData,
      chatData, groupData: chatType === 'group' ? chatData : null
    };

    // Update header
    const nameEl = safeGet('chatRoomName');
    const statusEl = safeGet('chatRoomStatus');
    const avatarEl = safeGet('chatRoomAvatar');
    const callBtn = safeGet('chatRoomCallBtn');

    if (chatType === 'group') {
      if (nameEl) nameEl.textContent = chatData.groupName || 'Grup';
      if (statusEl) statusEl.textContent = `${(chatData.members || []).length} anggota · ${chatData.groupId || ''}`;
      if (avatarEl) {
        avatarEl.innerHTML = `<div class="avatar-fallback" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:${getAvatarColor(chatId)};color:#08120f;font-weight:800;font-size:14px;">${getInitials(chatData.groupName || 'Grup')}</div>`;
      }
      if (callBtn) callBtn.style.display = 'none';
    } else {
      const name = otherData?.displayName || otherData?.username || 'User';
      if (nameEl) nameEl.innerHTML = `${escapeHtml(name)} ${otherData?.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}`;
      if (statusEl) {
        statusEl.textContent = isOnline(otherData) ? 'Online' : 'Offline';
        statusEl.className = 'chat-room-status ' + (isOnline(otherData) ? 'online' : '');
      }
      if (avatarEl) {
        if (otherData?.photoURL) {
          avatarEl.innerHTML = `<img src="${otherData.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;" />`;
        } else {
          avatarEl.innerHTML = `<div class="avatar-fallback" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:${getAvatarColor(otherUid)};color:#08120f;font-weight:800;">${getInitials(name)}</div>`;
        }
      }
      if (callBtn) callBtn.style.display = '';
    }

    // Show room
    const room = safeGet('chatRoom');
    if (room) room.classList.add('open');

    // Reset state
    clearReplyPreview();
    readMarked.clear();

    // Subscribe chat meta (pinned banner + update)
    if (activeChatDocUnsub) activeChatDocUnsub();
    activeChatDocUnsub = onSnapshot(chatRef, (snap) => {
      if (!snap.exists()) return;
      const d = { id: snap.id, ...snap.data() };
      activeChat.chatData = d;
      renderPinnedBanner(d.pinnedMessage);
    });

    // Subscribe messages
    if (activeMessagesUnsub) activeMessagesUnsub();
    const msgsQ = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200)
    );
    activeMessagesUnsub = onSnapshot(msgsQ, async (snap) => {
      const msgs = [];
      snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
      renderMessages(msgs);
      // Mark as read
      await markMessagesRead(chatId, msgs);
      // Update readAt
      try {
        await updateDoc(chatRef, { [`readAt.${currentUser.uid}`]: serverTimestamp() });
      } catch (_) {}
    });

    // Typing subscription (for DM)
    if (activeTypingUnsub) activeTypingUnsub();
    if (chatType === 'dm' && otherUid) {
      activeTypingUnsub = onSnapshot(doc(db, 'users', otherUid), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const statusEl2 = safeGet('chatRoomStatus');
        if (!statusEl2) return;
        const typing = d.typingIn === chatId;
        if (typing) {
          statusEl2.textContent = 'sedang mengetik...';
          statusEl2.className = 'chat-room-status typing';
        } else {
          statusEl2.textContent = isOnline(d) ? 'Online' : 'Offline';
          statusEl2.className = 'chat-room-status ' + (isOnline(d) ? 'online' : '');
        }
      });
    }

    // Show capsule button for this chat
    const capBtn = safeGet('chatCapsuleBtn');
    if (capBtn) capBtn.style.display = '';

  } catch (err) {
    console.error('[openChat]', err);
    toast('Gagal membuka chat.', 'error');
  }
}

function closeChatRoom() {
  const room = safeGet('chatRoom');
  if (room) room.classList.remove('open');
  if (activeMessagesUnsub) { activeMessagesUnsub(); activeMessagesUnsub = null; }
  if (activeChatDocUnsub) { activeChatDocUnsub(); activeChatDocUnsub = null; }
  if (activeTypingUnsub) { activeTypingUnsub(); activeTypingUnsub = null; }
  if (activeChat) {
    try {
      updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null }).catch(() => {});
    } catch (_) {}
  }
  activeChat = null;
  clearReplyPreview();
}

function renderPinnedBanner(pinned) {
  const banner = safeGet('pinnedBanner');
  const text = safeGet('pinnedBannerText');
  if (!banner) return;
  if (pinned && pinned.id) {
    if (text) {
      text.innerHTML = `<b>${escapeHtml(pinned.senderName || 'Pesan')}:</b> ${escapeHtml(truncate(pinned.text || '📷 Media', 60))}`;
    }
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function clearPinnedMessage() {
  if (!activeChat) return;
  updateDoc(doc(db, 'chats', activeChat.id), { pinnedMessage: null }).catch(() => {});
}

function renderMessages(msgs) {
  const container = safeGet('chatMessagesArea');
  if (!container) return;

  const now = new Date();
  const myUid = currentUser.uid;
  let html = '';
  let lastDay = '';

  for (const m of msgs) {
    // Date separator
    const d = m.createdAt?.toDate ? m.createdAt.toDate() : (m.createdAt ? new Date(m.createdAt) : new Date(0));
    const dayStr = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    if (dayStr !== lastDay) {
      html += `<div class="date-sep">${dayStr}</div>`;
      lastDay = dayStr;
    }

    const isOwn = m.senderId === myUid;
    const isGroup = activeChat?.type === 'group';
    const senderName = isGroup && !isOwn
      ? `<div class="bubble-sender">${escapeHtml(m.senderName || 'User')}</div>`
      : '';

    // Kapsul waktu — hidden for recipient if before unlockTime
    const unlockAt = m.unlockTime?.toDate ? m.unlockTime.toDate() : null;
    const locked = unlockAt && unlockAt > now && !isOwn;
    if (locked) {
      const remaining = Math.max(1, Math.round((unlockAt - now) / 60000));
      html += `<div class="bubble-row ${isOwn ? 'outgoing' : 'incoming'}" data-msg-id="${m.id}">
        <div class="chat-bubble" style="opacity:0.8;">
          <div style="display:flex;align-items:center;gap:8px;color:var(--text-2);">
            <span>🔒</span>
            <span>Pesan terkunci — terbuka dalam ${remaining} menit</span>
          </div>
          <div class="bubble-meta">${formatTime(m.createdAt)}</div>
        </div>
      </div>`;
      continue;
    }

    // Reply preview
    let replyHtml = '';
    if (m.replyTo) {
      replyHtml = `<div class="bubble-reply">
        <span class="bubble-reply-name">${escapeHtml(m.replyTo.senderName || 'User')}</span>
        <span class="bubble-reply-text">${escapeHtml(truncate(m.replyTo.text || '📷 Media', 50))}</span>
      </div>`;
    }

    // Body
    let body = '';
    if (m.type === 'text') {
      body = `<div class="bubble-text">${formatText(m.text || '')}</div>`;
    } else if (m.type === 'image') {
      body = `<div class="bubble-image" data-view="${m.id}"><img src="${m.image}" alt="" loading="lazy" /></div>`;
      if (m.text) body += `<div>${formatText(m.text)}</div>`;
    } else if (m.type === 'voice') {
      body = `<div class="bubble-voice" data-voice="${m.id}" data-audio="${m.audio}">
        <button class="voice-play-btn" type="button">▶</button>
        <div class="voice-waveform"></div>
        <span class="voice-duration">${formatDuration(m.audioDuration || 0)}</span>
      </div>`;
    }

    // Read receipt
    const readCount = (m.readBy || []).length;
    const othersRead = isOwn && (m.readBy || []).some((u) => u !== myUid);
    let checkHtml = '';
    if (isOwn) {
      checkHtml = `<span class="bubble-check ${othersRead ? 'read' : 'sent'}">${othersRead ? '✓✓' : '✓'}</span>`;
    }

    // Reactions
    let reactionsHtml = '';
    const reactions = m.reactions || {};
    const reactionEntries = Object.entries(reactions).filter(([_, list]) => list && list.length);
    if (reactionEntries.length) {
      reactionsHtml = `<div class="bubble-reactions">`;
      for (const [emoji, list] of reactionEntries) {
        const self = list.includes(myUid);
        reactionsHtml += `<span class="bubble-reaction-chip ${self ? 'self' : ''}" data-react-msg="${m.id}" data-react-emoji="${escapeHtml(emoji)}">
          ${parseEmojis(emoji)} ${list.length}
        </span>`;
      }
      reactionsHtml += `</div>`;
    }

    html += `<div class="bubble-row ${isOwn ? 'outgoing' : 'incoming'}" data-msg-id="${m.id}" data-own="${isOwn}">
      <span class="swipe-indicator">↩</span>
      <div class="chat-bubble">
        ${senderName}${replyHtml}${body}
        <div class="bubble-meta">
          <span>${formatTime(m.createdAt)}</span>
          ${checkHtml}
        </div>
        ${reactionsHtml}
      </div>
    </div>`;
  }

  // Typing indicator (append)
  if (activeChat?.type === 'dm' && activeChat.otherData) {
    // Live typing handled via status above; but also inline
    const other = activeChat.otherData;
    // Will be updated by typing listener; skipping inline to avoid dupe
  }

  container.innerHTML = html;

  // Bind events
  container.querySelectorAll('[data-view]').forEach((el) => {
    el.addEventListener('click', () => {
      const img = el.querySelector('img');
      if (img) openImageViewer(img.src);
    });
  });
  container.querySelectorAll('[data-voice]').forEach((el) => {
    el.addEventListener('click', () => toggleVoicePlayback(el));
  });
  container.querySelectorAll('[data-react-msg]').forEach((chip) => {
    chip.addEventListener('click', () => toggleReaction(chip.dataset.reactMsg, chip.dataset.reactEmoji));
  });

  // Attach swipe + long-press
  container.querySelectorAll('.bubble-row').forEach((row) => {
    attachSwipeAndLongPress(row);
  });

  // Scroll to bottom
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function attachSwipeAndLongPress(row) {
  if (!row.dataset.msgId) return;
  let startX = 0, startY = 0, moved = false, swiping = false;
  let longPressTimer = null;

  const onStart = (x, y) => {
    startX = x; startY = y; moved = false; swiping = false;
    longPressTimer = setTimeout(() => {
      if (!moved) showLongPressMenu(row);
    }, 500);
  };
  const onMove = (x, y) => {
    if (!startX) return;
    const dx = x - startX;
    const dy = y - startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      moved = true;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      swiping = true;
      const clamp = Math.max(-120, Math.min(120, dx));
      row.style.transform = `translateX(${clamp}px)`;
      row.classList.toggle('swiping', Math.abs(dx) > 30);
    }
  };
  const onEnd = (x, _y) => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    const dx = x - startX;
    row.style.transform = '';
    row.classList.remove('swiping');
    if (swiping && Math.abs(dx) > 60) {
      if (dx > 0) {
        // swipe right → reply
        setReplyTo(row.dataset.msgId);
      } else {
        // swipe left → delete
        if (row.dataset.own === 'true') {
          confirmDeleteMessage(row.dataset.msgId);
        }
      }
    }
    startX = 0; startY = 0; swiping = false;
  };

  row.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  row.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  row.addEventListener('touchend', (e) => onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY), { passive: true });

  // Desktop drag
  let mouseDown = false;
  row.addEventListener('mousedown', (e) => { mouseDown = true; onStart(e.clientX, e.clientY); });
  row.addEventListener('mousemove', (e) => { if (mouseDown) onMove(e.clientX, e.clientY); });
  row.addEventListener('mouseup', (e) => { if (mouseDown) { mouseDown = false; onEnd(e.clientX, e.clientY); } });
  row.addEventListener('mouseleave', () => { if (mouseDown) { mouseDown = false; if (longPressTimer) clearTimeout(longPressTimer); row.style.transform = ''; row.classList.remove('swiping'); } });
}

function showLongPressMenu(row) {
  const msgId = row.dataset.msgId;
  const isOwn = row.dataset.own === 'true';
  const isGroupAdmin = activeChat?.type === 'group' && activeChat.chatData?.groupAdmin === currentUser.uid;

  // Remove existing menu
  const existing = document.querySelector('.emoji-picker-float');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'emoji-picker-float';

  // Reactions
  REACTION_EMOJIS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<img class="apple-emoji" src="https://emojicdn.elk.sh/${encodeURIComponent(emoji)}?style=apple" alt="${emoji}" style="width:22px;height:22px;" />`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleReaction(msgId, emoji);
      menu.remove();
    });
    menu.appendChild(btn);
  });

  // Pin (group admin or own message)
  if (isOwn || isGroupAdmin) {
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.textContent = '📌';
    pinBtn.title = 'Pin';
    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await pinMessage(msgId);
      menu.remove();
    });
    menu.appendChild(pinBtn);
  }

  // Delete (own)
  if (isOwn) {
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '🗑';
    delBtn.title = 'Hapus';
    delBtn.style.color = 'var(--danger)';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      confirmDeleteMessage(msgId);
    });
    menu.appendChild(delBtn);
  }

  const bubble = row.querySelector('.chat-bubble');
  if (bubble) {
    bubble.style.position = 'relative';
    bubble.appendChild(menu);
  }

  // Dismiss on outside click
  setTimeout(() => {
    const dismiss = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', dismiss);
      }
    };
    document.addEventListener('click', dismiss);
  }, 10);
}

async function toggleReaction(msgId, emoji) {
  if (!activeChat) return;
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }
  try {
    const ref = doc(db, 'chats', activeChat.id, 'messages', msgId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const reactions = { ...(snap.data().reactions || {}) };
    const list = reactions[emoji] || [];
    let newList;
    if (list.includes(currentUser.uid)) {
      newList = list.filter((u) => u !== currentUser.uid);
    } else {
      newList = [...list, currentUser.uid];
    }
    if (newList.length) reactions[emoji] = newList;
    else delete reactions[emoji];
    await updateDoc(ref, { reactions });
  } catch (err) { console.error(err); }
}

async function pinMessage(msgId) {
  if (!activeChat) return;
  try {
    const snap = await getDoc(doc(db, 'chats', activeChat.id, 'messages', msgId));
    if (!snap.exists()) return;
    const m = snap.data();
    await updateDoc(doc(db, 'chats', activeChat.id), {
      pinnedMessage: {
        id: msgId,
        text: m.type === 'text' ? (m.text || '') : (m.type === 'image' ? '📷 Foto' : '🎤 Voice'),
        senderName: m.senderName || 'User'
      }
    });
    toast('Pesan di-pin.', 'success');
  } catch (err) { toast('Gagal pin.', 'error'); }
}

function setReplyTo(msgId) {
  if (!activeChat) return;
  getDoc(doc(db, 'chats', activeChat.id, 'messages', msgId)).then((snap) => {
    if (!snap.exists()) return;
    const m = snap.data();
    replyTo = {
      id: msgId,
      senderName: m.senderName || 'User',
      text: m.type === 'text' ? (m.text || '') : (m.type === 'image' ? '📷 Foto' : '🎤 Voice')
    };
    const bar = safeGet('replyPreviewBar');
    const nameEl = safeGet('replyBarName');
    const textEl = safeGet('replyBarText');
    if (nameEl) nameEl.textContent = replyTo.senderName;
    if (textEl) textEl.textContent = truncate(replyTo.text, 40);
    if (bar) bar.classList.remove('hidden');
    safeGet('chatInput')?.focus();
  });
}

function clearReplyPreview() {
  replyTo = null;
  safeGet('replyPreviewBar')?.classList.add('hidden');
}

function confirmDeleteMessage(msgId) {
  showConfirm('Hapus Pesan', 'Yakin ingin menghapus pesan ini?', async () => {
    if (!activeChat) return;
    try {
      await deleteDoc(doc(db, 'chats', activeChat.id, 'messages', msgId));
      toast('Pesan dihapus.', 'success');
    } catch (_) { toast('Gagal hapus.', 'error'); }
  });
}

async function toggleVoicePlayback(el) {
  const audioData = el.dataset.audio;
  if (!audioData) return;
  const btn = el.querySelector('.voice-play-btn');
  const wave = el.querySelector('.voice-waveform');
  // Stop existing
  if (el._audio) {
    el._audio.pause();
    el._audio = null;
    if (btn) btn.textContent = '▶';
    if (wave) wave.style.setProperty('--progress', '0%');
    return;
  }
  const audio = new Audio(audioData);
  el._audio = audio;
  if (btn) btn.textContent = '⏸';
  audio.addEventListener('timeupdate', () => {
    if (wave && audio.duration) {
      const pct = (audio.currentTime / audio.duration) * 100;
      wave.style.setProperty('--progress', pct + '%');
      const after = wave.querySelector('::after');
      // Use inline style instead
      wave.innerHTML = `<div style="position:absolute;left:0;top:0;bottom:0;width:${pct}%;background:var(--neon);border-radius:2px;"></div>`;
    }
  });
  audio.addEventListener('ended', () => {
    el._audio = null;
    if (btn) btn.textContent = '▶';
    if (wave) wave.innerHTML = '';
  });
  audio.play().catch(() => {});
}

/* ==================== SEND MESSAGES ==================== */
async function sendTextMessage() {
  const input = safeGet('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  if (!activeChat) return;
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }

  const payload = buildMessagePayload('text', { text });
  input.value = '';
  input.style.height = 'auto';
  safeGet('chatSendBtn')?.classList.add('hidden');
  safeGet('chatVoiceBtn')?.classList.remove('hidden');

  await sendMessagePayload(payload);
}

async function sendImageMessage(base64) {
  if (!activeChat) return;
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }
  const payload = buildMessagePayload('image', { image: base64 });
  await sendMessagePayload(payload);
}

async function sendVoiceMessage(base64, durationSec) {
  if (!activeChat) return;
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }
  const payload = buildMessagePayload('voice', { audio: base64, audioDuration: durationSec });
  await sendMessagePayload(payload);
}

function buildMessagePayload(type, fields) {
  const senderName = currentUserData?.displayName || currentUserData?.username || 'User';
  const payload = {
    senderId: currentUser.uid,
    senderName,
    senderPhoto: currentUserData?.photoURL || null,
    type,
    text: fields.text || '',
    image: fields.image || null,
    audio: fields.audio || null,
    audioDuration: fields.audioDuration || 0,
    replyTo: replyTo ? { ...replyTo } : null,
    reactions: {},
    readBy: [currentUser.uid],
    unlockTime: null,
    createdAt: serverTimestamp()
  };
  if (capsuleMinutes > 0) {
    payload.unlockTime = new Date(Date.now() + capsuleMinutes * 60 * 1000);
    capsuleMinutes = 0;
    const capBtn = safeGet('chatCapsuleBtn');
    if (capBtn) { capBtn.style.color = ''; capBtn.style.background = ''; }
  }
  return payload;
}

async function sendMessagePayload(payload) {
  if (!activeChat) return;
  try {
    const msgsRef = collection(db, 'chats', activeChat.id, 'messages');
    await addDoc(msgsRef, payload);

    // Update chat lastMessage
    const preview = payload.type === 'text'
      ? payload.text
      : (payload.type === 'image' ? '📷 Foto' : '🎤 Voice Note');
    await updateDoc(doc(db, 'chats', activeChat.id), {
      lastMessage: preview,
      lastSenderId: currentUser.uid,
      lastMessageAt: serverTimestamp()
    });

    clearReplyPreview();

    // Stop typing
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null });
    } catch (_) {}
  } catch (err) {
    console.error('[sendMessage]', err);
    toast('Gagal mengirim pesan.', 'error');
  }
}

/* ==================== TYPING ==================== */
function handleTypingBroadcast() {
  if (!activeChat) return;
  if (typingResetTimeout) clearTimeout(typingResetTimeout);

  if (typingBroadcastTimeout) return; // throttle
  typingBroadcastTimeout = setTimeout(() => {
    typingBroadcastTimeout = null;
  }, 3000);

  updateDoc(doc(db, 'users', currentUser.uid), {
    typingIn: activeChat.id
  }).catch(() => {});

  typingResetTimeout = setTimeout(() => {
    updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null }).catch(() => {});
  }, 4000);
}

/* ==================== MARK READ ==================== */
async function markMessagesRead(chatId, msgs) {
  const myUid = currentUser.uid;
  const promises = [];
  for (const m of msgs) {
    if (m.senderId !== myUid && !(m.readBy || []).includes(myUid) && !readMarked.has(m.id)) {
      readMarked.add(m.id);
      promises.push(
        updateDoc(doc(db, 'chats', chatId, 'messages', m.id), {
          readBy: arrayUnion(myUid)
        }).catch(() => {})
      );
    }
  }
  if (promises.length) await Promise.all(promises);
}

/* ==================== VOICE RECORDING ==================== */
async function startRecording() {
  if (!activeChat) return;
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start();
    recordingStartTime = Date.now();

    safeGet('chatInputArea')?.classList.add('hidden');
    safeGet('recorderBar')?.classList.remove('hidden');
    const timerEl = safeGet('recorderTimer');
    if (timerEl) timerEl.textContent = '0:00';

    recordingTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recordingStartTime) / 1000);
      if (timerEl) timerEl.textContent = formatDuration(s);
      if (s >= 120) stopRecording(true); // max 2 min
    }, 250);
  } catch (err) {
    toast('Tidak bisa akses mikrofon.', 'error');
  }
}

async function stopRecording(send) {
  if (!mediaRecorder) return;
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  const durationSec = (Date.now() - recordingStartTime) / 1000;

  return new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      try {
        if (mediaRecorder.stream) {
          mediaRecorder.stream.getTracks().forEach((t) => t.stop());
        }
        if (send && audioChunks.length) {
          const blob = new Blob(audioChunks, { type: 'audio/webm' });
          const b64 = await blobToBase64(blob);
          await sendVoiceMessage(b64, Math.round(durationSec));
        }
      } catch (err) {
        console.error('[stopRecording]', err);
      } finally {
        mediaRecorder = null;
        audioChunks = [];
        recordingStartTime = null;
        safeGet('recorderBar')?.classList.add('hidden');
        safeGet('chatInputArea')?.classList.remove('hidden');
        resolve();
      }
    };
    try { mediaRecorder.stop(); } catch (_) { resolve(); }
  });
}

/* ==================== GROUPS ==================== */
function initGroups() {
  safeOn('btnCreateGroupCard', 'click', () => openModal('createGroupModal'));
  safeOn('btnJoinGroupCard', 'click', () => openModal('joinGroupModal'));
  safeOn('btnCreateGroupClose', 'click', () => closeModal('createGroupModal'));
  safeOn('btnJoinGroupClose', 'click', () => closeModal('joinGroupModal'));
  safeOn('btnCreateGroupCancel', 'click', () => closeModal('createGroupModal'));
  safeOn('btnJoinGroupCancel', 'click', () => closeModal('joinGroupModal'));
  safeOn('btnGroupInfoClose', 'click', () => closeModal('groupInfoModal'));
  safeOn('btnGroupInfoOk', 'click', () => closeModal('groupInfoModal'));

  safeOn('btnCreateGroupConfirm', 'click', createGroup);
  safeOn('btnJoinGroupConfirm', 'click', joinGroup);
  safeOn('btnGroupLeave', 'click', leaveGroup);

  loadGroupsList();
}

async function loadGroupsList() {
  const container = safeGet('groupsListContainer');
  if (!container) return;
  try {
    const q = query(
      collection(db, 'groups'),
      where('members', 'array-contains', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(40)
    );
    onSnapshot(q, (snap) => {
      if (snap.empty) {
        container.innerHTML = `<div class="empty-state" style="padding:40px 20px;">
          <div class="emoji">◈</div>
          <h3>Belum ada grup</h3>
          <p>Buat atau join dengan ID grup.</p>
        </div>`;
        return;
      }
      let html = '';
      snap.forEach((d) => {
        const g = d.data();
        html += `<div class="group-card" data-group-id="${g.groupId}">
          <div class="group-avatar">${getInitials(g.name)}</div>
          <div class="group-card-info">
            <div class="group-card-name">${escapeHtml(g.name)}</div>
            <div class="group-card-id">${escapeHtml(g.groupId)} · ${(g.members || []).length} anggota</div>
          </div>
          <div style="color:var(--text-3);">›</div>
        </div>`;
      });
      container.innerHTML = html;
      container.querySelectorAll('[data-group-id]').forEach((el) => {
        el.addEventListener('click', () => openGroupChat(el.dataset.groupId));
      });
    });
  } catch (err) {
    console.error('[loadGroupsList]', err);
  }
}

async function createGroup() {
  const nameInput = safeGet('createGroupName');
  const name = (nameInput?.value || '').trim();
  if (!name) { toast('Nama grup wajib.', 'error'); return; }
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }

  const btn = safeGet('btnCreateGroupConfirm');
  if (btn) btn.disabled = true;

  try {
    let groupId;
    // Ensure unique groupId
    for (let i = 0; i < 5; i++) {
      groupId = generateGroupId();
      const ex = await getDoc(doc(db, 'groups', groupId));
      if (!ex.exists()) break;
      if (i === 4) { toast('Coba lagi.', 'error'); return; }
    }

    const myName = currentUserData?.displayName || currentUserData?.username || 'User';
    await setDoc(doc(db, 'groups', groupId), {
      groupId,
      name,
      members: [currentUser.uid],
      memberNames: { [currentUser.uid]: myName },
      groupAdmin: currentUser.uid,
      createdAt: serverTimestamp()
    });

    // Also create chat entry
    const chatId = `group_${groupId}`;
    await setDoc(doc(db, 'chats', chatId), {
      type: 'group',
      members: [currentUser.uid],
      memberNames: { [currentUser.uid]: myName },
      groupId,
      groupName: name,
      groupAdmin: currentUser.uid,
      lastMessage: '',
      lastSenderId: '',
      lastMessageAt: serverTimestamp(),
      pinnedMessage: null,
      readAt: {},
      createdAt: serverTimestamp()
    });

    toast(`Grup dibuat: ${groupId}`, 'success');
    closeModal('createGroupModal');
    if (nameInput) nameInput.value = '';
    switchTab('chat');
  } catch (err) {
    console.error(err);
    toast('Gagal buat grup.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function joinGroup() {
  const input = safeGet('joinGroupId');
  const groupId = (input?.value || '').toUpperCase().trim();
  if (!/^HZ-[A-Z0-9]{4}$/.test(groupId)) {
    toast('Format: HZ-XXXX', 'error');
    return;
  }
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }

  try {
    const ref = doc(db, 'groups', groupId);
    const snap = await getDoc(ref);
    if (!snap.exists()) { toast('Grup tidak ditemukan.', 'error'); return; }
    const g = snap.data();
    if ((g.members || []).includes(currentUser.uid)) {
      toast('Sudah di grup.', 'info');
      openGroupChat(groupId);
      closeModal('joinGroupModal');
      return;
    }
    const myName = currentUserData?.displayName || currentUserData?.username || 'User';
    await updateDoc(ref, {
      members: arrayUnion(currentUser.uid),
      [`memberNames.${currentUser.uid}`]: myName
    });
    // Update chat
    const chatId = `group_${groupId}`;
    await updateDoc(doc(db, 'chats', chatId), {
      members: arrayUnion(currentUser.uid),
      [`memberNames.${currentUser.uid}`]: myName
    }).catch(async () => {
      // fallback
      await setDoc(doc(db, 'chats', chatId), {
        type: 'group',
        members: [...g.members, currentUser.uid],
        memberNames: { ...g.memberNames, [currentUser.uid]: myName },
        groupId, groupName: g.name,
        groupAdmin: g.groupAdmin,
        lastMessage: '', lastSenderId: '',
        lastMessageAt: serverTimestamp(),
        pinnedMessage: null,
        readAt: {},
        createdAt: serverTimestamp()
      });
    });

    toast('Berhasil join grup.', 'success');
    closeModal('joinGroupModal');
    if (input) input.value = '';
    openGroupChat(groupId);
  } catch (err) {
    console.error(err);
    toast('Gagal join grup.', 'error');
  }
}

async function openGroupChat(groupId) {
  try {
    const chatId = `group_${groupId}`;
    openChat(chatId, 'group', null);
  } catch (err) {
    toast('Gagal buka grup.', 'error');
  }
}

function openGroupInfoModal() {
  if (!activeChat || activeChat.type !== 'group') return;
  const chat = activeChat.chatData;
  safeGet('groupInfoName').textContent = chat.groupName || '-';
  safeGet('groupInfoId').textContent = chat.groupId || '-';
  safeGet('groupInfoMemberCount').textContent = (chat.members || []).length;

  const membersContainer = safeGet('groupInfoMembers');
  if (membersContainer) {
    membersContainer.innerHTML = '';
    (chat.members || []).forEach((uid) => {
      const name = chat.memberNames?.[uid] || uid;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;';
      row.innerHTML = `
        <div style="width:32px;height:32px;border-radius:50%;background:${getAvatarColor(uid)};display:flex;align-items:center;justify-content:center;color:#08120f;font-weight:700;font-size:12px;">${getInitials(name)}</div>
        <span>${escapeHtml(name)}</span>
        ${uid === chat.groupAdmin ? '<span class="badge badge-admin">Admin</span>' : ''}
      `;
      membersContainer.appendChild(row);
    });
  }
  openModal('groupInfoModal');
}

async function leaveGroup() {
  if (!activeChat || activeChat.type !== 'group') return;
  showConfirm('Keluar Grup', 'Yakin keluar dari grup ini?', async () => {
    try {
      const { groupId } = activeChat.chatData;
      if (!groupId) return;
      await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(currentUser.uid) });
      await updateDoc(doc(db, 'chats', activeChat.id), { members: arrayRemove(currentUser.uid) }).catch(() => {});
      closeModal('groupInfoModal');
      closeChatRoom();
      toast('Keluar dari grup.', 'success');
    } catch (err) { toast('Gagal keluar.', 'error'); }
  });
}

/* ==================== PROFILE ==================== */
function initProfile() {
  safeOn('profileAvatarBtn', 'click', () => safeGet('profileAvatarInput')?.click());
  safeOn('profileBannerEditBtn', 'click', () => safeGet('profileBannerInput')?.click());

  safeOn('profileAvatarInput', 'change', handleAvatarSelect);
  safeOn('profileBannerInput', 'change', handleBannerSelect);

  safeOn('profileEditBtn', 'click', openEditProfileModal);
  safeOn('btnEditProfileClose', 'click', () => closeModal('editProfileModal'));
  safeOn('btnEditProfileCancel', 'click', () => closeModal('editProfileModal'));
  safeOn('btnSaveProfile', 'click', saveProfile);

  // Cropper
  safeOn('btnCropperClose', 'click', closeCropper);
  safeOn('btnCropperCancel', 'click', closeCropper);

  // Follow stats
  safeOn('profileStatFollowers', 'click', () => openFollowList('followers'));
  safeOn('profileStatFollowing', 'click', () => openFollowList('following'));

  // Menu
  safeOn('menuShop', 'click', () => { window.open('https://t.me/maklov1', '_blank'); });
  safeOn('menuSettings', 'click', () => toast('Settings coming soon.', 'info'));
  safeOn('menuLogout', 'click', confirmLogout);

  // Follow list modal
  safeOn('btnFollowListClose', 'click', () => closeModal('followListModal'));

  refreshProfileUI();
}

function refreshProfileUI() {
  if (!currentUserData) return;

  // Avatar
  renderAvatarInto(
    document.querySelector('.profile-avatar'),
    currentUserData,
    'profileAvatarFallback',
    'profileAvatarImg'
  );

  // Banner
  const bannerImg = safeGet('profileBannerImg');
  if (bannerImg) {
    if (currentUserData.banner) {
      bannerImg.src = currentUserData.banner;
      bannerImg.classList.remove('hidden');
    } else {
      bannerImg.classList.add('hidden');
    }
  }

  // Info
  const nameEl = safeGet('profileName');
  if (nameEl) {
    nameEl.innerHTML = `${escapeHtml(currentUserData.displayName || currentUserData.username || 'User')}
      ${currentUserData.isVerified ? '<span class="badge badge-verified">✓ Terverifikasi</span>' : ''}
      ${currentUserData.isPremium ? '<span class="badge badge-premium">★ Premium</span>' : ''}
      ${currentUserData.isAdmin || currentUserData.username === 'maklov1' ? '<span class="badge badge-admin">⚡ Admin</span>' : ''}
      ${currentUserData.isGuest ? '<span class="badge badge-guest">Tamu</span>' : ''}`;
  }
  const uname = safeGet('profileUsername');
  if (uname) uname.textContent = '@' + (currentUserData.username || '-');
  const bio = safeGet('profileBio');
  if (bio) bio.innerHTML = currentUserData.bio ? parseEmojis(escapeHtml(currentUserData.bio)) : '<span class="text-dim">Belum ada bio.</span>';

  safeGet('profileFollowersCount').textContent = currentUserData.followers || 0;
  safeGet('profileFollowingCount').textContent = currentUserData.following || 0;

  // Music
  const musicWrap = safeGet('profileMusicWrap');
  const audio = safeGet('profileMusicAudio');
  if (currentUserData.musicLink && musicWrap && audio) {
    musicWrap.classList.remove('hidden');
    if (audio.src !== currentUserData.musicLink) audio.src = currentUserData.musicLink;
  } else if (musicWrap) {
    musicWrap.classList.add('hidden');
  }
}

function openEditProfileModal() {
  safeGet('editDisplayName').value = currentUserData?.displayName || '';
  safeGet('editBio').value = currentUserData?.bio || '';
  safeGet('editMusicLink').value = currentUserData?.musicLink || '';
  openModal('editProfileModal');
}

async function saveProfile() {
  const displayName = safeGet('editDisplayName')?.value.trim() || '';
  const bio = safeGet('editBio')?.value.trim() || '';
  const musicLink = safeGet('editMusicLink')?.value.trim() || '';

  if (!displayName) { toast('Nama wajib.', 'error'); return; }
  if (musicLink && !/^https?:\/\//i.test(musicLink)) {
    toast('Link musik tidak valid.', 'error');
    return;
  }

  try {
    await updateDoc(doc(db, 'users', currentUser.uid), { displayName, bio, musicLink });
    currentUserData.displayName = displayName;
    currentUserData.bio = bio;
    currentUserData.musicLink = musicLink;
    refreshProfileUI();
    toast('Profil disimpan.', 'success');
    closeModal('editProfileModal');
  } catch (err) {
    toast('Gagal simpan.', 'error');
  }
}

async function handleAvatarSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const b64 = await compressImage(file, 1200, 1200, 0.85);
    openCropper(b64);
  } catch (err) {
    toast('Gagal proses gambar.', 'error');
  }
  e.target.value = '';
}

function openCropper(dataURL) {
  const img = safeGet('cropperImage');
  if (!img) return;
  img.src = dataURL;
  openModal('cropperModal');
  setTimeout(() => {
    if (typeof Cropper !== 'undefined') {
      if (cropperInstance) cropperInstance.destroy();
      cropperInstance = new Cropper(img, {
        aspectRatio: 1,
        viewMode: 1,
        autoCropArea: 0.9,
        background: false
      });
    }
  }, 100);
}

function closeCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  closeModal('cropperModal');
}

// Cropper save — bound at initModals
async function saveCroppedAvatar() {
  if (!cropperInstance) return;
  try {
    const canvas = cropperInstance.getCroppedCanvas({ width: 400, height: 400 });
    const b64 = canvas.toDataURL('image/jpeg', 0.8);
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: b64 });
    currentUserData.photoURL = b64;
    renderAvatarInto(
      document.querySelector('.profile-avatar'),
      currentUserData,
      'profileAvatarFallback',
      'profileAvatarImg'
    );
    initHeader();
    refreshProfileUI();
    toast('Foto profil diperbarui.', 'success');
    closeCropper();
  } catch (err) {
    toast('Gagal simpan foto.', 'error');
  }
}

async function handleBannerSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const b64 = await cropToRatio(file, 16, 6, 0.72);
    await updateDoc(doc(db, 'users', currentUser.uid), { banner: b64 });
    currentUserData.banner = b64;
    refreshProfileUI();
    toast('Banner diperbarui.', 'success');
  } catch (err) {
    toast('Gagal proses banner.', 'error');
  }
  e.target.value = '';
}

function confirmLogout() {
  showConfirm('Keluar', 'Yakin ingin keluar dari akun?', async () => {
    try {
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      if (peer) peer.destroy();
      await signOut(auth);
      window.location.href = 'index.html';
    } catch (_) {}
  });
}

/* ==================== FOLLOW ==================== */
async function openFollowList(type) {
  const modalTitle = safeGet('followListTitle');
  const container = safeGet('followListContainer');
  if (!container) return;
  container.innerHTML = '<div class="text-center" style="padding:20px;"><span class="spinner"></span></div>';
  if (modalTitle) modalTitle.textContent = type === 'followers' ? 'Followers' : 'Following';
  openModal('followListModal');

  try {
    const field = type === 'followers' ? 'followersList' : 'followingList';
    let uids = [];

    if (type === 'following') {
      uids = currentUserData.followingList || [];
    } else {
      // Query users where followingList contains my uid
      const q = query(collection(db, 'users'), where('followingList', 'array-contains', currentUser.uid), limit(100));
      const snap = await getDocs(q);
      uids = snap.docs.map((d) => d.id);
    }

    if (!uids.length) {
      container.innerHTML = '<div class="empty-state"><div class="emoji">👥</div><h3>Kosong</h3></div>';
      return;
    }
    let html = '';
    for (const u of uids) {
      const data = await getUserData(u);
      if (!data) continue;
      const name = data.displayName || data.username || 'User';
      html += `<div class="chat-item" data-follow-user="${u}" style="padding:10px 0;">
        <div class="chat-avatar-wrap" style="width:40px;height:40px;">
          <div class="chat-avatar" style="width:40px;height:40px;">
            ${data.photoURL ? `<img src="${data.photoURL}" alt="" />` : `<div class="avatar-fallback" style="background:${getAvatarColor(u)};color:#08120f;font-size:14px;">${getInitials(name)}</div>`}
          </div>
        </div>
        <div class="chat-info" style="border-bottom:none;padding-bottom:0;">
          <div class="chat-name" style="font-size:13.5px;">${escapeHtml(name)} ${data.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}</div>
        </div>
      </div>`;
    }
    container.innerHTML = html;
    container.querySelectorAll('[data-follow-user]').forEach((el) => {
      el.addEventListener('click', () => {
        closeModal('followListModal');
        openUserProfileModal(el.dataset.followUser);
      });
    });
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><h3>Gagal memuat</h3></div>';
  }
}

/* ==================== USER PROFILE MODAL ==================== */
async function openUserProfileModal(uid) {
  if (!uid) return;
  if (uid === currentUser.uid) { switchTab('profile'); return; }

  const data = await getUserData(uid);
  if (!data) { toast('User tidak ditemukan.', 'error'); return; }

  const name = data.displayName || data.username || 'User';

  // Banner
  const bannerImg = safeGet('userProfileBanner');
  if (bannerImg) {
    if (data.banner) { bannerImg.src = data.banner; bannerImg.classList.remove('hidden'); }
    else bannerImg.classList.add('hidden');
  }

  // Avatar
  const fallback = safeGet('userProfileAvatarFallback');
  const img = safeGet('userProfileAvatarImg');
  if (data.photoURL && img) {
    img.src = data.photoURL; img.classList.remove('hidden');
    if (fallback) fallback.classList.add('hidden');
  } else {
    if (img) img.classList.add('hidden');
    if (fallback) {
      fallback.textContent = getInitials(name);
      fallback.style.background = getAvatarColor(uid);
      fallback.style.color = '#08120f';
      fallback.classList.remove('hidden');
    }
  }

  safeGet('userProfileName').innerHTML = `${escapeHtml(name)}
    ${data.isVerified ? '<span class="badge badge-verified">✓</span>' : ''}
    ${data.isPremium ? '<span class="badge badge-premium">★</span>' : ''}`;
  safeGet('userProfileUsername').textContent = '@' + (data.username || '-');
  safeGet('userProfileBio').innerHTML = data.bio ? parseEmojis(escapeHtml(data.bio)) : '<span class="text-dim">Belum ada bio.</span>';
  safeGet('userProfileFollowersCount').textContent = data.followers || 0;
  safeGet('userProfileFollowingCount').textContent = data.following || 0;

  // Follow button
  const followBtn = safeGet('btnUserProfileFollow');
  const following = (currentUserData.followingList || []).includes(uid);
  if (followBtn) {
    followBtn.textContent = following ? 'Unfollow' : 'Follow';
    followBtn.className = following ? 'btn-secondary btn-block' : 'btn-primary btn-block';
    followBtn.onclick = () => toggleFollow(uid);
  }

  // Message button (inject if not exists)
  if (!safeGet('btnUserProfileMessage') && followBtn) {
    const msgBtn = document.createElement('button');
    msgBtn.id = 'btnUserProfileMessage';
    msgBtn.type = 'button';
    msgBtn.className = 'btn-secondary btn-block';
    msgBtn.textContent = '💬 Pesan';
    msgBtn.style.marginTop = '8px';
    msgBtn.onclick = async () => {
      try {
        closeModal('userProfileModal');
        const chatId = await getOrCreateDM(uid);
        openChat(chatId, 'dm', uid);
      } catch (err) { toast('Gagal buka chat.', 'error'); }
    };
    followBtn.parentElement.insertBefore(msgBtn, followBtn.nextSibling);
  }

  safeOn('btnUserProfileClose', 'click', () => closeModal('userProfileModal'));

  openModal('userProfileModal');
}

async function toggleFollow(targetUid) {
  if (targetUid === currentUser.uid) return;
  if (currentUserData?.isGuest) { toast('Mode tamu read-only.', 'error'); return; }

  const following = (currentUserData.followingList || []).includes(targetUid);
  try {
    if (following) {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        followingList: arrayRemove(targetUid),
        following: increment(-1)
      });
      await updateDoc(doc(db, 'users', targetUid), {
        followers: increment(-1)
      });
      currentUserData.followingList = currentUserData.followingList.filter((u) => u !== targetUid);
      currentUserData.following = Math.max(0, (currentUserData.following || 0) - 1);
      toast('Unfollow.', 'info');
    } else {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        followingList: arrayUnion(targetUid),
        following: increment(1)
      });
      await updateDoc(doc(db, 'users', targetUid), {
        followers: increment(1)
      });
      currentUserData.followingList = [...(currentUserData.followingList || []), targetUid];
      currentUserData.following = (currentUserData.following || 0) + 1;
      toast('Follow!', 'success');
    }
    delete usersCache[targetUid];
    refreshProfileUI();
    // Refresh user modal
    closeModal('userProfileModal');
  } catch (err) {
    console.error(err);
    toast('Gagal follow.', 'error');
  }
}

/* ==================== ADMIN ==================== */
function initAdmin() {
  const isAdmin = currentUserData?.username === 'maklov1' || currentUserData?.isAdmin === true;
  const section = safeGet('adminSection');
  if (section) section.classList.toggle('hidden', !isAdmin);

  safeOn('btnAdminInject', 'click', adminInjectFollowers);
  safeOn('btnAdminVerify', 'click', adminVerify);
  safeOn('btnAdminPremium', 'click', adminPremium);
  safeOn('btnAdminToggle', 'click', adminToggleAdmin);
  safeOn('btnAdminSplashPick', 'click', () => safeGet('adminSplashImageInput')?.click());
  safeOn('btnAdminSaveSplash', 'click', adminSaveSplash);

  safeOn('adminSplashImageInput', 'change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await cropToRatio(file, 16, 9, 0.72);
      const preview = safeGet('adminSplashPreview');
      if (preview) { preview.src = b64; preview.classList.remove('hidden'); }
      preview.dataset.b64 = b64;
    } catch (err) { toast('Gagal proses.', 'error'); }
    e.target.value = '';
  });

  loadSplashSettings();
}

async function getAdminTarget() {
  const input = safeGet('adminTargetUsername');
  const username = (input?.value || '').toLowerCase().trim();
  if (!username) { toast('Isi username target.', 'error'); return null; }
  try {
    const unameSnap = await getDoc(doc(db, 'usernames', username));
    if (!unameSnap.exists()) { toast('Username tidak ditemukan.', 'error'); return null; }
    return { uid: unameSnap.data().uid, username };
  } catch (err) { toast('Error.', 'error'); return null; }
}

async function adminInjectFollowers() {
  const target = await getAdminTarget();
  if (!target) return;
  try {
    await updateDoc(doc(db, 'users', target.uid), { followers: increment(100) });
    delete usersCache[target.uid];
    toast('+100 followers disuntik.', 'success');
  } catch (_) { toast('Gagal.', 'error'); }
}

async function adminVerify() {
  const target = await getAdminTarget();
  if (!target) return;
  try {
    await updateDoc(doc(db, 'users', target.uid), { isVerified: true });
    delete usersCache[target.uid];
    toast('Terverifikasi.', 'success');
  } catch (_) { toast('Gagal.', 'error'); }
}

async function adminPremium() {
  const target = await getAdminTarget();
  if (!target) return;
  try {
    const snap = await getDoc(doc(db, 'users', target.uid));
    const cur = snap.data().isPremium || false;
    await updateDoc(doc(db, 'users', target.uid), { isPremium: !cur });
    delete usersCache[target.uid];
    toast('Premium ' + (!cur ? 'ON' : 'OFF'), 'success');
  } catch (_) { toast('Gagal.', 'error'); }
}

async function adminToggleAdmin() {
  const target = await getAdminTarget();
  if (!target) return;
  try {
    const snap = await getDoc(doc(db, 'users', target.uid));
    const cur = snap.data().isAdmin || false;
    await updateDoc(doc(db, 'users', target.uid), { isAdmin: !cur });
    delete usersCache[target.uid];
    toast('Admin ' + (!cur ? 'ON' : 'OFF'), 'success');
  } catch (_) { toast('Gagal.', 'error'); }
}

async function loadSplashSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'splash'));
    if (snap.exists()) {
      const d = snap.data();
      const textInput = safeGet('adminSplashText');
      if (textInput && d.text) textInput.value = d.text;
      const preview = safeGet('adminSplashPreview');
      if (preview && d.image) {
        preview.src = d.image;
        preview.classList.remove('hidden');
        preview.dataset.b64 = d.image;
      }
    }
  } catch (_) {}
}

async function adminSaveSplash() {
  const text = safeGet('adminSplashText')?.value || '';
  const preview = safeGet('adminSplashPreview');
  const image = preview?.dataset.b64 || null;
  try {
    await setDoc(doc(db, 'settings', 'splash'), { text, image, updatedAt: serverTimestamp() }, { merge: true });
    toast('Splash disimpan.', 'success');
  } catch (_) { toast('Gagal.', 'error'); }
}

/* ==================== IMAGE VIEWER / CONFIRM ==================== */
function openImageViewer(src) {
  const img = safeGet('imageViewerImg');
  if (img) img.src = src;
  openModal('imageViewerModal');
}

let confirmCallback = null;
function showConfirm(title, text, onYes) {
  const t = safeGet('confirmTitle');
  const tx = safeGet('confirmText');
  if (t) t.textContent = title;
  if (tx) tx.textContent = text;
  confirmCallback = onYes;
  openModal('confirmModal');
}

/* ==================== MODALS INIT ==================== */
function initModals() {
  safeOn('btnImageViewerClose', 'click', () => closeModal('imageViewerModal'));
  safeOn('btnConfirmNo', 'click', () => { confirmCallback = null; closeModal('confirmModal'); });
  safeOn('btnConfirmYes', 'click', async () => {
    const cb = confirmCallback;
    confirmCallback = null;
    closeModal('confirmModal');
    if (cb) await cb();
  });
  safeOn('btnCropperSave', 'click', saveCroppedAvatar);

  // Backdrop click for all modals
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Image viewer close on click backdrop
  const iv = safeGet('imageViewerModal');
  if (iv) iv.addEventListener('click', (e) => { if (e.target === iv) closeModal('imageViewerModal'); });
}

/* ==================== PEERJS CALL ==================== */
function initCall() {
  safeOn('callEndBtn', 'click', endCall);
  safeOn('callAcceptBtn', 'click', acceptIncomingCall);
  safeOn('callMuteBtn', 'click', toggleCallMute);

  // Remote audio element
  if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.autoplay = true;
    remoteAudioEl.style.display = 'none';
    document.body.appendChild(remoteAudioEl);
  }
}

function createPeerInstance() {
  return new Promise((resolve, reject) => {
    if (typeof Peer === 'undefined') { reject(new Error('PeerJS not loaded')); return; }
    const p = new Peer();
    p.on('open', (id) => resolve(p));
    p.on('error', (err) => { try { reject(err); } catch (_) {} });
    setTimeout(() => reject(new Error('Peer timeout')), 15000);
  });
}

async function startOutgoingCall() {
  if (!activeChat || activeChat.type !== 'dm' || !activeChat.otherUid) {
    toast('Voice call hanya di DM.', 'info');
    return;
  }
  if (currentCall) { toast('Sudah ada panggilan aktif.', 'info'); return; }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peer = await createPeerInstance();

    // Create call doc
    const callRef = await addDoc(collection(db, 'calls'), {
      fromUid: currentUser.uid,
      toUid: activeChat.otherUid,
      fromPeerId: peer.id,
      toPeerId: null,
      status: 'ringing',
      createdAt: serverTimestamp()
    });

    currentCall = {
      id: callRef.id,
      otherUid: activeChat.otherUid,
      otherData: activeChat.otherData,
      direction: 'outgoing',
      status: 'ringing',
      peer
    };

    // Show call screen
    showCallScreen(currentCall.otherData, 'Memanggil...', 'outgoing');

    // Listen to call doc
    callDocUnsub = onSnapshot(doc(db, 'calls', callRef.id), (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.status === 'accepted' && d.toPeerId) {
        // Callee accepted — make the actual call
        currentCall.status = 'accepted';
        updateCallStatus('Terhubung');
        const call = peer.call(d.toPeerId, localStream);
        if (call) {
          call.on('stream', (remoteStream) => {
            if (remoteAudioEl) remoteAudioEl.srcObject = remoteStream;
          });
          call.on('close', () => cleanupCall());
        }
      } else if (d.status === 'ended') {
        cleanupCall();
      }
    });

    // Timeout ring 45s
    setTimeout(() => {
      if (currentCall && currentCall.status === 'ringing') {
        endCall();
        toast('Tidak dijawab.', 'info');
      }
    }, 45000);
  } catch (err) {
    console.error('[startOutgoingCall]', err);
    toast('Gagal memulai panggilan.', 'error');
    cleanupCall();
  }
}

function listenIncomingCalls() {
  if (incomingCallUnsub) incomingCallUnsub();
  try {
    const q = query(
      collection(db, 'calls'),
      where('toUid', '==', currentUser.uid),
      where('status', '==', 'ringing'),
      orderBy('createdAt', 'desc'),
      limit(1)
    );
    incomingCallUnsub = onSnapshot(q, async (snap) => {
      if (snap.empty) return;
      const d = snap.docs[0];
      const data = d.data();
      if (currentCall) return; // already in call
      const fromData = await getUserData(data.fromUid);
      currentCall = {
        id: d.id,
        otherUid: data.fromUid,
        otherData: fromData,
        direction: 'incoming',
        status: 'ringing',
        fromPeerId: data.fromPeerId
      };
      showCallScreen(fromData, 'Panggilan masuk...', 'incoming');
    });
  } catch (err) {
    console.error('[listenIncomingCalls]', err);
  }
}

function showCallScreen(otherData, statusText, direction) {
  const screen = safeGet('callScreen');
  if (!screen) return;
  const name = otherData?.displayName || otherData?.username || 'User';
  safeGet('callName').textContent = name;
  safeGet('callStatus').textContent = statusText;

  const fallback = safeGet('callAvatarFallback');
  const img = safeGet('callAvatarImg');
  if (otherData?.photoURL && img) {
    img.src = otherData.photoURL;
    img.classList.remove('hidden');
    if (fallback) fallback.classList.add('hidden');
  } else {
    if (img) img.classList.add('hidden');
    if (fallback) {
      fallback.textContent = getInitials(name);
      fallback.style.background = getAvatarColor(otherData?.uid || name);
      fallback.style.color = '#08120f';
      fallback.classList.remove('hidden');
    }
  }

  safeGet('callAcceptBtn')?.classList.toggle('hidden', direction !== 'incoming');
  screen.classList.add('open');
}

function updateCallStatus(text) {
  const el = safeGet('callStatus');
  if (el) el.textContent = text;
}

async function acceptIncomingCall() {
  if (!currentCall || currentCall.direction !== 'incoming') return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peer = await createPeerInstance();

    // Update call doc
    await updateDoc(doc(db, 'calls', currentCall.id), {
      status: 'accepted',
      toPeerId: peer.id
    });
    currentCall.status = 'accepted';
    safeGet('callAcceptBtn')?.classList.add('hidden');
    updateCallStatus('Terhubung');

    // Listen for incoming call
    peer.on('call', (call) => {
      call.answer(localStream);
      call.on('stream', (remoteStream) => {
        if (remoteAudioEl) remoteAudioEl.srcObject = remoteStream;
      });
      call.on('close', () => cleanupCall());
    });

    // Subscribe call doc for ended
    callDocUnsub = onSnapshot(doc(db, 'calls', currentCall.id), (snap) => {
      if (!snap.exists()) return;
      if (snap.data().status === 'ended') cleanupCall();
    });
  } catch (err) {
    console.error('[acceptIncomingCall]', err);
    toast('Gagal menerima panggilan.', 'error');
    endCall();
  }
}

function toggleCallMute() {
  if (!localStream) return;
  const tracks = localStream.getAudioTracks();
  if (!tracks.length) return;
  const cur = tracks[0].enabled;
  tracks.forEach((t) => (t.enabled = !cur));
  safeGet('callMuteBtn')?.classList.toggle('active', cur);
  updateCallStatus(cur ? 'Muted' : 'Terhubung');
}

async function endCall() {
  if (!currentCall) { cleanupCall(); return; }
  try {
    if (currentCall.id) {
      await updateDoc(doc(db, 'calls', currentCall.id), { status: 'ended', endedAt: serverTimestamp() }).catch(() => {});
    }
  } catch (_) {}
  cleanupCall();
}

function cleanupCall() {
  safeGet('callScreen')?.classList.remove('open');
  if (callDocUnsub) { callDocUnsub(); callDocUnsub = null; }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (peer) {
    try { peer.destroy(); } catch (_) {}
    peer = null;
  }
  if (remoteAudioEl) remoteAudioEl.srcObject = null;
  currentCall = null;
}

/* ==================== GLOBAL BACKDROP ==================== */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach((m) => m.classList.remove('open'));
    if (safeGet('chatRoom')?.classList.contains('open')) closeChatRoom();
  }
});

/* ==================== END ==================== */
console.log('%c[Gpyth Chat] main.js loaded', 'color:#00ffc8;font-weight:bold;');