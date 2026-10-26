import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../server/config.js";

export function tempSite() {
  const root = mkdtempSync(join(tmpdir(), "zhuldyz-test-"));
  mkdirSync(join(root, "data"), { recursive: true });
  mkdirSync(join(root, "images", "products"), { recursive: true });
  copyFileSync(new URL("./fixtures/products.json", import.meta.url), join(root, "data", "products.json"));
  const config = loadConfig(root, { ADMIN_PASSWORD: "secret", OPENAI_API_KEY: "test-key" });
  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5 }) };
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
