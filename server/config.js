import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_ADMIN_PASSWORD = "zhuldyz2026";

function readEnvFile(file) {
  const settings = {};
  if (!existsSync(file)) return settings;
  for (const line of readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const index = text.indexOf("=");
    const key = text.slice(0, index).trim();
    const value = text.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    settings[key] = value;
  }
  return settings;
}

function list(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function loadConfig(root = ROOT, overrides = {}) {
  const file = readEnvFile(join(root, ".env"));
  const get = (name, fallback) => overrides[name] || process.env[name] || file[name] || fallback;
  const number = (name, fallback) => {
    const value = Number(get(name, ""));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const db = join(root, "db");

  return {
    root,
    host: get("HOST", "127.0.0.1"),
    port: Math.min(number("PORT", 8765), 65535),
    adminPassword: get("ADMIN_PASSWORD", DEFAULT_ADMIN_PASSWORD),
    backupDays: number("BACKUP_DAYS", 30),
    backupCopyDir: get("BACKUP_COPY_DIR", "") && resolve(root, get("BACKUP_COPY_DIR", "")),
    chatPerMinute: number("CHAT_PER_MINUTE", 20),
    chatConcurrent: number("CHAT_CONCURRENT", 8),
    ordersPerHour: number("ORDERS_PER_HOUR", 20),
    paths: {
      dist: join(root, "dist"),
      images: join(root, "images"),
      uploads: join(root, "images", "products"),
      db,
      database: join(db, "zhuldyz.sqlite"),
      ordersRescue: join(db, "orders-rescue.jsonl"),
      backups: join(db, "backups"),
      chatFiles: join(db, "chat-files"),
      aiUsage: join(db, "ai-usage.json"),
      log: join(root, "server-log.txt"),
      // The JSON files of the site before the database: imported once on the first start, then moved to legacyArchive.
      legacy: {
        catalog: join(root, "data", "products.json"),
        catalogPage: join(root, "data", "products.js"),
        orders: join(db, "orders.json"),
        deletedOrders: join(db, "deleted-orders.json"),
        clients: join(db, "clients.json"),
        lastNumber: join(db, "last-order-number.txt"),
        chatFilesIndex: join(db, "chat-files.json")
      },
      legacyArchive: join(db, "legacy-json")
    },
    chatFiles: {
      maxFileBytes: number("CHAT_FILE_MAX_MB", 25) * 1024 * 1024,
      totalBytes: number("CHAT_FILES_TOTAL_MB", 2048) * 1024 * 1024,
      days: number("CHAT_FILES_DAYS", 90),
      perHour: number("CHAT_FILES_PER_HOUR", 30),
      bytesPerDay: number("CHAT_FILES_MB_PER_DAY", 200) * 1024 * 1024
    },
    ai: {
      providers: list(get("AI_PROVIDERS", "openai")),
      deadlineMs: number("AI_DEADLINE_MS", 40000),
      maxSteps: number("AI_MAX_STEPS", 3),
      // About 600 answers a day; at gpt-4.1-mini prices that is under 1.5 dollars.
      dailyTokens: number("AI_DAILY_TOKENS", 3000000),
      fileReadMs: number("AI_FILE_READ_MS", 10000),
      openai: {
        key: get("OPENAI_API_KEY", ""),
        model: get("OPENAI_MODEL", "gpt-4o-mini"),
        maxTokens: number("OPENAI_MAX_TOKENS", 600),
        imageDetail: get("OPENAI_IMAGE_DETAIL", "auto"),
        baseUrl: get("OPENAI_BASE_URL", "https://api.openai.com/v1").replace(/\/+$/, "")
      }
    }
  };
}
