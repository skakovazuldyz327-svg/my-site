import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createRateLimiter } from "../http/rateLimit.js";
import { clientIp, readBody, readJson, sendBytes, sendJson } from "../http/respond.js";
import { localIso, shortId } from "../store/files.js";

const KB = 1024;
const MB = 1024 * KB;

function sendCatalogChange(res, result) {
  sendJson(res, result.ok ? 200 : result.error === "conflict" ? 409 : 400, result);
}

export function registerShopApi(router, { config, store, logger }) {
  const admin = { admin: true };
  const allowOrder = createRateLimiter({ limit: config.ordersPerHour, windowMs: 60 * 60 * 1000 });

  router.post("/api/login", (req, res) => sendJson(res, 200, { ok: true }), admin);

  // The shop page keeps an order refused with 429 and sends it again later, so the limit delays an order, never drops it.
  router.post("/api/orders", async (req, res) => {
    // Another site's page can send text/plain without asking the browser first, but not JSON: only the shop page sends JSON.
    if (String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
      sendJson(res, 415, { ok: false });
      return;
    }
    const ip = clientIp(req);
    if (!allowOrder(ip)) {
      logger.warn("order rate limit", { ip });
      sendJson(res, 429, { ok: false, error: "rate" });
      return;
    }
    const number = await store.orders.add(await readJson(req, 50 * KB));
    if (!number) {
      sendJson(res, 400, { ok: false, error: "refused" });
      return;
    }
    // The order as saved goes back to the visitor for the invoice; an order kept in the rescue file has none yet.
    // The order is saved by now, so a failed read must still confirm it, or the shop page would send it again.
    const invoice = await store.orders.invoice(number).catch((error) => {
      logger.error("order saved, but reading it back for the invoice failed", { number, message: error.message });
      return null;
    });
    sendJson(res, 200, { ok: true, number, invoice });
  });

  router.get("/api/orders", async (req, res) => sendJson(res, 200, await store.orders.read()), admin);

  router.post("/api/orders/status", async (req, res) => {
    const ok = await store.orders.setStatus(await readJson(req, 10 * KB));
    sendJson(res, ok ? 200 : 400, { ok });
  }, admin);

  router.post("/api/orders/buyer", async (req, res) => {
    const ok = await store.orders.setBuyer(await readJson(req, 10 * KB));
    sendJson(res, ok ? 200 : 400, { ok });
  }, admin);

  router.post("/api/orders/delete", async (req, res) => {
    const ok = await store.orders.remove(await readJson(req, 10 * KB));
    sendJson(res, ok ? 200 : 404, { ok });
  }, admin);

  router.get("/api/clients", async (req, res) => sendJson(res, 200, await store.clients.read()), admin);

  router.post("/api/clients/hide", async (req, res) => {
    const ok = await store.clients.setHidden(await readJson(req, 10 * KB));
    sendJson(res, ok ? 200 : 404, { ok });
  }, admin);

  router.post("/api/clients/delete", async (req, res) => {
    const ok = await store.clients.remove(await readJson(req, 10 * KB));
    sendJson(res, ok ? 200 : 404, { ok });
  }, admin);

  router.get("/api/products", async (req, res) => sendJson(res, 200, await store.catalog.shown()));

  // The admin edits the real counts; visitors only see whether a size is on hand.
  router.get("/api/admin/products", async (req, res) => sendJson(res, 200, await store.catalog.read()), admin);

  // The shop page loads the catalog as a script; it is built from the database on each request, so it is never stale.
  router.get("/data/products.js", async (req, res) => {
    sendBytes(res, 200, "text/javascript; charset=utf-8", Buffer.from(await store.catalog.page(), "utf8"));
  });

  router.post("/api/products/save", async (req, res) => {
    sendCatalogChange(res, await store.catalog.saveProduct(await readJson(req, MB)));
  }, admin);

  router.post("/api/products/delete", async (req, res) => {
    sendCatalogChange(res, await store.catalog.removeProduct(await readJson(req, 10 * KB)));
  }, admin);

  router.post("/api/settings", async (req, res) => {
    sendCatalogChange(res, await store.catalog.saveSettings(await readJson(req, 10 * KB)));
  }, admin);

  router.post("/api/settings/company", async (req, res) => {
    sendCatalogChange(res, await store.catalog.saveCompany(await readJson(req, 10 * KB)));
  }, admin);

  router.get("/api/backup", async (req, res) => {
    const name = `zhuldyz-backup-${localIso().slice(0, 10)}.zip`;
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    sendBytes(res, 200, "application/zip", await store.backups.zip());
  }, admin);

  router.post("/api/upload", async (req, res) => {
    const body = await readBody(req, 10 * MB);
    if (!body.length) {
      sendJson(res, 413, { ok: false });
      return;
    }
    // The admin page always re-encodes photos to JPEG, so anything else is not a photo.
    if (body.length < 3 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      sendJson(res, 415, { ok: false });
      return;
    }
    await mkdir(config.paths.uploads, { recursive: true });
    const name = `${shortId()}.jpg`;
    await writeFile(join(config.paths.uploads, name), body);
    sendJson(res, 200, { url: `images/products/${name}` });
  }, admin);
}
