import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { sendBytes, sendJson } from "./respond.js";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

// Pages and scripts come from the React build; photos stay in the site folder where the admin writes them.
export async function serveStatic(res, path, paths) {
  let relative = (path === "/" ? "/index.html" : path).replace(/^\/+/, "");
  let base = paths.dist;
  const match = relative.match(/^images\/(.*)$/);
  if (match) {
    base = paths.images;
    relative = match[1];
  }
  const root = resolve(base);
  const file = resolve(join(root, relative));
  // ":" blocks NTFS streams (index.html::$DATA) and device names like "CON:" on Windows.
  const hidden = path.includes("\\") || path.includes(":") || /(^|\/)\./.test(path) || path.includes("\0");
  const info = !hidden && file.startsWith(root + sep) ? await stat(file).catch(() => null) : null;
  if (!info || !info.isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  const type = TYPES[extname(file).toLowerCase()] || "application/octet-stream";
  // Vite puts a content hash into every file name under assets/, so a changed file always gets a new URL.
  const cache = base === paths.dist && relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store";
  sendBytes(res, 200, type, await readFile(file), cache);
}
