import { createServer } from "node:http";
import { registerChatApi } from "./api/chat.js";
import { registerChatFilesApi } from "./api/chatFiles.js";
import { registerShopApi } from "./api/shop.js";
import { DEFAULT_ADMIN_PASSWORD } from "./config.js";
import { sendJson } from "./http/respond.js";
import { createRouter } from "./http/router.js";
import { serveStatic } from "./http/static.js";

export function createApp({ config, store, logger, ai }) {
  const router = createRouter({ adminPassword: config.adminPassword, localOnly: config.adminPassword === DEFAULT_ADMIN_PASSWORD });
  registerShopApi(router, { config, store, logger });
  registerChatApi(router, { config, store, logger, ai });
  registerChatFilesApi(router, { config, store, logger });

  return createServer(async (req, res) => {
    store.backups.daily().catch((error) => logger.error("backup failed", { message: error.message }));
    try {
      let path;
      try {
        path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      } catch {
        sendJson(res, 400, { error: "bad url" });
        return;
      }
      if (await router.handle(req, res, path)) return;
      if (req.method === "GET") await serveStatic(res, path, config.paths);
      else sendJson(res, 405, { error: "method not allowed" });
    } catch (error) {
      logger.error("request failed", { method: req.method, url: req.url, message: error.message });
      if (!res.headersSent) sendJson(res, 500, { error: "server" });
      else res.destroy();
    }
  });
}
