import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";
import { insertProduct, saveSetting } from "./catalog.js";
import { insertChatFile } from "./chatFiles.js";
import { insertClient, mergeClient, phoneKey } from "./clients.js";
import { transaction } from "./db.js";
import { localIso, shortId } from "./files.js";
import { insertOrder, nextOrderNumber, savedNumberForKey, setLastOrderNumber } from "./orders.js";

export class LegacyFileError extends Error {}

const BUSY = ["EPERM", "EBUSY", "EACCES"];
const pause = new Int32Array(new SharedArrayBuffer(4));

// Antivirus, search indexers and OneDrive briefly lock files on Windows. This runs once at startup, so waiting in place is fine.
function retryBusy(task) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return task();
    } catch (error) {
      if (attempt >= 5 || !BUSY.includes(error?.code)) throw error;
      Atomics.wait(pause, 0, 0, 50 * (attempt + 1));
    }
  }
}

function readOrNull(file) {
  try {
    return retryBusy(() => readFileSync(file, "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// An empty file is damage, not "no data": every writer of the old version put at least "[]".
function parse(text) {
  if (!text.trim()) throw new Error("the file is empty");
  return JSON.parse(text);
}

// A damaged file is read from the copy its last write left (.bak). With no readable copy nothing is imported at all,
// so a half-read file can never become the new truth.
function readJson(file, fallback, logger) {
  const text = readOrNull(file);
  if (text === null) return fallback;
  try {
    return parse(text);
  } catch (error) {
    let copy;
    try {
      const saved = readOrNull(`${file}.bak`);
      if (saved !== null) copy = parse(saved);
    } catch {
      copy = undefined;
    }
    if (copy === undefined) throw new LegacyFileError(`${basename(file)} is damaged and has no readable copy: ${error.message}`);
    logger.error("old data file is damaged, importing the copy from its previous write", { file: basename(file), message: error.message });
    return copy;
  }
}

const list = (value) => (Array.isArray(value) ? value : value && typeof value === "object" ? [value] : []);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function cleanOrder(raw) {
  return {
    ...raw,
    id: String(raw.id || shortId()),
    number: Number.isInteger(Number(raw.number)) && Number(raw.number) > 0 ? Number(raw.number) : 0,
    createdAt: String(raw.createdAt ?? ""),
    status: String(raw.status || "new"),
    name: String(raw.name ?? ""),
    phone: String(raw.phone ?? ""),
    items: Array.isArray(raw.items) ? raw.items : [],
    totals: isRecord(raw.totals) ? raw.totals : {}
  };
}

// Orders keep their numbers; one whose number is taken (only possible after hand edits or a rescue) gets the next free one.
// A rescued order is new, and a new order takes no pieces until the admin takes it into work.
function importOrder(db, raw, logger) {
  const order = cleanOrder(raw);
  if (db.prepare("SELECT 1 FROM orders WHERE id = ?").get(order.id)) return false;
  if (order.key && savedNumberForKey(db, order.key)) return false;
  if (!order.number || db.prepare("SELECT 1 FROM orders WHERE number = ?").get(order.number)) {
    const next = nextOrderNumber(db);
    if (order.number) logger.warn("an imported order had a number already in use and got a new one", { id: order.id, was: order.number, now: next });
    order.number = next;
  }
  insertOrder(db, order);
  setLastOrderNumber(db, order.number);
  return true;
}

function archive(files, paths, logger) {
  const stamp = localIso().slice(0, 19).replace(/[T:]/g, "-");
  const target = join(paths.legacyArchive, stamp);
  for (const file of files) {
    for (const path of [file, `${file}.bak`]) {
      if (!existsSync(path)) continue;
      try {
        mkdirSync(target, { recursive: true });
        retryBusy(() => renameSync(path, join(target, basename(path))));
      } catch (error) {
        logger.warn("an old data file could not be moved aside; the database is used either way", { file: basename(path), message: error.message });
      }
    }
  }
}

// Runs on every start, but does its work once: copies the JSON files of the old version into the database in one transaction
// (all or nothing), then moves them to db/legacy-json so nobody edits a file the site no longer reads.
export function importLegacy(db, paths, logger) {
  const legacy = paths.legacy;
  if (db.prepare("SELECT 1 FROM meta WHERE key = 'legacy_import'").get()) {
    const back = Object.values(legacy).filter((file) => existsSync(file)).map((file) => basename(file));
    if (back.length) logger.warn("old data files are back but the site no longer reads them - the data lives in db/zhuldyz.sqlite", { files: back });
    return null;
  }
  const catalog = readJson(legacy.catalog, null, logger);
  const orders = list(readJson(legacy.orders, [], logger)).filter(isRecord);
  const deleted = list(readJson(legacy.deletedOrders, [], logger)).filter(isRecord);
  const clients = list(readJson(legacy.clients, [], logger)).filter(isRecord);
  const chatFiles = list(readJson(legacy.chatFilesIndex, [], logger)).filter((entry) => isRecord(entry) && entry.id);
  const lastNumber = Number.parseInt((readOrNull(legacy.lastNumber) ?? "").trim(), 10);

  const counts = transaction(db, () => {
    const result = { products: 0, orders: 0, clients: 0, chatFiles: 0, skipped: 0 };
    if (isRecord(catalog)) {
      for (const [key, value] of Object.entries(isRecord(catalog.settings) ? catalog.settings : {})) saveSetting(db, key, value);
      list(catalog.products).forEach((product, position) => {
        if (!isRecord(product) || typeof product.id !== "string" || !product.id || db.prepare("SELECT 1 FROM products WHERE id = ?").get(product.id)) {
          result.skipped += 1;
          return;
        }
        insertProduct(db, product, position);
        result.products += 1;
      });
    }
    for (const entry of deleted) {
      if (entry.key) db.prepare("INSERT OR IGNORE INTO deleted_orders (key, number, deleted_at) VALUES (?, ?, ?)").run(String(entry.key), Number(entry.number) || 0, localIso());
    }
    // The old counter goes first: a number it already gave out must not be handed to an order that needs a new one.
    if (Number.isFinite(lastNumber) && lastNumber > 0) setLastOrderNumber(db, lastNumber);
    for (const order of orders) {
      if (importOrder(db, order, logger)) result.orders += 1;
      else result.skipped += 1;
    }
    for (const client of clients) {
      const phone = phoneKey(client.phone);
      if (!phone || db.prepare("SELECT 1 FROM clients WHERE phone = ? OR id = ?").get(phone, String(client.id ?? ""))) {
        result.skipped += 1;
        continue;
      }
      insertClient(db, { ...client, phone });
      result.clients += 1;
    }
    // Clients missing from clients.json (it lagged behind or was rebuilt) come back from the orders, as the old start did.
    [...orders]
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .forEach((order) => mergeClient(db, String(order.name ?? ""), String(order.phone ?? ""), String(order.createdAt ?? "")));
    for (const entry of chatFiles) {
      if (db.prepare("SELECT 1 FROM chat_files WHERE id = ?").get(String(entry.id))) continue;
      insertChatFile(db, entry);
      result.chatFiles += 1;
    }
    db.prepare("INSERT INTO meta (key, value) VALUES ('legacy_import', ?)").run(JSON.stringify({ at: localIso(), ...result }));
    return result;
  });

  archive(Object.values(legacy), paths, logger);
  if (counts.skipped) logger.warn("some old records were duplicates or had no id and were not imported; the original files are in db/legacy-json", counts);
  logger.info("the old JSON data was moved into the database", counts);
  return counts;
}

// Orders that the database refused are kept in orders-rescue.jsonl; each start moves them in and sets the file aside.
export function importRescued(db, paths, logger) {
  const text = readOrNull(paths.ordersRescue);
  if (text === null) return 0;
  let imported = 0;
  let unreadable = 0;
  transaction(db, () => {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let order;
      try {
        order = JSON.parse(line);
      } catch {
        unreadable += 1;
        continue;
      }
      if (!isRecord(order) || !importOrder(db, order, logger)) continue;
      mergeClient(db, String(order.name ?? ""), String(order.phone ?? ""), String(order.createdAt ?? ""));
      imported += 1;
    }
  });
  archive([paths.ordersRescue], paths, logger);
  if (unreadable) logger.error("some rescued orders could not be read; the file is kept in db/legacy-json", { unreadable });
  logger.info("rescued orders were moved into the database", { imported });
  return imported;
}
