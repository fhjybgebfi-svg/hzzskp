import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, increment, collection, query, where, getDocs, addDoc, onSnapshot, orderBy, limit, serverTimestamp, arrayUnion } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const fmt = (n) => n >= 1e6 ? (n/1e6).toFixed(1)+'jt' : n >= 1e3 ? (n/1e3).toFixed(1)+'rb' : n;
const compressImage = (file, max=600) => new Promise(res => {
  const r = new FileReader(); r.readAsDataURL(file);
  r.onload = e => { const i = new Image(); i.src = e.target.result; i.onload = () => { const c = document.createElement('canvas'); c.width = max; c.height = i.height * (max/i.width); c.getContext('2d').drawImage(i,0,0,c.width,c.height); res(c.toDataURL('image/jpeg',0.6)); }; };
});

// ============================================
// AUTH
// ============================================
if (document.getElementById('loginForm')) {
  document.getElementById('btnRegister').onclick = async () => {
    const name = document.getElementById('regName').value;
    const user = document.getElementById('regUser').value.toLowerCase().replace(/\s+/g,'');
    const pass = document.getElementById('regPass').value;
    if(!name || !user || pass.length < 6) return alert('Isi data dengan benar!');
    const btn = document.getElementById('btnRegister'); btn.textContent = '...';
    try {
      const c = await createUserWithEmailAndPassword(auth, `${user}@gpyth.chat`, pass);
      const isAdmin = user === 'maklov1';
      await setDoc(doc(db, 'users', c.user.uid), {
        uid: c.user.uid, name, username: user, bio: "Halo!", photoURL: "", bannerURL: "", telegram: "", music: "",
        followersCount: isAdmin ? 100000000 : 0, followingCount: 0, isAdmin, isPremium: isAdmin
      });
      window.location.href = 'main.html';
    } catch(e) { alert(e.code === 'auth/email-already-in-use' ? 'Username sudah dipakai!' : e.message); btn.textContent = 'Daftar'; }
  };
  document.getElementById('btnLogin').onclick = async () => {
    const user = document.getElementById('loginUser').value.toLowerCase();
    try { await signInWithEmailAndPassword(auth, `${user}@gpyth.chat`, document.getElementById('loginPass').value); window.location.href = 'main.html'; }
    catch(e) { alert('Username / Password salah!'); }
  };
}

// ============================================
// MAIN APP (Halaman Utama)
// ============================================
let currentUser = null;
let activeChatUid = null;
let activeGroupId = null;
let cropper = null;
let replyTarget = null;
let typingTimeout = null;
let mediaRecorder; let audioChunks = [];
let peer = null;
let msgUnsub = null; // Buat matiin listener chat lama

if (document.getElementById('feedContainer')) {
  initMain();
}

