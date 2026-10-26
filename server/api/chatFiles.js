import { readFile } from "node:fs/promises";
import { createRateLimiter } from "../http/rateLimit.js";
import { clientIp, readBody, readJson, sendBytes, sendJson } from "../http/respond.js";

// Cut by code points: half of an emoji would make encodeURIComponent throw on download.
function header(req, name, max) {
  try {
    return Array.from(decodeURIComponent(String(req.headers[name] || ""))).slice(0, max).join("");
  } catch {
    return "";
  }
}

// Long names are shortened before the extension, so the downloaded file still opens in the right program.
function cleanName(value, max) {
  const name = value.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "").trim();
  const chars = Array.from(name);
  if (chars.length <= max) return name || "файл";
  const ext = Array.from(/\.[\p{L}\p{N}]{1,10}$/u.exec(name)?.[0] || "");
  return chars.slice(0, max - ext.length).join("").trimEnd() + ext.join("");
}

function cleanType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  return /^[\w.+-]+\/[\w.+-]+$/.test(type) && type.length <= 100 ? type : "";
}

function attachmentHeader(name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function registerChatFilesApi(router, { config, store, logger }) {
  const allow = createRateLimiter({ limit: config.chatFiles.perHour, windowMs: 60 * 60 * 1000 });
  // Without a daily byte cap a few addresses could fill the whole storage and block every visitor's uploads for months.
  const allowBytes = createRateLimiter({ limit: config.chatFiles.bytesPerDay, windowMs: 24 * 60 * 60 * 1000 });
  const admin = { admin: true };
  let warnedNearlyFull = false;

  router.post("/api/chat/files", async (req, res) => {
    const ip = clientIp(req);
    if (!allow(ip)) {
      logger.warn("chat file rate limit", { ip });
      sendJson(res, 429, { ok: false, error: "rate" });
      return;
    }
    const bytes = await readBody(req, config.chatFiles.maxFileBytes);
    if (!bytes.length) {
      sendJson(res, 400, { ok: false });
      return;
    }
    if (!allowBytes(ip, bytes.length)) {
      logger.warn("chat file daily size limit", { ip, limitMb: Math.round(config.chatFiles.bytesPerDay / 1024 / 1024) });
      sendJson(res, 429, { ok: false, error: "rate" });
      return;
    }
    const session = String(req.headers["x-chat-session"] || "");
    const entry = await store.chatFiles.add({
      name: cleanName(header(req, "x-file-name", 255), 120),
      type: cleanType(req.headers["content-type"]),
      session: /^[a-z0-9]{6,20}$/.test(session) ? session : "",
      text: header(req, "x-chat-text", 500).trim(),
      bytes
    });
    if (!entry) {
      logger.warn("chat files storage is full", { limitMb: Math.round(config.chatFiles.totalBytes / 1024 / 1024) });
      sendJson(res, 507, { ok: false, error: "full" });
      return;
    }
    logger.info("chat file saved", { size: entry.size, type: entry.type });
    const used = store.chatFiles.usedBytes(await store.chatFiles.read());
    const nearlyFull = used > config.chatFiles.totalBytes * 0.9;
    if (nearlyFull && !warnedNearlyFull) {
      logger.warn("chat files storage is over 90% full - delete old files in the admin page", { usedMb: Math.round(used / 1024 / 1024) });
    }
    warnedNearlyFull = nearlyFull;
    sendJson(res, 200, { ok: true, id: entry.id });
  });

  router.get("/api/chat/files", async (req, res) => {
    const files = (await store.chatFiles.read()).sort((a, b) => (Number(b.time) || 0) - (Number(a.time) || 0));
    sendJson(res, 200, {
      files: files.map(({ id, name, type, size, session, text, createdAt }) => ({ id, name, type, size, session, text, createdAt })),
      usedBytes: store.chatFiles.usedBytes(files),
      totalBytes: config.chatFiles.totalBytes,
      days: config.chatFiles.days
    });
  }, admin);

  router.get("/api/chat/files/download", async (req, res) => {
    const id = new URL(req.url, "http://localhost").searchParams.get("id");
    const found = await store.chatFiles.find(id);
    const bytes = found ? await readFile(found.path).catch(() => null) : null;
    if (!bytes) {
      sendJson(res, 404, { ok: false });
      return;
    }
    // Always a download, never rendered: an uploaded .html or .svg must not run inside the admin's origin.
    res.setHeader("Content-Disposition", attachmentHeader(found.entry.name));
    sendBytes(res, 200, "application/octet-stream", bytes);
  }, admin);

  router.post("/api/chat/files/delete", async (req, res) => {
    const ok = await store.chatFiles.remove((await readJson(req, 10 * 1024))?.id);
    sendJson(res, ok ? 200 : 404, { ok });
  }, admin);
}
