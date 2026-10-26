import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { silentLogger } from "../log.js";
import { mergeClient } from "./clients.js";
import { extraOf, parseColumn, parseExtra, transaction } from "./db.js";
import { localIso, shortId } from "./files.js";
import { returnStock, takeStock } from "./stock.js";

const STATUSES = ["new", "work", "done", "cancel"];
// Anyone can send an order, so only one the admin has taken into work holds pieces; otherwise fake orders could empty the stock.
const HOLDS_STOCK = ["work", "done"];
const CURRENCIES = ["KZT", "USD", "RUB"];
const ORDER_KEY = /^[A-Za-z0-9-]{8,64}$/;
const FIELDS = ["id", "number", "key", "createdAt", "status", "name", "phone", "items", "totals"];
// The shop page's bag holds no more lines than this, so only a hand-made request is cut.
const MAX_LINES = 50;

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const readItems = (text) => parseColumn(text, (value) => Array.isArray(value) && value.every(isRecord));

function cleanQty(value) {
  const text = String(value ?? "");
  const qty = /^\s*[+-]?\d{1,9}\s*$/.test(text) ? Number.parseInt(text, 10) : 1;
  return Math.min(20, Math.max(1, qty));
}

const cleanText = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max).replace(/[\uD800-\uDBFF]$/, "");

// Optional details for the invoice: the buyer's organisation, its BIN/IIN (12 digits) and the delivery address.
// strict refuses a broken BIN/IIN; otherwise it is dropped, because an order must never be lost over it.
function cleanBuyer(payload, strict) {
  const bin = String(payload?.bin ?? "").replace(/\s/g, "");
  const binValid = /^\d{12}$/.test(bin);
  if (strict && bin && !binValid) return null;
  return { company: cleanText(payload?.company, 160), bin: binValid ? bin : "", address: cleanText(payload?.address, 200) };
}

const filled = (buyer) => Object.fromEntries(Object.entries(buyer).filter(([, value]) => value));

// The visitor's WhatsApp message is written from the page they loaded: a size or price the admin changed meanwhile
// is kept as they saw it, so the order in the admin matches the message.
function cleanLine(line, products) {
  const qty = cleanQty(line?.qty);
  const product = products.find((entry) => entry.id === String(line?.id ?? ""));
  if (product) {
    const given = String(line.size ?? "").trim();
    const known = (product.sizes || []).includes(given);
    const size = known ? given : cleanText(given, 40);
    const sizeRemoved = Boolean(size) && !known;
    const price = Number(product.price) || 0;
    const currency = CURRENCIES.includes(product.currency) ? product.currency : "KZT";
    const seenPrice = Number(line.price);
    const seenCurrency = CURRENCIES.includes(line.currency) ? line.currency : currency;
    const seen = Number.isFinite(seenPrice) && seenPrice > 0 && seenPrice <= 1e9 && (seenPrice !== price || seenCurrency !== currency);
    return {
      id: String(product.id),
      name: String(product.name),
      size,
      qty,
      price,
      currency,
      ...(sizeRemoved ? { sizeRemoved: true } : {}),
      ...(seen ? { seenPrice, seenCurrency } : {})
    };
  }
  // The visitor's page still showed a product the admin has just removed: it is kept as they saw it, so the order is not lost.
  const name = cleanText(line?.name, 200);
  if (!name) return null;
  const price = Number(line.price);
  return {
    id: cleanText(line.id, 60),
    name,
    size: cleanText(line.size, 40),
    qty,
    price: Number.isFinite(price) && price >= 0 && price <= 1e9 ? price : 0,
    currency: CURRENCIES.includes(line.currency) ? line.currency : "KZT",
    removed: true
  };
}

// A damaged order still shows its number, name and phone; "damaged" tells the admin the rest needs a backup copy.
function fromRow(row) {
  const items = readItems(row.items);
  const totals = parseColumn(row.totals, isRecord);
  const extra = parseExtra(row.extra);
  return {
    id: row.id,
    number: row.number,
    ...(row.key ? { key: row.key } : {}),
    createdAt: row.created_at,
    status: row.status,
    name: row.name,
    phone: row.phone,
    items: items || [],
    totals: totals || {},
    ...extra,
    ...(items && totals && extra ? {} : { damaged: true })
  };
}

