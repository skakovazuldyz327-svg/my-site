import { CHAT_MAX_FILES } from "./attachments.js";

export const CHAT_KEY = "zhuldyz-consultant";
const SESSION_KEY = "zhuldyz-chat-session";
const UPLOAD_STATES = ["saved", "failed"];
export const CHAT_GREETING = "Здравствуйте! Я ИИ-консультант магазина Жулдыз: отвечаю сразу, а если нужно — передам вопрос самой Жулдыз. Напишите, как спите и какой размер — подберу модель из каталога.";

export function cleanHandoff(handoff) {
  if (!handoff || typeof handoff.link !== "string" || !handoff.link.startsWith("https://wa.me/")) return null;
  return {
    link: handoff.link,
    phone: typeof handoff.phone === "string" && /^\+\d{10,15}$/.test(handoff.phone) ? handoff.phone : "",
    note: typeof handoff.note === "string" ? handoff.note : ""
  };
}

function cleanFiles(files) {
  if (!Array.isArray(files)) return [];
  return files.filter((file) => file && typeof file.name === "string").slice(0, CHAT_MAX_FILES).map((file) => ({
    ...(typeof file.id === "string" && /^[0-9a-f]{12}$/.test(file.id) ? { id: file.id } : {}),
    name: file.name.slice(0, 120),
    size: Number(file.size) || 0,
    type: typeof file.type === "string" ? file.type : "",
    src: typeof file.src === "string" && file.src.startsWith("data:image/") ? file.src : ""
  }));
}

export function loadThread() {
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]");
    if (!Array.isArray(saved)) return [{ role: "bot", text: CHAT_GREETING }];
    const thread = saved.filter((item) => item && (item.role === "bot" || item.role === "user") && typeof item.text === "string" && (item.text.trim() || cleanFiles(item.files).length)).map((item) => ({
      role: item.role,
      text: item.text,
      files: cleanFiles(item.files),
      upload: UPLOAD_STATES.includes(item.upload) ? item.upload : "",
      handoff: cleanHandoff(item.handoff) || (typeof item.link === "string" && item.link.startsWith("https://wa.me/") ? { link: item.link, phone: "", note: "" } : null),
      products: Array.isArray(item.products) ? item.products.filter((product) => product && typeof product.name === "string").slice(0, 2) : []
    }));
    if (thread.length) return thread.slice(-40);
  } catch {
    /* keep the greeting if storage is unreadable */
  }
  return [{ role: "bot", text: CHAT_GREETING }];
}

export function saveThread(thread) {
  const copy = thread.map((item) => ({ ...item, files: (item.files || []).map(({ data, file: original, ...file }) => ({ ...file })) }));
  const withImages = copy.filter((item) => item.files.some((file) => file.src));
  for (;;) {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(copy));
      return;
    } catch {
      const oldest = withImages.shift();
      if (!oldest) return;
      oldest.files.forEach((file) => { file.src = ""; });
    }
  }
}

export function rulesHistory(thread) {
  return thread.map((item) => ({
    role: item.role,
    text: [item.text, (item.files || []).map((file) => `(файл: ${file.name})`).join(" ")].filter(Boolean).join(" "),
    files: (item.files || []).map(({ name, size, type }) => ({ name, size, type })),
    products: item.products || []
  }));
}

// Kept in memory too: with full or blocked storage the uploads and the WhatsApp message must still share one id.
let sessionId = "";

function chatSession() {
  if (sessionId) return sessionId;
  try {
    sessionId = localStorage.getItem(SESSION_KEY) || "";
  } catch {
    sessionId = "";
  }
  if (!/^[a-z0-9]{6,20}$/.test(sessionId)) {
    sessionId = [...crypto.getRandomValues(new Uint8Array(10))].map((byte) => "abcdefghijklmnopqrstuvwxyz0123456789"[byte % 36]).join("");
    try {
      localStorage.setItem(SESSION_KEY, sessionId);
    } catch {
      /* the id still holds until the page is reloaded */
    }
  }
  return sessionId;
}

// The admin lists chat files under the same label, so Zhuldyz can match them with the WhatsApp message.
export function linkWithChatLabel(link) {
  const [base, query = ""] = link.split("?text=");
  let text;
  try {
    text = decodeURIComponent(query);
  } catch {
    return link;
  }
  const label = chatSession().slice(0, 6).toUpperCase();
  const body = text.replace(/ — отправлю следом\.$/m, ".");
  return `${base}?text=${encodeURIComponent(`${body}${body ? "\n\n" : ""}Мои файлы — в чате на сайте, номер чата ${label}.`)}`;
}

// Slicing by code points keeps encodeURIComponent from throwing on half of an emoji.
function headerText(value, max) {
  return encodeURIComponent(Array.from(String(value || "")).slice(0, max).join(""));
}

// Saves the original files on the server for Zhuldyz and for the consultant to read.
// Resolves to the server ids in the same order ("" for a failed upload), or null when there is no server (opened as a file).
export async function uploadChatFiles(files, text) {
  if (location.protocol === "file:" || !files.some((item) => item.file instanceof Blob)) return null;
  const session = chatSession();
  return Promise.all(files.map(async (item) => {
    if (!(item.file instanceof Blob)) return "";
    // A stalled mobile connection never fails by itself and would keep the chat locked: a minute plus a second
    // per 100 KB, at most five minutes, then the visitor is asked to send the file in WhatsApp.
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), Math.min(5 * 60000, 60000 + item.file.size / 100));
    try {
      const response = await fetch("/api/chat/files", {
        method: "POST",
        headers: {
          "Content-Type": item.file.type || "application/octet-stream",
          "X-File-Name": headerText(item.file.name || item.name, 255),
          "X-Chat-Session": session,
          "X-Chat-Text": headerText(text, 500)
        },
        body: item.file,
        signal: controller.signal
      });
      const data = response.ok ? await response.json() : null;
      return typeof data?.id === "string" ? data.id : "";
    } catch {
      return "";
    } finally {
      window.clearTimeout(timer);
    }
  }));
}

// The server already returns the finished answer (cards, handoff, suggestions); null means "answer locally".
export async function askAi(messages) {
  if (location.protocol === "file:") return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, session: chatSession() }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const data = await response.json();
    const text = String(data.text || "").trim();
    if (!text) return null;
    return {
      text,
      products: Array.isArray(data.products) ? data.products.filter((product) => product && typeof product.name === "string").slice(0, 2) : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions.filter((label) => typeof label === "string").slice(0, 4) : [],
      handoff: data.handoff || null
    };
  } finally {
    window.clearTimeout(timer);
  }
}
