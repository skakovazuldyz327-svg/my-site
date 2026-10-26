import { copyFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { localIso } from "./files.js";
import { nextOrderNumber, setLastOrderNumber } from "./orders.js";

// Only a copy that opens and passes SQLite's own check is offered; the counts help to pick the right day.
function describe(file) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") return null;
    const count = (table) => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
    return {
      orders: count("orders"),
      lastOrder: db.prepare("SELECT COALESCE(MAX(number), 0) AS last FROM orders").get().last,
      products: count("products"),
      clients: count("clients")
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export function listBackups(paths) {
  let days = [];
  try {
    days = readdirSync(paths.backups, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return days
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .map((day) => ({ day, file: join(paths.backups, day, "zhuldyz.sqlite") }))
    .filter((backup) => existsSync(backup.file))
    .map((backup) => ({ ...backup, info: describe(backup.file) }))
    .filter((backup) => backup.info);
}

function lastIssuedNumber(file) {
  let db;
  try {
    db = new DatabaseSync(file);
    return nextOrderNumber(db) - 1;
  } catch {
    return 0;
  } finally {
    db?.close();
  }
}

// The site must be stopped. The current database is renamed, never deleted, so orders taken after the copy can still be found.
// Its order counter is carried over: a number a client already has must not be given out again.
export function restoreBackup(paths, backup) {
  let kept = "";
  let issued = 0;
  if (existsSync(paths.database)) {
    kept = join(paths.db, `before-restore-${localIso().slice(0, 19).replace(/[T:]/g, "-")}.sqlite`);
    renameSync(paths.database, kept);
    if (existsSync(`${paths.database}-journal`)) renameSync(`${paths.database}-journal`, `${kept}-journal`);
    issued = lastIssuedNumber(kept);
  }
  copyFileSync(backup.file, paths.database);
  if (issued) {
    const db = new DatabaseSync(paths.database);
    try {
      setLastOrderNumber(db, issued);
    } finally {
      db.close();
    }
  }
  return kept ? basename(kept) : "";
}
