import { existsSync, readdirSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DUMP_FORMAT, loadDump, TABLES } from "./db.js";
import { writeDumpFileSync } from "./dumps.js";
import { localIso } from "./files.js";

// The tables of the first SQLite schema; stock came later.
const REQUIRED_TABLES = ["meta", "settings", "products", "orders", "deleted_orders", "counters", "clients", "chat_files"];

// The whole SQLite database of the site before PostgreSQL, in the dump format the PostgreSQL site restores from.
// The live file is opened for writing on purpose: a journal left by a crash is rolled back first, as the old site would do.
export function readSqlite(file, { live = false } = {}) {
  const db = new DatabaseSync(file, { readOnly: !live });
  try {
    const check = db.prepare("PRAGMA integrity_check").get().integrity_check;
    if (check !== "ok") throw new Error(`SQLite's integrity check failed: ${check}`);
    const present = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
    if (missing.length) throw new Error(`${basename(file)} has no ${missing.join(", ")} table`);
    const tables = {};
    for (const [name, { columns }] of Object.entries(TABLES)) {
      tables[name] = present.has(name) ? db.prepare(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM ${name} ORDER BY rowid`).all().map((row) => ({ ...row })) : [];
    }
    for (const client of tables.clients) client.hidden = Boolean(client.hidden);
    return { format: DUMP_FORMAT, schema: 1, createdAt: localIso(), tables };
  } finally {
    db.close();
  }
}

const counted = (dump) => Object.fromEntries(Object.entries(dump.tables).map(([name, rows]) => [name, rows.length]));

// The daily SQLite copies get a copy in the new format beside them, so restore-backup.bat can still go back to those days.
function convertBackups(paths, logger) {
  let days = [];
  try {
    days = readdirSync(paths.backups, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name));
  } catch (error) {
    if (error.code !== "ENOENT") logger.warn("the daily SQLite copies could not be listed, they were not converted", { message: error.message });
    return 0;
  }
  let converted = 0;
  for (const { name } of days) {
    const from = join(paths.backups, name, "zhuldyz.sqlite");
    const to = join(paths.backups, name, "zhuldyz.json");
    if (!existsSync(from) || existsSync(to)) continue;
    try {
      writeDumpFileSync(to, readSqlite(from));
      converted += 1;
    } catch (error) {
      logger.warn("a daily SQLite copy could not be converted; it stays as it is", { day: name, message: error.message });
    }
  }
  return converted;
}

// Runs on every start, but does its work once: moves db/zhuldyz.sqlite into PostgreSQL in one transaction (all or nothing),
// then renames it to zhuldyz-before-postgres.sqlite so nobody takes it for the live database.
export async function importSqlite(db, paths, logger) {
  if (!existsSync(paths.sqlite)) return null;
  if (await db.one("SELECT 1 FROM meta WHERE key = 'sqlite_import'")) {
    logger.warn("db/zhuldyz.sqlite is back, but its data was moved into PostgreSQL already - the site does not read it");
    return null;
  }
  const filled = await db.one("SELECT EXISTS (SELECT 1 FROM orders) OR EXISTS (SELECT 1 FROM products) OR EXISTS (SELECT 1 FROM clients) AS any");
  if (filled.any) {
    logger.warn("db/zhuldyz.sqlite was not moved in: the PostgreSQL database has data already, and the two are not mixed", { file: paths.sqlite });
    return null;
  }

  const dump = readSqlite(paths.sqlite, { live: true });
  const counts = counted(dump);
  await db.transaction(async (tx) => {
    await loadDump(tx, dump);
    await tx.run("INSERT INTO meta (key, value) VALUES ('sqlite_import', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
      JSON.stringify({ at: localIso(), ...counts })
    ]);
  });

  const backups = convertBackups(paths, logger);
  const archive = existsSync(paths.sqliteArchive) ? paths.sqliteArchive.replace(/\.sqlite$/, `-${localIso().slice(0, 19).replace(/[T:]/g, "-")}.sqlite`) : paths.sqliteArchive;
  try {
    renameSync(paths.sqlite, archive);
  } catch (error) {
    logger.warn("db/zhuldyz.sqlite was moved into PostgreSQL but could not be renamed; the site does not read it either way", { message: error.message });
  }
  logger.info("the SQLite database was moved into PostgreSQL", { ...counts, convertedBackups: backups, archive: basename(archive) });
  return counts;
}
