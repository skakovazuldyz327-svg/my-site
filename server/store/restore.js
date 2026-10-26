import { copyFileSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
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

// The tables of the first schema; later ones are added by the migrations when the site opens the restored file.
const REQUIRED_TABLES = ["meta", "settings", "products", "orders", "deleted_orders", "counters", "clients", "chat_files"];

// code: the current database cannot tell its order counter, so restoring would give out numbers clients already have.
export class CounterUnreadableError extends Error {
  code = "COUNTER_UNREADABLE";
}

// Opened for writing on purpose: a journal left by a crash is rolled back first, as the site itself would do.
function lastIssuedNumber(file) {
  let db;
  try {
    db = new DatabaseSync(file);
    return nextOrderNumber(db) - 1;
  } catch (error) {
    throw new CounterUnreadableError(`the order counter of ${basename(file)} could not be read (${error.message})`, { cause: error });
  } finally {
    db?.close();
  }
}

function checkCopy(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const result = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (result !== "ok") throw new Error(`SQLite's integrity check failed: ${result}`);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length) throw new Error(`the copy has no ${missing.join(", ")} table`);
  } finally {
    db.close();
  }
}

function removeTemp(file) {
  rmSync(file, { force: true });
  rmSync(`${file}-journal`, { force: true });
}

// The site must be stopped. The current database is renamed, never deleted, so orders taken after the copy can still be found.
// Its order counter is carried over: a number a client already has must not be given out again. When the counter cannot be
// read, nothing is changed unless lastNumber (the last number clients were given, known to the owner) is passed.
// The copy is prepared and checked as zhuldyz.sqlite.tmp; the live file is replaced only by renames, undone on failure.
export function restoreBackup(paths, backup, { lastNumber = 0 } = {}) {
  const current = existsSync(paths.database);
  let issued = Math.max(0, Math.floor(Number(lastNumber) || 0));
  if (current) {
    try {
      issued = Math.max(issued, lastIssuedNumber(paths.database));
    } catch (error) {
      if (!issued) throw error;
    }
  }

  const temp = `${paths.database}.tmp`;
  const label = backup.day ?? basename(backup.file);
  removeTemp(temp);
  try {
    copyFileSync(backup.file, temp);
    checkCopy(temp);
    if (issued) {
      const db = new DatabaseSync(temp);
      try {
        setLastOrderNumber(db, issued);
      } finally {
        db.close();
      }
    }
  } catch (error) {
    removeTemp(temp);
    throw new Error(`the copy of ${label} was not restored, nothing was changed: ${error.message}`, { cause: error });
  }

  const kept = current ? join(paths.db, `before-restore-${localIso().slice(0, 19).replace(/[T:]/g, "-")}.sqlite`) : "";
  const moved = [];
  const move = (from, to) => {
    renameSync(from, to);
    moved.push([from, to]);
  };
  try {
    if (current) {
      move(paths.database, kept);
      if (existsSync(`${paths.database}-journal`)) move(`${paths.database}-journal`, `${kept}-journal`);
    }
    move(temp, paths.database);
  } catch (error) {
    const stuck = [];
    for (const [from, to] of moved.reverse()) {
      try {
        renameSync(to, from);
      } catch (undo) {
        stuck.push(`${basename(to)} -> ${basename(from)} (${undo.code || undo.message})`);
      }
    }
    if (!stuck.length) removeTemp(temp);
    const undone = stuck.length ? `; putting the files back failed, rename by hand: ${stuck.join(", ")}` : ", the database was put back as it was";
    throw new Error(`the copy of ${label} was not restored: ${error.message}${undone}`, { cause: error });
  }
  return kept ? basename(kept) : "";
}
