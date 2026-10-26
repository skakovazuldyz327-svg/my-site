import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// Errors that are often short-lived on Windows: an antivirus, a backup tool or an open window holding the file.
const BUSY_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A folder that does not exist reads as empty; one that cannot be read throws, so nothing is decided from a partial list.
export async function readdirOrEmpty(dir, options) {
  try {
    return await readdir(dir, options);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function listFiles(dir) {
  const files = [];
  for (const entry of await readdirOrEmpty(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// null only when the file is gone on every try; a file still busy after the last try throws its error.
export async function statOrMissing(file, { attempts = 3, delayMs = 200 } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await stat(file);
    } catch (error) {
      if (error.code !== "ENOENT" && !BUSY_CODES.has(error.code)) throw error;
      if (attempt >= attempts) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
      await sleep(delayMs * attempt);
    }
  }
}

// Runs async tasks one after another; chat uploads use it so the quota check and the save cannot interleave.
export function createLock() {
  let tail = Promise.resolve();
  return function locked(task) {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

export const shortId = () => randomUUID().replace(/-/g, "").slice(0, 12);

// Same shape PowerShell wrote ("2026-10-10T00:52:43.7007078+05:00"), so string comparison of dates keeps working.
export function localIso(date = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}0000${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
