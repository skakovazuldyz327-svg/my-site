import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { loadConfig } from "../server/config.js";

// Tests use the PostgreSQL server of the site (docker compose up -d postgres), each temporary site with a database of its own.
const server = loadConfig().database;

async function dropDatabase(name) {
  const client = new pg.Client({ ...server, database: "postgres" });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

export function tempSite() {
  const root = mkdtempSync(join(tmpdir(), "zhuldyz-test-"));
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "images", "products"), { recursive: true });
  copyFileSync(new URL("./fixtures/products.json", import.meta.url), join(root, "data", "products.json"));
  const database = `zhuldyz_test_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const url = `postgres://${encodeURIComponent(server.user)}:${encodeURIComponent(server.password)}@${server.host}:${server.port}/${database}`;
  const config = loadConfig(root, { ADMIN_PASSWORD: "secret", OPENAI_API_KEY: "test-key", DATABASE_URL: url });
  return {
    root,
    config,
    cleanup: async () => {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
      await dropDatabase(database);
    }
  };
}

export function fakeProvider(id, script) {
  const calls = [];
  return {
    id,
    calls,
    available: () => true,
    async chat(request) {
      calls.push(request);
      const step = script[calls.length - 1] ?? script[script.length - 1];
      if (step instanceof Error) throw step;
      return typeof step === "function" ? step(request) : step;
    }
  };
}

export const replyCall = (args) => ({ text: "", toolCalls: [{ id: "r1", name: "reply", arguments: JSON.stringify(args) }] });
