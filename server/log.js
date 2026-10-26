import { appendFile, rename, stat } from "node:fs/promises";

const MAX_LOG_SIZE = 2 * 1024 * 1024;

export function createLogger(file, { quiet = false } = {}) {
  let chain = Promise.resolve();

  const write = (level, message, data) => {
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${data ? ` ${JSON.stringify(data)}` : ""}`;
    if (!quiet) (level === "error" ? console.error : console.log)(`  ${line}`);
    if (!file) return;
    chain = chain
      .then(async () => {
        const info = await stat(file).catch(() => null);
        if (info && info.size > MAX_LOG_SIZE) await rename(file, `${file}.old`).catch(() => {});
        await appendFile(file, `${line}\n`, "utf8");
      })
      .catch(() => {});
  };

  return {
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
    flush: () => chain
  };
}

export const silentLogger = { info() {}, warn() {}, error() {}, flush: () => Promise.resolve() };
