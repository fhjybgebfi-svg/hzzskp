// ============================================================
// utils.js — Fungsi bantuan (emoji, kompres, format, time, dll)
// ============================================================

/* ============================================================
   1) EMOJI — Apple Style (WAJIB untuk semua teks user)
============================================================ */
const APPLE_EMOJI_BASE = "https://emojicdn.elk.sh/";

// Regex deteksi emoji (Extended_Pictographic + regional (flag) + ZWJ + skin tone)
const EMOJI_REGEX =
  /((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}|\p{Regional_Indicator})|[\u{1F3FB}-\u{1F3FF}])*)/gu;

/**
 * Ubah semua emoji dalam string menjadi <img> Apple-style.
 * Aman dipakai setelah escapeHtml (emoji bukan karakter spesial HTML).
 * @param {string} text
 * @returns {string} HTML string dengan <img class="apple-emoji">
 */
export function parseEmojis(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(EMOJI_REGEX, (emoji) => {
    const enc = encodeURIComponent(emoji);
    const alt = escapeHtml(emoji);
    return `<img class="apple-emoji" src="${APPLE_EMOJI_BASE}${enc}?style=apple" alt="${alt}" draggable="false" loading="lazy" />`;
  });
}

export function hasEmoji(text) {
  if (typeof text !== "string") return false;
  EMOJI_REGEX.lastIndex = 0;
  return EMOJI_REGEX.test(text);
}

/* ============================================================
   2) HTML UTILS
============================================================ */
export function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Format teks chat dengan Markdown ringan:
 *   *tebal*  _miring_  ~~coret~~  `kode`
 * Emoji otomatis jadi Apple-style.
 */
export function formatText(text) {
  if (typeof text !== "string" || !text) return "";

  // 1. Escape HTML
  let s = escapeHtml(text);

  // 2. Proteksi isi code block (pakai placeholder unik)
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, p1) => {
    codes.push(p1);
    return `\u0000C${codes.length - 1}\u0000`;
  });

  // 3. Bold, italic, strike (hindari nested rusak dengan lookahead sederhana)
  s = s.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");

  // 4. Balikin code block
  s = s.replace(/\u0000C(\d+)\u0000/g, (_m, i) => `<code>${codes[+i]}</code>`);

  // 5. Emoji → Apple
  s = parseEmojis(s);

  // 6. Newline → <br>
  s = s.replace(/\n/g, "<br>");

  return s;
}

/* ============================================================
   3) IMAGE — Kompres via Canvas ke Base64 (JPEG)
============================================================ */
/**
 * @param {File} file
 * @param {number} maxW
 * @param {number} maxH
 * @param {number} quality 0..1
 * @returns {Promise<string>} dataURL (base64)
 */
export function compressImage(file, maxW = 1080, maxH = 1080, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      return reject(new Error("File bukan gambar."));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal baca file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal decode gambar."));
      img.onload = () => {
        try {
          let { width, height } = img;
          const ratio = Math.min(maxW / width, maxH / height, 1);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) {
          reject(err);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/** Crop gambar menjadi rasio tertentu (untuk banner) */
export function cropToRatio(file, ratioW = 16, ratioH = 6, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      return reject(new Error("File bukan gambar."));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal baca file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal decode gambar."));
      img.onload = () => {
        try {
          const targetRatio = ratioW / ratioH;
          let sw = img.width;
          let sh = img.height;
          if (sw / sh > targetRatio) {
            sw = sh * targetRatio;
          } else {
            sh = sw / targetRatio;
          }
          const sx = (img.width - sw) / 2;
          const sy = (img.height - sh) / 2;

          const maxW = 1280;
          const outW = Math.min(maxW, Math.round(sw));
          const outH = Math.round(outW / targetRatio);

          const canvas = document.createElement("canvas");
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) {
          reject(err);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export function dataURLtoBlob(dataURL) {
  const parts = dataURL.split(",");
  const mime = parts[0].match(/:(.*?);/)[1];
  const bin = atob(parts[1]);
  const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ============================================================
   4) AUDIO — Blob ke Base64
============================================================ */
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal baca blob."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/* ============================================================
   5) TIME HELPERS
============================================================ */
function toDate(input) {
  if (!input) return new Date(0);
  if (input instanceof Date) return input;
  if (typeof input === "number") return new Date(input);
  if (typeof input === "object" && typeof input.toDate === "function") {
    try { return input.toDate(); } catch { return new Date(0); }
  }
  if (typeof input === "object" && typeof input.seconds === "number") {
    return new Date(input.seconds * 1000);
  }
  const d = new Date(input);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/** HH:MM */
export function formatTime(input) {
  const d = toDate(input);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** 5m, 2j, 3h, 4d */
export function formatRelativeTime(input) {
  const d = toDate(input);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 0) return "baru";
  if (diff < 30) return "baru";
  if (diff < 60) return diff + "d";
  if (diff < 3600) return Math.floor(diff / 60) + "m";
  if (diff < 86400) return Math.floor(diff / 3600) + "j";
  if (diff < 604800) return Math.floor(diff / 86400) + "h";
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

/** 15:42, 5 Nov */
export function formatSmartTime(input) {
  const d = toDate(input);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return formatTime(d);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short" });
}

/* ============================================================
   6) MISC HELPERS
============================================================ */
export function debounce(fn, wait = 300) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

export function throttle(fn, limit = 300) {
  let last = 0;
  let timer = null;
  return function (...args) {
    const now = Date.now();
    const remaining = limit - (now - last);
    if (remaining <= 0) {
      if (timer) { clearTimeout(timer); timer = null; }
      last = now;
      fn.apply(this, args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  };
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Group ID unik: HZ-XXXX (A-Z 0-9) */
export function generateGroupId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "HZ-";
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export function isValidUsername(s) {
  return typeof s === "string" && /^[a-z0-9_]{3,20}$/.test(s);
}

export function sanitizeUsername(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

export function truncate(str, n = 60) {
  if (typeof str !== "string") return "";
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch { return fallback; }
}

export function lsSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

/* ============================================================
   7) AVATAR HELPERS
============================================================ */
export function getInitials(name) {
  if (!name) return "?";
  const clean = String(name).trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "#00ffc8", "#00b894", "#00d4a8", "#14b8a6",
  "#22d3ee", "#0891b2", "#10b981", "#06b6d4"
];

export function getAvatarColor(seed) {
  if (!seed) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/* ============================================================
   8) TOAST
============================================================ */
export function toast(message, type = "info", duration = 2800) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.textContent = String(message || "");
  container.appendChild(el);

  // trigger animasi
  requestAnimationFrame(() => el.classList.add("show"));

  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { try { el.remove(); } catch {} }, 300);
  }, duration);
}

/* ============================================================
   9) NOTIFICATION SOUND (WebAudio, tanpa file eksternal)
============================================================ */
let __audioCtx = null;
export function playNotificationSound(volume = 0.15) {
  try {
    if (!__audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      __audioCtx = new AC();
    }
    const ctx = __audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  } catch {
    /* ignore */
  }
}

/* ============================================================
   10) CHAT HELPERS — deteksi & render bubble
============================================================ */
export const REACTION_EMOJIS = ["❤️", "👍", "😂"];

/** Format durasi detik → 0:07 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}