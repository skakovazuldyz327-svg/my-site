import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

// Windows finds a file whatever the letter case, and a link may be URL-encoded: a photo counts as used when its path
// appears anywhere in any of these forms. A false match only keeps a file, it never deletes one.
function isMentioned(texts, name) {
  const forms = new Set([name, encodeURI(name), encodeURIComponent(name)].map((form) => `images/products/${form}`.toLowerCase()));
  return texts.some((text) => [...forms].some((form) => text.includes(form)));
}

// A photo the admin took off every product stays as long as a daily copy or a database set aside by a restore still
// shows it, so restoring any of them brings the photos back too. A fresh upload stays a day: its product may not be saved yet.
export function createPhotos(db, paths) {
  async function savedTexts() {
    const texts = [databaseText(db)];
    for (const file of await listFiles(paths.dist)) {
      if (/\.(html|js|css)$/.test(file)) texts.push(await readFile(file, "utf8"));
    }
    const saved = [
      ...(await listFiles(paths.backups)),
      ...(await readdir(paths.db, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isFile()).map((entry) => join(paths.db, entry.name))
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
    // An unreadable copy throws before anything is deleted.
    async cleanup(now = Date.now()) {
      const files = await readdir(paths.uploads, { withFileTypes: true }).catch(() => []);
      const candidates = [];
      for (const entry of files) {
        if (!entry.isFile()) continue;
        const info = await stat(join(paths.uploads, entry.name)).catch(() => null);
        if (info && now - info.mtimeMs >= DAY_MS) candidates.push(entry.name);
      }
      if (!candidates.length) return [];
      const texts = await savedTexts();
      const removed = [];
      for (const name of candidates) {
        if (isMentioned(texts, name)) continue;
        await rm(join(paths.uploads, name), { force: true });
        removed.push(name);
      }
      return removed;
    }
  };
}
