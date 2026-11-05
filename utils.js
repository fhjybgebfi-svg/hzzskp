// utils.js
// Helper lintas-Part.

// =========================================================
// ESCAPE HTML
// =========================================================
export function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// =========================================================
// APPLE EMOJI
// =========================================================
const EMOJI_REGEX =
  /(\p{Extended_Pictographic}(?:\p{Emoji_Modifier})?(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\p{Emoji_Modifier})?(?:\uFE0F|\uFE0E)?)*|\p{Regional_Indicator}{2})/gu;

function replaceEmojisInHtml(htmlSafeText) {
  if (!htmlSafeText) return "";
  try {
    return htmlSafeText.replace(EMOJI_REGEX, (m) => {
      const enc = encodeURIComponent(m);
      return `<img class="apple-emoji" src="https://emojicdn.elk.sh/${enc}?style=apple" alt="${m}" loading="lazy" draggable="false" />`;
    });
  } catch (e) { return htmlSafeText; }
}

export function parseEmojis(rawText) {
  if (rawText == null) return "";
  return replaceEmojisInHtml(escapeHtml(rawText));
}

// =========================================================
// FORMAT TEXT (Markdown Telegram + Apple emoji)
// *bold* / _italic_ / ~~strike~~ / `code`
// Bonus: **bold** / __italic__ (WhatsApp style)
// =========================================================
export function formatText(rawText) {
  if (rawText == null) return "";
  let text = escapeHtml(rawText);

  // Code (paling awal biar nggak ketiban)
  text = text.replace(/`([^`\n]+?)`/g, "<code>$1</code>");

  // Strike
  text = text.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Bold — double first, lalu single
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*\n]+?)\*/g, "<strong>$1</strong>");

  // Italic — double first, lalu single
  text = text.replace(/__(.+?)__/g, "<em>$1</em>");
  text = text.replace(/_([^_\n]+?)_/g, "<em>$1</em>");

  // Newlines
  text = text.replace(/\n/g, "<br>");

  // Emoji
  return replaceEmojisInHtml(text);
}

// =========================================================
// TIME AGO
// =========================================================
export function timeAgo(input) {
  if (!input) return "baru saja";
  let ts;
  if (input instanceof Date) ts = input.getTime();
  else if (typeof input === "object" && typeof input.toMillis === "function") ts = input.toMillis();
  else if (typeof input === "number") ts = input;
  else ts = new Date(input).getTime();
  if (!ts || isNaN(ts)) return "baru saja";

  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 10) return "baru saja";
  if (diff < 60) return `${diff} detik lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return new Date(ts).toLocaleDateString("id-ID", {
    day: "numeric", month: "short", year: "numeric"
  });
}

// =========================================================
// PRESENCE LABEL
// =========================================================
export function presenceLabel(lastSeen) {
  if (!lastSeen) return "Offline";
  let ts;
  if (typeof lastSeen?.toMillis === "function") ts = lastSeen.toMillis();
  else if (lastSeen instanceof Date) ts = lastSeen.getTime();
  else if (typeof lastSeen === "number") ts = lastSeen;
  else ts = new Date(lastSeen).getTime();
  if (!ts || isNaN(ts)) return "Offline";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "Online";
  return `Terakhir dilihat ${timeAgo(ts)}`;
}

// =========================================================
// COMPRESS IMAGE → Base64 JPEG
// =========================================================
export function compressImage(file, maxDim = 900, quality = 0.7) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("File kosong."));
    if (!file.type || !file.type.startsWith("image/")) {
      return reject(new Error("File bukan gambar."));
    }
    if (file.size > 8 * 1024 * 1024) {
      return reject(new Error("Foto terlalu besar (max 8MB)."));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal baca file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Gagal load gambar."));
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > height && width > maxDim) {
            height = Math.round(height * maxDim / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round(width * maxDim / height);
            height = maxDim;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (err) {
          reject(new Error("Gagal kompres gambar."));
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// =========================================================
// BLOB → Base64 (buat voice note)
// =========================================================
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    if (!blob) return reject(new Error("Blob kosong."));
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// =========================================================
// EMOJI IMG
// =========================================================
export function emojiImg(emoji, small = false) {
  const enc = encodeURIComponent(emoji);
  const cls = small ? "apple-emoji apple-emoji-sm" : "apple-emoji";
  return `<img class="${cls}" src="https://emojicdn.elk.sh/${enc}?style=apple" alt="${emoji}" loading="lazy" draggable="false" />`;
}