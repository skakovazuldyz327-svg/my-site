import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { dumpDatabase, loadDump, SITE_APPLICATION } from "./db.js";
import { readDumpFile, writeDumpFile } from "./dumps.js";
import { localIso } from "./files.js";
import { nextOrderNumber, setLastOrderNumber } from "./orders.js";

// Only a copy that reads as a whole database of this site is offered; the counts help to pick the right day.
function describe(file) {
  try {
    const { tables } = readDumpFile(file);
    return {
      orders: tables.orders.length,
      lastOrder: tables.orders.reduce((last, order) => Math.max(last, Number(order.number) || 0), 0),
      products: tables.products.length,
      clients: tables.clients.length
    };
  } catch {
    return null;
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
    .map((day) => ({ day, file: join(paths.backups, day, "zhuldyz.json") }))
    .filter((backup) => existsSync(backup.file))
    .map((backup) => ({ ...backup, info: describe(backup.file) }))
    .filter((backup) => backup.info);
}

// code: the current database cannot tell its order counter, so restoring would give out numbers clients already have.
export class CounterUnreadableError extends Error {
  code = "COUNTER_UNREADABLE";
}

// The site must be stopped. The current data is saved to db/before-restore-*.json first, so orders taken after the copy can
// still be found. Its order counter is carried over: a number a client already has must not be given out again. When the
// counter cannot be read, nothing is changed unless lastNumber (the last number clients were given, known to the owner) is passed.
// The copy replaces the data in one transaction, so a failure leaves the database as it was.
export async function restoreBackup(db, paths, backup, { lastNumber = 0 } = {}) {
  const label = backup.day ?? basename(backup.file);
  const refuse = (message, cause) => new Error(`the copy of ${label} was not restored, nothing was changed: ${message}`, { cause });

  let dump;
  try {
    dump = readDumpFile(backup.file);
  } catch (error) {
    throw refuse(error.message, error);
  }

  const { running } = await db.one("SELECT COUNT(*)::int AS running FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1 AND pid <> pg_backend_pid()", [SITE_APPLICATION]);
  if (running) throw refuse("the site is still connected to the database - close its window or run stop-site.bat");

  let issued = Math.max(0, Math.floor(Number(lastNumber) || 0));
  try {
    issued = Math.max(issued, (await nextOrderNumber(db)) - 1);
  } catch (error) {
    if (!issued) throw new CounterUnreadableError(`the order counter of the current database could not be read (${error.message})`, { cause: error });
  }

  const kept = join(paths.db, `before-restore-${localIso().slice(0, 19).replace(/[T:]/g, "-")}.json`);
  try {
    await writeDumpFile(kept, await dumpDatabase(db));
  } catch (error) {
    throw refuse(`the current data could not be saved aside first (${error.message})`, error);
  }

  try {
    await db.transaction(async (tx) => {
      await loadDump(tx, dump);
      if (issued) await setLastOrderNumber(tx, issued);
    });
  } catch (error) {
    throw refuse(error.message, error);
  }
  return basename(kept);
}
