import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Each entry moves the schema up one version (PRAGMA user_version). Never edit an entry that has already run on the site:
// add a new one instead.
const MIGRATIONS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE products (id TEXT PRIMARY KEY, position INTEGER NOT NULL, data TEXT NOT NULL);
   CREATE TABLE orders (
     id TEXT PRIMARY KEY,
     number INTEGER NOT NULL UNIQUE,
     key TEXT UNIQUE,
     created_at TEXT NOT NULL,
     status TEXT NOT NULL,
     name TEXT NOT NULL,
     phone TEXT NOT NULL,
     items TEXT NOT NULL,
     totals TEXT NOT NULL,
     extra TEXT
   );
   CREATE TABLE deleted_orders (key TEXT PRIMARY KEY, number INTEGER NOT NULL, deleted_at TEXT NOT NULL);
   CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
   CREATE TABLE clients (
     id TEXT PRIMARY KEY,
     phone TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     created_at TEXT NOT NULL,
     last_order_at TEXT NOT NULL,
     hidden INTEGER NOT NULL DEFAULT 0,
     extra TEXT
   );
   CREATE TABLE chat_files (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     type TEXT NOT NULL,
     size INTEGER NOT NULL,
     session TEXT NOT NULL,
     text TEXT NOT NULL,
     created_at TEXT NOT NULL,
     time INTEGER NOT NULL
   );`,
  // Pieces on hand per product and size ("" for a product without sizes). A product without rows is not counted.
  // Kept apart from the product JSON so orders taking stock never look like an edit from another admin window.
  `CREATE TABLE stock (
     product_id TEXT NOT NULL,
     size TEXT NOT NULL,
     qty INTEGER NOT NULL CHECK (qty >= 0),
     PRIMARY KEY (product_id, size)
   );`
];

// The API is synchronous, so nothing else in this process can run between BEGIN and COMMIT.
export function transaction(db, task) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = task();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 5000 });
  // A rollback journal keeps the whole database in the one file between writes, so a copy of zhuldyz.sqlite is complete;
  // FULL flushes every commit to disk, so a power cut cannot take back an order the visitor was told is saved.
  db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > MIGRATIONS.length) {
    db.close();
    throw new Error(`zhuldyz.sqlite was made by a newer version of the site (schema ${version}, this one knows ${MIGRATIONS.length})`);
  }
  for (let next = version; next < MIGRATIONS.length; next += 1) {
    transaction(db, () => {
      db.exec(MIGRATIONS[next]);
      db.exec(`PRAGMA user_version = ${next + 1}`);
    });
  }
  return db;
}

// Fields the code does not know (added by hand or by an older version) ride along in "extra" instead of being dropped.
export function extraOf(record, known) {
  const extra = Object.fromEntries(Object.entries(record).filter(([field]) => !known.includes(field)));
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// A column damaged by a hand edit or a disk error reads as undefined, so one bad row cannot stop a whole list from loading.
export function parseColumn(text, valid) {
  try {
    const value = JSON.parse(text);
    return valid(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export const parseExtra = (text) => (text ? parseColumn(text, isRecord) : {});
