import { timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function sendBytes(res, status, type, bytes, cache = "no-store") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": bytes.length,
    "Cache-Control": cache,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin"
  });
  res.end(bytes);
}

export function sendJson(res, status, data) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  sendBytes(res, status, "application/json; charset=utf-8", Buffer.from(text, "utf8"));
}

export function readBody(req, limit) {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(new HttpError(413, { ok: false }));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, { ok: false }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
    req.on("close", () => {
      if (!req.complete) reject(new HttpError(400, { ok: false }));
    });
  });
}

export async function readJson(req, limit) {
  const text = (await readBody(req, limit)).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, { ok: false });
  }
}

export function isAdmin(req, password) {
  const given = Buffer.from(String(req.headers["x-admin-password"] || ""), "utf8");
  const expected = Buffer.from(password, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const PROXY_HEADERS = ["x-forwarded-for", "forwarded", "x-real-ip", "cf-connecting-ip"];
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// A tunnel connects from 127.0.0.1 too, but it says whom it forwards; the Host check stops a web page that points its
// own domain at 127.0.0.1 (DNS rebinding) from reaching the admin API with the well-known default password.
export function isDirectLocal(req) {
  const host = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
  return LOOPBACK.has(req.socket.remoteAddress) && LOCAL_HOSTS.has(host) && !PROXY_HEADERS.some((name) => req.headers[name]);
}

// Behind a local tunnel (cloudflared, ngrok) every visitor arrives from 127.0.0.1; the tunnel appends the real address last.
export function clientIp(req) {
  const remote = req.socket.remoteAddress || "unknown";
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",").map((part) => part.trim()).filter(Boolean);
  return LOOPBACK.has(remote) && forwarded.length ? forwarded[forwarded.length - 1] : remote;
}