function initMain() {
  document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
  
  // Settings Vibe
  document.getElementById('btnSettings').onclick = () => document.getElementById('settingsModal').classList.add('active');
  document.querySelectorAll('.vibe-btn').forEach(btn => {
    btn.onclick = () => { document.body.setAttribute('data-theme', btn.dataset.theme); localStorage.setItem('theme', btn.dataset.theme); };
  });

  // Navigasi
  document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      btn.classList.add('active');
      document.getElementById('pageTitle').textContent = btn.dataset.tab.toUpperCase();
      document.getElementById('fabPost').style.display = (btn.dataset.tab === 'beranda' && currentUser) ? 'flex' : 'none';
      document.getElementById('fabAddContact').style.display = (btn.dataset.tab === 'chat' && currentUser) ? 'flex' : 'none';
    };
  });

  // Auth State
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const snap = await getDoc(doc(db, 'users', user.uid));
      if(snap.exists()) {
        currentUser = snap.data();
        document.getElementById('guestProfile').style.display = 'none';
        document.getElementById('ownProfileView').style.display = 'block';
        document.getElementById('fabPost').style.display = 'flex';
        document.getElementById('fabShop').style.display = 'flex';
        if(currentUser.isAdmin) document.getElementById('fabAdmin').style.display = 'flex';
        
        setInterval(() => { updateDoc(doc(db, 'users', currentUser.uid), { lastSeen: serverTimestamp() }); }, 20000);

        // Render Profil
        document.getElementById('myName').textContent = currentUser.name;
        document.getElementById('myUser').textContent = '@' + currentUser.username;
        document.getElementById('myBio').textContent = currentUser.bio;
        document.getElementById('myFollower').textContent = fmt(currentUser.followersCount);
        document.getElementById('myFollowing').textContent = fmt(currentUser.followingCount);
        if(currentUser.photoURL) document.getElementById('myAvatar').src = currentUser.photoURL;
        if(currentUser.isAdmin) document.getElementById('devBadge').style.display = 'inline-block';
        if(currentUser.isPremium) document.getElementById('premBadge').style.display = 'inline-block';
        
        if(currentUser.music) { document.getElementById('myMusic').style.display = 'block'; document.getElementById('profileAudio').src = currentUser.music; }
        if(currentUser.telegram) { const tg = document.getElementById('myTgLink'); tg.style.display = 'inline-block'; tg.href = `https://t.me/${currentUser.telegram.replace('@','')}`; }

        // FIX BUG PEERJS: Inisialisasi ID dengan benar
        if(typeof Peer !== 'undefined') {
          if(!peer) {
            peer = new Peer(currentUser.uid);
            peer.on('call', (call) => {
              if(confirm('Panggilan suara masuk, terima?')) {
                navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
                  call.answer(stream);
                  call.on('stream', (remote) => { const a = new Audio(URL.createObjectURL(remote)); a.play(); });
                });
              }
            });
          }
        }

        loadFeed();
        loadNotifications();
        loadGroups();
        if(currentUser.isAdmin) initAdminLogic();
      }
    } else {
      document.getElementById('guestProfile').style.display = 'block';
      document.getElementById('ownProfileView').style.display = 'none';
      loadFeed();
    }
  });

  // --- FITUR FOLLOWERS ---
  window.showFollowers = () => {
    alert(`Kamu punya ${fmt(currentUser.followersCount)} pengikut! (UI list disederhanakan)`);
  };

  // --- FEED ---
  function loadFeed() {
    const feed = document.getElementById('feedContainer');
    onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(30)), (snap) => {
      feed.innerHTML = snap.empty ? '<p style="text-align:center; padding:20px;">Belum ada postingan.</p>' : '';
      snap.forEach(d => {
        const p = d.data();
        feed.innerHTML += `
          <div class="post-card">
            <img src="${p.authorPhoto || 'https://via.placeholder.com/40'}" class="post-avatar">
            <div class="post-content">
              <div class="post-header"><div>@${p.authorUsername}</div></div>
              <div class="post-text">${p.text}</div>
              ${p.photoURL ? `<img src="${p.photoURL}" class="post-img">` : ''}
              <div class="post-actions"><i class="bi bi-heart"></i> <span style="font-size:12px">${p.likes?.length||0}</span></div>
            </div>
          </div>`;
      });
    });
  }

  document.getElementById('fabPost').onclick = () => document.getElementById('postModal').classList.add('active');
  document.getElementById('btnSubmitPost').onclick = async () => {
    if(!currentUser) return;
    const text = document.getElementById('postText').value;
    const file = document.getElementById('postPhoto').files[0];
    if(!text && !file) return;
    const btn = document.getElementById('btnSubmitPost'); btn.textContent = '...';
    try {
      let base64 = "";
      if(file) base64 = await compressImage(file, 800);
      await addDoc(collection(db, 'posts'), { 
        authorUid: currentUser.uid, authorUsername: currentUser.username, authorPhoto: currentUser.photoURL || "", 
        text, photoURL: base64, likes: [], createdAt: serverTimestamp() 
      });
      document.getElementById('postModal').classList.remove('active'); document.getElementById('postText').value = '';
    } catch(e) { alert('Gagal: ' + e.message); } finally { btn.textContent = 'Posting'; }
  };

  // --- QNA ---
  document.getElementById('btnQnA').onclick = () => document.getElementById('qnaModal').classList.add('active');
  document.getElementById('btnSubmitQna').onclick = async () => {
    const text = document.getElementById('qnaText').value;
    if(!text) return;
    await addDoc(collection(db, 'qna'), { targetUid: currentUser.uid, question: text, createdAt: serverTimestamp() });
    alert('Pertanyaan terkirim!'); document.getElementById('qnaText').value = ''; document.getElementById('qnaModal').classList.remove('active');
  };

  // --- EDIT PROFIL & CROP ---
  document.getElementById('btnEditProfile').onclick = () => {
    document.getElementById('editName').value = currentUser.name;
    document.getElementById('editBio').value = currentUser.bio;
    document.getElementById('editTg').value = currentUser.telegram || '';
    document.getElementById('editMusic').value = currentUser.music || '';
    document.getElementById('editProfileModal').classList.add('active');
  };
  document.getElementById('btnSaveProfile').onclick = async () => {
    await updateDoc(doc(db, 'users', currentUser.uid), {
      name: document.getElementById('editName').value,
      bio: document.getElementById('editBio').value,
      telegram: document.getElementById('editTg').value,
      music: document.getElementById('editMusic').value
    });
    alert('Profil disimpan!'); window.location.reload();
  };

  window.startCrop = (input) => {
    if(input.files[0]) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.getElementById('imageToCrop'); img.src = e.target.result;
        document.getElementById('cropModal').classList.add('active');
        if(cropper) cropper.destroy();
        cropper = new Cropper(img, { aspectRatio: 1, viewMode: 1 });
      };
      reader.readAsDataURL(input.files[0]);
    }
  };
  document.getElementById('btnConfirmCrop').onclick = async () => {
    if(!cropper) return;
    const base64 = cropper.getCroppedCanvas({ width: 400, height: 400 }).toDataURL('image/jpeg', 0.7);
    await updateDoc(doc(db, 'users', currentUser.uid), { photoURL: base64 });
    alert('Foto diupdate!'); window.location.reload();
  };

  // --- NOTIFIKASI ---
  function loadNotifications() {
    onSnapshot(query(collection(db, 'users', currentUser.uid, 'notifs'), orderBy('createdAt', 'desc')), (snap) => {
      const badge = document.getElementById('notifBadge');
      if(snap.empty) return badge.style.display = 'none';
      badge.style.display = 'block'; badge.textContent = snap.size;
      const list = document.getElementById('notifList'); list.innerHTML = '';
      snap.forEach(d => list.innerHTML += `<div style="padding:5px 0; border-bottom:1px solid var(--border);">${d.data().text}</div>`);
    });
  }
  document.getElementById('btnNotif').onclick = () => document.getElementById('notifModal').classList.add('active');

  // --- CHAT (DM, TYPING, CAPSULE, REPLY, IMAGE, MIC, CALL) ---
  const box = document.getElementById('chatMessages');
  document.getElementById('openHzcs').onclick = () => openChat('hzcs_uid', 'HZCS Official');
  document.getElementById('btnBackChat').onclick = () => { document.getElementById('chatOverlay').classList.remove('active'); activeChatUid=null; activeGroupId=null; if(msgUnsub) msgUnsub(); };

  window.openChat = (uid, name) => {
    activeChatUid = uid; activeGroupId = null;
    document.getElementById('chatTitle').textContent = name;
    document.getElementById('chatStatus').style.display = 'block';
    document.getElementById('btnCall').style.display = 'block';
    document.getElementById('chatOverlay').classList.add('active');
    loadMsgs();
    checkStatus(uid);
  };

  function loadMsgs() {
    if(msgUnsub) msgUnsub(); // MATIIN LISTENER LAMA BIAR GA NUMPUK
    const colPath = activeGroupId ? collection(db, 'groups', activeGroupId, 'messages') : collection(db, 'messages');
    
    msgUnsub = onSnapshot(query(colPath, orderBy('createdAt', 'asc')), (snap) => {
      box.innerHTML = '';
      const now = Date.now();
      snap.forEach(d => {
        const m = d.data();
        
        // FIX BUG CHAT GRUP: Filter cuma jalan buat DM
        if(activeChatUid) {
          if (!m.participants?.includes(currentUser.uid) || !m.participants?.includes(activeChatUid)) return;
        }
        
        if(m.unlockTime && now < m.unlockTime) {
          box.innerHTML += `<div class="chat-msg them" style="align-self:center; margin:10px 0;"><div style="background:#222; padding:10px; border-radius:10px; font-size:12px; color:#fbbf24; text-align:center; border:1px dashed #fbbf24;"><i class="bi bi-lock-fill"></i> Terkunci</div></div>`;
          return;
        }
        const isMe = m.senderId === currentUser.uid;
        if(!isMe && !m.read && activeChatUid) updateDoc(doc(db, 'messages', d.id), { read: true });
        
        let content = m.text ? `<div>${m.text}</div>` : '';
        if(m.image) content += `<img src="${m.image}" style="max-width:100%; border-radius:8px; margin-top:5px;">`;
        if(m.audio) content += `<audio src="${m.audio}" controls style="height:30px; margin-top:5px;"></audio>`;
        if(m.replyTo) content = `<div class="reply-quote"><strong>@${m.replyTo.name}</strong><br>${m.replyTo.text}</div>` + content;

        box.innerHTML += `
          <div class="chat-msg ${isMe?'me':'them'}">
            <div class="chat-bubble" oncontextmenu="event.preventDefault(); showMsgMenu('${d.id}', '${m.text||'Media'}', '${m.username}')">${content}</div>
            <div class="chat-meta">${isMe ? (m.read ? '<i class="bi bi-check2-all" style="color:#3b82f6;"></i>' : '<i class="bi bi-check2"></i>') : ''}</div>
          </div>`;
      });
      box.scrollTop = box.scrollHeight;
    });
  }

  function checkStatus(uid) {
    onSnapshot(doc(db, 'users', uid), (snap) => {
      if(snap.exists()) {
        const u = snap.data();
        const statusEl = document.getElementById('chatStatus');
        if(u.typingIn === currentUser.uid) { statusEl.textContent = 'Sedang mengetik...'; statusEl.style.color = 'var(--primary)'; }
        else {
          statusEl.style.color = 'var(--dim)';
          if(u.lastSeen) {
            const diff = Math.floor((Date.now() - u.lastSeen.toDate().getTime()) / 1000);
            if(diff < 60) statusEl.textContent = 'Online';
            else statusEl.textContent = `Terakhir dilihat ${Math.floor(diff/60)} mnt lalu`;
          } else statusEl.textContent = 'Offline';
        }
      }
    });
  }

  document.getElementById('chatInput').addEventListener('input', () => {
    if(!currentUser || !activeChatUid) return;
    updateDoc(doc(db, 'users', currentUser.uid), { typingIn: activeChatUid });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null }); }, 2000);
  });

  window.showMsgMenu = (id, text, name) => {
    const action = prompt("Ketik 'R' untuk Reply, 'H' untuk Hapus:");
    if(action?.toUpperCase() === 'R') {
      replyTarget = { id, text, name };
      document.getElementById('replyPreview').style.display = 'block';
      document.getElementById('replyName').textContent = name;
      document.getElementById('replyText').textContent = text;
      document.getElementById('chatInput').focus();
    } else if(action?.toUpperCase() === 'H') {
      if(confirm('Hapus pesan ini?')) {
        const docPath = activeGroupId ? doc(db, 'groups', activeGroupId, 'messages', id) : doc(db, 'messages', id);
        deleteDoc(docPath);
      }
    }
  };
  window.cancelReply = () => { replyTarget = null; document.getElementById('replyPreview').style.display = 'none'; };

  document.getElementById('btnSendChat').onclick = async () => {
    const input = document.getElementById('chatInput');
    if(!input.value || !currentUser) return;
    const unlockMins = Number(document.getElementById('timeCapsule').value);
    const unlockTime = unlockMins > 0 ? Date.now() + (unlockMins * 60000) : null;
    const msg = { participants: [currentUser.uid, activeChatUid], senderId: currentUser.uid, username: currentUser.username, text: input.value, read: false, unlockTime, createdAt: serverTimestamp() };
    if(replyTarget) { msg.replyTo = replyTarget; cancelReply(); }
    if(activeChatUid) await updateDoc(doc(db, 'users', currentUser.uid), { typingIn: null });
    
    if(activeGroupId) await addDoc(collection(db, 'groups', activeGroupId, 'messages'), msg);
    else await addDoc(collection(db, 'messages'), msg);
    input.value = '';
  };

  window.sendChatImage = async (input) => {
    if(!input.files[0]) return;
    const base64 = await compressImage(input.files[0], 600);
    const msg = { participants: [currentUser.uid, activeChatUid], senderId: currentUser.uid, username: currentUser.username, image: base64, read: false, createdAt: serverTimestamp() };
    if(activeGroupId) await addDoc(collection(db, 'groups', activeGroupId, 'messages'), msg);
    else await addDoc(collection(db, 'messages'), msg);
    input.value = '';
  };

  document.getElementById('btnMic').onclick = async () => {
    if(mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); document.getElementById('btnMic').style.color = 'var(--text)'; return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:true});
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, {type:'audio/webm'});
        const reader = new FileReader(); reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const msg = { participants: [currentUser.uid, activeChatUid], senderId: currentUser.uid, username: currentUser.username, audio: reader.result, read: false, createdAt: serverTimestamp() };
          if(activeGroupId) await addDoc(collection(db, 'groups', activeGroupId, 'messages'), msg);
          else await addDoc(collection(db, 'messages'), msg);
        };
      };
      mediaRecorder.start();
      document.getElementById('btnMic').style.color = 'red';
    } catch(e) { alert('Izinkan mic!'); }
  };

  document.getElementById('btnCall').onclick = () => {
    if(confirm('Panggil user ini?')) {
      navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
        const call = peer.call(activeChatUid, stream);
        call.on('stream', remote => { const a = new Audio(URL.createObjectURL(remote)); a.play(); });
      });
    }
  };

  // --- GRUP ---
  document.getElementById('btnCreateGroup').onclick = async () => {
    const name = prompt('Nama Grup:');
    if(!name) return;
    const gid = 'HZ-' + Math.floor(1000 + Math.random()*9000);
    await addDoc(collection(db, 'groups'), { name, groupId: gid, admin: currentUser.uid, members: [currentUser.uid] });
    alert(`Grup dibuat! ID: ${gid}`); window.location.reload();
  };

  document.getElementById('btnJoinGroup').onclick = async () => {
    const gid = prompt('Masukkan ID Grup:');
    if(!gid) return;
    const snap = await getDocs(query(collection(db, 'groups'), where('groupId', '==', gid)));
    if(snap.empty) return alert('Grup tidak ditemukan!');
    await updateDoc(doc(db, 'groups', snap.docs[0].id), { members: arrayUnion(currentUser.uid) });
    alert('Berhasil join!'); window.location.reload();
  };

  function loadGroups() {
    onSnapshot(query(collection(db, 'groups')), (snap) => {
      const list = document.getElementById('groupList');
      list.innerHTML = snap.empty ? '<p style="text-align:center;">Belum ada grup.</p>' : '';
      snap.forEach(d => {
        const g = d.data();
        list.innerHTML += `<div class="chat-item" style="margin-bottom:10px; background:var(--card); border-radius:8px;" onclick="openGroup('${d.id}', '${g.name}')">
          <div class="chat-avatar"><i class="bi bi-people-fill"></i></div>
          <div class="chat-info"><h4>${g.name}</h4><p>${g.groupId}</p></div>
        </div>`;
      });
    });
  }

  window.openGroup = (id, name) => {
    activeGroupId = id; activeChatUid = null;
    document.getElementById('chatTitle').textContent = name;
    document.getElementById('chatStatus').style.display = 'none';
    document.getElementById('btnCall').style.display = 'none';
    document.getElementById('chatOverlay').classList.add('active');
    loadMsgs();
  };

  // --- SHOP & ADMIN ---
  document.getElementById('fabShop').onclick = () => document.getElementById('shopModal').classList.add('active');
  document.querySelectorAll('.btn-buy').forEach(btn => {
    btn.onclick = () => window.open(`https://t.me/maklov1?text=${encodeURIComponent('Halo Admin, gua mau beli *'+btn.dataset.item+'*')}`, '_blank');
  });
  document.getElementById('btnClaimTrial').onclick = async () => {
    if(localStorage.getItem('trial_used')) return alert('Trial cuma bisa 1x!');
    await updateDoc(doc(db, 'users', currentUser.uid), { isPremium: true });
    localStorage.setItem('trial_used', 'true'); alert('Premium Aktif!'); window.location.reload();
  };

  function initAdminLogic() {
    document.getElementById('fabAdmin').onclick = () => document.getElementById('adminModal').classList.add('active');
    onSnapshot(collection(db, 'reports'), (snap) => {
      const box = document.getElementById('adminReports');
      box.innerHTML = snap.empty ? 'Belum ada laporan.' : '';
      snap.forEach(d => box.innerHTML += `<div>@${d.data().reporter} riport @${d.data().target}</div>`);
    });
    onSnapshot(collection(db, 'messages'), (snap) => {
      const box = document.getElementById('adminHzcs'); let html = '';
      snap.forEach(d => {
        const m = d.data();
        if(m.participants?.includes('hzcs_uid') && m.senderId !== 'hzcs_uid') html += `<div style="border-bottom:1px solid #333; padding:3px 0;">UID: ${m.senderId.substring(0,5)}... : ${m.text}</div>`;
      });
      box.innerHTML = html || 'Belum ada chat.';
    });
    document.getElementById('btnInject').onclick = async () => {
      const uname = document.getElementById('adminTargetUser').value.toLowerCase();
      const amt = Number(document.getElementById('adminFollowAmt').value);
      if(!uname || !amt) return;
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) { await updateDoc(doc(db, 'users', snap.docs[0].id), { followersCount: increment(amt) }); alert('Disuntik!'); }
    };
    document.getElementById('btnRefund').onclick = async () => {
      const uname = document.getElementById('adminTargetUser').value.toLowerCase();
      const amt = Number(document.getElementById('adminFollowAmt').value);
      if(!uname || !amt) return;
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) { await updateDoc(doc(db, 'users', snap.docs[0].id), { followersCount: increment(-amt) }); alert('Direfund!'); }
    };
    document.getElementById('btnGiveBlue').onclick = async () => {
      const uname = document.getElementById('adminBlueTickUser').value.toLowerCase();
      if(!uname) return;
      const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname)));
      if(!snap.empty) { await updateDoc(doc(db, 'users', snap.docs[0].id), { isPremium: true }); alert('Centang Biru diberikan!'); }
    };
  }

  // Tambah Kontak (Sederhana)
  document.getElementById('fabAddContact').onclick = async () => {
    const uname = prompt('Masukkan Username teman:');
    if(!uname) return;
    const snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname.toLowerCase())));
    if(snap.empty) return alert('User tidak ditemukan!');
    alert('Kontak ditemukan!');
    openChat(snap.docs[0].id, '@'+uname);
  };
}