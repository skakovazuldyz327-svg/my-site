import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { silentLogger } from "../log.js";
import { localIso, readdirOrEmpty, shortId, statOrMissing } from "./files.js";

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

export async function insertChatFile(db, entry) {
  await db.run("INSERT INTO chat_files (id, name, type, size, session, text, created_at, time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
    String(entry.id),
    String(entry.name ?? ""),
    String(entry.type ?? ""),
    Math.trunc(Number(entry.size)) || 0,
    String(entry.session ?? ""),
    String(entry.text ?? ""),
    String(entry.createdAt ?? ""),
    Math.trunc(Number(entry.time)) || 0
  ]);
}

// The files themselves stay on disk under their random id only; the client's file name lives in the database and
// never touches the disk path.
export function createChatFiles(db, paths, limits, lock, logger = silentLogger) {
  const allRows = () => db.query("SELECT * FROM chat_files ORDER BY seq");
  const fileOf = (id) => join(paths.chatFiles, id);
  const usedBytes = (entries) => entries.reduce((sum, entry) => sum + (Number(entry.size) || 0), 0);

  return {
    read: async () => (await allRows()).map(fromRow),
    usedBytes,

    // Returns null when the storage quota is full.
    add({ name, type, session, text, bytes }) {
      return lock(async () => {
        const { used } = await db.one("SELECT COALESCE(SUM(size), 0)::bigint AS used FROM chat_files");
        if (used + bytes.length > limits.totalBytes) return null;
        const entry = { id: shortId(), name, type, size: bytes.length, session, text, createdAt: localIso(), time: Date.now() };
        await mkdir(paths.chatFiles, { recursive: true });
        await writeFile(fileOf(entry.id), bytes);
        try {
          await insertChatFile(db, entry);
        } catch (error) {
          await rm(fileOf(entry.id), { force: true });
          throw error;
        }
        return entry;
      });
    },

    async find(id) {
      const row = await db.one("SELECT * FROM chat_files WHERE id = $1", [String(id ?? "")]);
      return row ? { entry: fromRow(row), path: fileOf(row.id) } : null;
    },

    remove(id) {
      return lock(async () => {
        if (!(await db.run("DELETE FROM chat_files WHERE id = $1", [String(id ?? "")]))) return false;
        await rm(fileOf(String(id)), { force: true });
        return true;
      });
    },

    // Drops expired files and files left on disk without a database entry (a crash between the two writes).
    // A file without an entry goes only once it is as old as an expired one: a database restored from a daily copy
    // lacks the newest entries, and their files must survive until someone can look at them.
    cleanup(now = Date.now()) {
      return lock(async () => {
        await db.run("DELETE FROM chat_files WHERE time <= $1", [Math.trunc(now - limits.days * DAY_MS)]);
        const known = new Set((await db.query("SELECT id FROM chat_files")).map((row) => row.id));
        const names = await readdirOrEmpty(paths.chatFiles);
        let removed = 0;
        for (const name of names) {
          if (known.has(name)) continue;
          // A file that cannot be looked at or removed now is left for the next cleanup, never removed on a guess.
          try {
            const info = await statOrMissing(fileOf(name));
            if (!info || now - info.mtimeMs < limits.days * DAY_MS) continue;
            await rm(fileOf(name), { force: true, recursive: true });
            removed += 1;
          } catch (error) {
            logger.warn("a chat file was left in place: it could not be checked or removed", { file: name, code: error.code, message: error.message });
          }
        }
        return removed;
      });
    }
  };
}
