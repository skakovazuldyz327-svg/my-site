import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { silentLogger } from "../log.js";
import { listFiles, readdirOrEmpty, statOrMissing } from "./files.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function databaseText(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  const parts = [];
  for (const { name } of tables) {
    for (const row of db.prepare(`SELECT * FROM "${name.replace(/"/g, '""')}"`).iterate()) {
      for (const value of Object.values(row)) if (typeof value === "string") parts.push(value);
    }
  }
  return parts.join("\n");
}

// Windows finds a file whatever the letter case, and a link may be URL-encoded: a photo counts as used when its path
// appears anywhere in any of these forms. A false match only keeps a file, it never deletes one.
function isMentioned(texts, name) {
  const forms = new Set([name, encodeURI(name), encodeURIComponent(name)].map((form) => `images/products/${form}`.toLowerCase()));
  return texts.some((text) => [...forms].some((form) => text.includes(form)));
}

// A photo the admin took off every product stays as long as a daily copy or a database set aside by a restore still
// shows it, so restoring any of them brings the photos back too. A fresh upload stays a day: its product may not be saved yet.
export function createPhotos(db, paths, logger = silentLogger) {
  async function savedTexts() {
    const texts = [databaseText(db)];
    for (const file of await listFiles(paths.dist)) {
      if (/\.(html|js|css)$/.test(file)) texts.push(await readFile(file, "utf8"));
    }
    const saved = [
      ...(await listFiles(paths.backups)),
      ...(await readdirOrEmpty(paths.db, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => join(paths.db, entry.name))
    ];
    for (const file of saved) {
      // full-backup-* is the short-lived copy of a zip download, the same data as the live database.
      if (resolve(file) === resolve(paths.database) || /[\\/]full-backup-[^\\/]*$/.test(file)) continue;
      if (file.endsWith(".sqlite")) {
        const copy = new DatabaseSync(file, { readOnly: true });
        try {
          texts.push(databaseText(copy));
        } finally {
          copy.close();
        }
      } else if (/\.(json|jsonl)$/.test(file)) {
        texts.push(await readFile(file, "utf8"));
      }
    }
    // JSON may write "/" as "\/", and a path typed by hand on Windows may use "\".
    return texts.map((text) => text.replace(/\\\//g, "/").replace(/\\+/g, "/").toLowerCase());
  }

  return {
    // An unreadable copy or folder throws before anything is deleted; a single photo that is busy is left for the next run.
    async cleanup(now = Date.now()) {
      const files = await readdirOrEmpty(paths.uploads, { withFileTypes: true });
      const candidates = [];
      for (const entry of files) {
        if (!entry.isFile()) continue;
        try {
          const info = await statOrMissing(join(paths.uploads, entry.name));
          if (info && now - info.mtimeMs >= DAY_MS) candidates.push(entry.name);
        } catch (error) {
          logger.warn("a photo was left in place: it could not be checked", { file: entry.name, code: error.code, message: error.message });
        }
      }
      if (!candidates.length) return [];
      const texts = await savedTexts();
      const removed = [];
      for (const name of candidates) {
        if (isMentioned(texts, name)) continue;
        try {
          await rm(join(paths.uploads, name), { force: true });
          removed.push(name);
        } catch (error) {
          logger.warn("a photo no one uses could not be removed", { file: name, code: error.code, message: error.message });
        }
      }
      return removed;
    }
  };
}
