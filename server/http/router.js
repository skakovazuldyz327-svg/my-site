import { clientIp, HttpError, isAdmin, isDirectLocal, sendJson } from "./respond.js";

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

// localOnly: the password is the default one printed in the source, so the admin API answers only on this computer.
export function createRouter({ adminPassword, localOnly = false, now = Date.now }) {
  const routes = new Map();
  const failures = new Map();

  const add = (method, path, handler, options = {}) => {
    const key = `${method} ${path}`;
    if (routes.has(key)) throw new Error(`Route registered twice: ${key}`);
    routes.set(key, { handler, admin: Boolean(options.admin) });
  };

  // Ten wrong passwords from one address lock the admin API for that address for 15 minutes.
  function recentFailures(ip) {
    const time = now();
    if (failures.size > 5000) {
      for (const [key, list] of failures) {
        if (time - list[list.length - 1] >= FAILURE_WINDOW_MS) failures.delete(key);
      }
    }
    const list = (failures.get(ip) || []).filter((stamp) => time - stamp < FAILURE_WINDOW_MS);
    if (list.length) failures.set(ip, list);
    else failures.delete(ip);
    return list;
  }

  return {
    get: (path, handler, options) => add("GET", path, handler, options),
    post: (path, handler, options) => add("POST", path, handler, options),

    async handle(req, res, path) {
      const route = routes.get(`${req.method} ${path}`);
      if (!route) return false;
      if (route.admin) {
        if (localOnly && !isDirectLocal(req)) {
          sendJson(res, 403, { ok: false, error: "default password" });
          return true;
        }
        const ip = clientIp(req);
        const list = recentFailures(ip);
        if (list.length >= MAX_FAILURES) {
          sendJson(res, 429, { ok: false, error: "too many attempts" });
          return true;
        }
        if (!isAdmin(req, adminPassword)) {
          list.push(now());
          failures.set(ip, list);
          sendJson(res, 401, { ok: false });
          return true;
        }
        failures.delete(ip);
      }
      try {
        await route.handler(req, res);
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        if (!res.headersSent) sendJson(res, error.status, error.body ?? { ok: false });
      }
      return true;
    }
  };
}
