import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { localIso, shortId } from "./files.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const fromRow = (row) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  size: row.size,
  session: row.session,
  text: row.text,
  createdAt: row.created_at,
  time: row.time
});

export function insertChatFile(db, entry) {
  db.prepare("INSERT INTO chat_files (id, name, type, size, session, text, created_at, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    String(entry.id),
    String(entry.name ?? ""),
    String(entry.type ?? ""),
    Number(entry.size) || 0,
    String(entry.session ?? ""),
    String(entry.text ?? ""),
    String(entry.createdAt ?? ""),
    Number(entry.time) || 0
  );
}

// The files themselves stay on disk under their random id only; the client's file name lives in the database and
// never touches the disk path.
export function createChatFiles(db, paths, limits, lock) {
  const rows = db.prepare("SELECT * FROM chat_files ORDER BY rowid");
  const fileOf = (id) => join(paths.chatFiles, id);
  const usedBytes = (entries) => entries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);

  return {
    read: async () => rows.all().map(fromRow),
    usedBytes,

    // Returns null when the storage quota is full.
    add({ name, type, session, text, bytes }) {
      return lock(async () => {
        const used = db.prepare("SELECT COALESCE(SUM(size), 0) AS used FROM chat_files").get().used;
        if (used + bytes.length > limits.totalBytes) return null;
        const entry = { id: shortId(), name, type, size: bytes.length, session, text, createdAt: localIso(), time: Date.now() };
        await mkdir(paths.chatFiles, { recursive: true });
        await writeFile(fileOf(entry.id), bytes);
        try {
          insertChatFile(db, entry);
        } catch (error) {
          await rm(fileOf(entry.id), { force: true });
          throw error;
        }
        return entry;
      });
    },

    async find(id) {
      const row = db.prepare("SELECT * FROM chat_files WHERE id = ?").get(String(id ?? ""));
      return row ? { entry: fromRow(row), path: fileOf(row.id) } : null;
    },

    remove(id) {
      return lock(async () => {
        if (!db.prepare("DELETE FROM chat_files WHERE id = ?").run(String(id ?? "")).changes) return false;
        await rm(fileOf(String(id)), { force: true });
        return true;
      });
    },

    // Drops expired files and files left on disk without a database entry (a crash between the two writes).
    // A file without an entry goes only once it is as old as an expired one: a database restored from a daily copy
    // lacks the newest entries, and their files must survive until someone can look at them.
    cleanup(now = Date.now()) {
      return lock(async () => {
        db.prepare("DELETE FROM chat_files WHERE time <= ?").run(now - limits.days * DAY_MS);
        const known = new Set(rows.all().map((row) => row.id));
        const names = await readdir(paths.chatFiles).catch(() => []);
        let removed = 0;
        for (const name of names) {
          if (known.has(name)) continue;
          const info = await stat(fileOf(name)).catch(() => null);
          if (info && now - info.mtimeMs < limits.days * DAY_MS) continue;
          await rm(fileOf(name), { force: true, recursive: true });
          removed += 1;
        }
        return removed;
      });
    }
  };
}