export function insertOrder(db, order) {
  db.prepare("INSERT INTO orders (id, number, key, created_at, status, name, phone, items, totals, extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    order.id,
    order.number,
    order.key || null,
    order.createdAt,
    order.status,
    order.name,
    order.phone,
    JSON.stringify(order.items),
    JSON.stringify(order.totals),
    extraOf(order, FIELDS)
  );
}

// Deleted orders must not free their numbers: the client may still have that number in WhatsApp.
export function nextOrderNumber(db) {
  const counter = db.prepare("SELECT value FROM counters WHERE name = 'last_order_number'").get()?.value ?? 0;
  const highest = db.prepare("SELECT COALESCE(MAX(number), 0) AS highest FROM orders").get().highest;
  return 1 + Math.max(counter, highest);
}

export function setLastOrderNumber(db, number) {
  db.prepare("INSERT INTO counters (name, value) VALUES ('last_order_number', ?) ON CONFLICT (name) DO UPDATE SET value = MAX(value, excluded.value)").run(number);
}

// A browser repeats an order it never got an answer for; the keys of deleted orders keep such a repeat from bringing one back.
export function savedNumberForKey(db, key) {
  return db.prepare("SELECT number FROM orders WHERE key = ? UNION ALL SELECT number FROM deleted_orders WHERE key = ?").get(key, key)?.number ?? 0;
}

export function createOrders(db, { catalog, paths, logger = silentLogger }) {
  const rows = db.prepare("SELECT * FROM orders ORDER BY number");
  let lastIssued = nextOrderNumber(db) - 1;
  // With the database unreadable an order is still priced from the catalog it last showed, and then rescued.
  let knownProducts = [];
  const products = () => catalog.read().then(
    (current) => (knownProducts = current.products),
    (error) => {
      if (!knownProducts.length) throw error;
      return knownProducts;
    }
  );
  products().catch(() => {});

  // The database refused the write (disk error, file held by another program): the order goes to a side file instead of
  // being lost, and the next start moves it into the database.
  function rescue(order, error) {
    const saved = { ...order, number: lastIssued + 1 };
    mkdirSync(dirname(paths.ordersRescue), { recursive: true });
    appendFileSync(paths.ordersRescue, `${JSON.stringify(saved)}\n`, "utf8");
    lastIssued = saved.number;
    logger.error("the database did not take the order, it was saved to orders-rescue.jsonl", { number: saved.number, message: error.message });
    return saved.number;
  }

  return {
    read: async () => rows.all().map(fromRow),

    // What the shop page needs to print the invoice for the order it has just sent, and nothing more.
    async invoice(number) {
      const row = db.prepare("SELECT * FROM orders WHERE number = ?").get(Number(number) || 0);
      if (!row) return null;
      const order = fromRow(row);
      return {
        number: order.number,
        createdAt: order.createdAt,
        name: order.name,
        phone: order.phone,
        ...filled(cleanBuyer(order, false)),
        items: order.items.map(({ id, name, size, qty, price, currency }) => ({ id, name, size, qty, price, currency }))
      };
    },

    // The admin adds or corrects the buyer's details before printing the invoice; an empty field removes that detail.
    async setBuyer(payload) {
      const buyer = cleanBuyer(payload, true);
      if (!buyer) return false;
      return transaction(db, () => {
        const row = db.prepare("SELECT extra FROM orders WHERE id = ?").get(String(payload?.id ?? ""));
        // Damaged details are left for a repair from a backup rather than written over.
        const current = row ? parseExtra(row.extra) : undefined;
        if (!current) return false;
        const { company, bin, address, ...rest } = current;
        const extra = { ...rest, ...filled(buyer) };
        db.prepare("UPDATE orders SET extra = ? WHERE id = ?").run(Object.keys(extra).length ? JSON.stringify(extra) : null, String(payload.id));
        return true;
      });
    },

    async add(payload) {
      if (!payload || typeof payload !== "object") return 0;
      let name = String(payload.name ?? "").trim().replace(/\s+/g, " ");
      if (name.length > 60) name = name.slice(0, 60);
      let phone = String(payload.phone ?? "").trim();
      if (phone.length > 20) phone = phone.slice(0, 20);
      const digits = phone.replace(/\D/g, "").length;
      if (name.length < 2 || digits < 10 || digits > 15) return 0;
      // The browser repeats an order it could not confirm; the key lets the repeat find the order already saved.
      const key = ORDER_KEY.test(String(payload.key ?? "")) ? String(payload.key) : "";

      const catalogProducts = await products();
      const lines = Array.isArray(payload.items) ? payload.items : [];
      if (lines.length > MAX_LINES) logger.warn("an order had more lines than the site takes, the rest were dropped", { lines: lines.length, kept: MAX_LINES });
      const items = [];
      const totals = {};
      for (const line of lines.slice(0, MAX_LINES)) {
        const item = cleanLine(line, catalogProducts);
        if (!item) continue;
        items.push(item);
        totals[item.currency] = (totals[item.currency] || 0) + item.price * item.qty;
      }
      if (!items.length) return 0;

      const createdAt = localIso();
      const order = { id: shortId(), number: 0, ...(key ? { key } : {}), createdAt, status: "new", name, phone, items, totals, ...filled(cleanBuyer(payload, false)) };
      try {
        return transaction(db, () => {
          const same = key ? savedNumberForKey(db, key) : 0;
          if (same) return same;
          // A number given to an order in the rescue file is not in the database yet, but the buyer already has it.
          const number = Math.max(nextOrderNumber(db), lastIssued + 1);
          insertOrder(db, { ...order, number });
          setLastOrderNumber(db, number);
          order.number = number;
          // The order matters more than the client card: a failed client update must not cost the order.
          try {
            mergeClient(db, name, phone, createdAt);
          } catch (error) {
            logger.error("client save failed", { message: error.message });
          }
          lastIssued = Math.max(lastIssued, order.number);
          return order.number;
        });
      } catch (error) {
        return rescue(order, error);
      }
    },

    // Taking an order into work (or straight to done) takes its pieces; cancelling it or moving it back to new gives them back.
    // New orders saved before this rule already hold pieces, so cancel always gives back whatever a line took.
    async setStatus(payload) {
      const status = String(payload?.status ?? "");
      if (!STATUSES.includes(status)) return false;
      return transaction(db, () => {
        const order = db.prepare("SELECT status, items FROM orders WHERE id = ?").get(String(payload.id ?? ""));
        if (!order) return false;
        let items = readItems(order.items);
        // Unreadable lines cannot move stock; they are kept as they are for a repair from a backup.
        if (!items) {
          db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, String(payload.id));
          return true;
        }
        const held = HOLDS_STOCK.includes(order.status);
        if (!held && HOLDS_STOCK.includes(status)) items = takeStock(db, items);
        else if (status === "cancel" || (held && !HOLDS_STOCK.includes(status))) items = returnStock(db, items);
        // A new order is not checked against the stock yet, so a line that holds nothing must not read as "was not on hand".
        if (status === "new") items = items.map(({ fromStock, ...line }) => (fromStock > 0 ? { ...line, fromStock } : line));
        db.prepare("UPDATE orders SET status = ?, items = ? WHERE id = ?").run(status, JSON.stringify(items), String(payload.id));
        return true;
      });
    },

    // Deleting an order that was never carried out gives its pieces back; a done order was sold, a cancelled one gave them back already.
    async remove(payload) {
      return transaction(db, () => {
        const order = db.prepare("SELECT number, key, status, items FROM orders WHERE id = ?").get(String(payload?.id ?? ""));
        if (!order) return false;
        const items = readItems(order.items);
        if (items && (order.status === "new" || order.status === "work")) returnStock(db, items);
        db.prepare("DELETE FROM orders WHERE id = ?").run(String(payload.id));
        if (order.key) db.prepare("INSERT OR IGNORE INTO deleted_orders (key, number, deleted_at) VALUES (?, ?, ?)").run(order.key, order.number, localIso());
        return true;
      });
    }
  };
}
