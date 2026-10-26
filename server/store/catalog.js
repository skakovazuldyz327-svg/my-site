import { silentLogger } from "../log.js";
import { parseColumn, transaction } from "./db.js";
import { allStock, MAX_STOCK, stockOf, withStock, writeStock } from "./stock.js";

const PRODUCT_ID = /^[\w-]{1,60}$/;
const CURRENCIES = ["KZT", "USD", "RUB"];
const MAX_PRICE = 1e9;

class Refused extends Error {}

const texts = (value) => (Array.isArray(value) ? value : []).map((entry) => String(entry ?? "").trim()).filter(Boolean);
const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// null: the product is not counted. undefined: the counts are broken.
function cleanStock(stock, sizes) {
  if (stock === null || stock === undefined) return null;
  if (!isRecord(stock)) return undefined;
  const counted = {};
  for (const size of sizes.length ? sizes : [""]) {
    const qty = Number(stock[size] ?? 0);
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_STOCK) return undefined;
    counted[size] = qty;
  }
  return counted;
}

// The admin page checks the same rules; the server repeats them so a stale or hand-made request cannot store a broken product.
// "In stock" is always stored as true/false: the shop, the admin list and the consultant read a missing value as "to order",
// while the editor showed it as "in stock". A counted product is in stock while any size has a piece left.
export function cleanProduct(product) {
  if (!isRecord(product)) return null;
  if (typeof product.id !== "string" || !PRODUCT_ID.test(product.id)) return null;
  const name = String(product.name ?? "").trim();
  const price = Number(product.price);
  const oldPrice = product.oldPrice === null || product.oldPrice === undefined || product.oldPrice === "" ? null : Number(product.oldPrice);
  if (!name || !Number.isFinite(price) || price <= 0 || price > MAX_PRICE) return null;
  if (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice <= price || oldPrice > MAX_PRICE)) return null;
  const sizes = [...new Set(texts(product.sizes))];
  const stock = cleanStock(product.stock, sizes);
  if (stock === undefined) return null;
  const images = texts(product.images);
  return {
    ...product,
    name,
    category: String(product.category ?? "").trim(),
    price,
    oldPrice,
    currency: CURRENCIES.includes(product.currency) ? product.currency : "KZT",
    description: String(product.description ?? "").trim(),
    sizes,
    specs: texts(product.specs),
    image: images[0] || String(product.image ?? "").trim(),
    images,
    inStock: stock ? Object.values(stock).some((qty) => qty > 0) : product.inStock !== false,
    stock
  };
}

const COMPANY_TEXTS = { company_name: 120, bank_name: 120, company_address: 200, company_phone: 40 };
// BIN/IIN is 12 digits, an IIK is KZ and 18 more characters, a bank's BIK is 8 Latin letters or digits, Kbe two digits.
const COMPANY_CODES = { bin_iin: /^\d{12}$/, iik: /^KZ[0-9A-Z]{18}$/, bik: /^[0-9A-Z]{8}$/, kbe: /^\d{2}$/ };
export const DEFAULT_VAT_RATE = 12;

// The seller's details for the invoice. Codes are kept without spaces and in capitals; an empty field stays empty,
// so the invoice can tell the admin has not filled it in yet.
export function cleanCompany(payload) {
  if (!isRecord(payload)) return null;
  const company = {};
  for (const [field, max] of Object.entries(COMPANY_TEXTS)) {
    company[field] = String(payload[field] ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  }
  for (const [field, pattern] of Object.entries(COMPANY_CODES)) {
    const code = String(payload[field] ?? "").replace(/\s/g, "").toUpperCase();
    if (code && !pattern.test(code)) return null;
    company[field] = code;
  }
  company.is_vat_payer = payload.is_vat_payer === true;
  const given = payload.vat_rate;
  const rate = given === undefined || given === null || given === "" ? DEFAULT_VAT_RATE : Number(given);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 30) return null;
  company.vat_rate = Math.round(rate * 100) / 100;
  return company;
}

// What the admin edits by hand: the counts (and the "in stock" they give) also move with every order.
function editable(product) {
  if (!product) return null;
  const { stock, ...rest } = product;
  if (stock) delete rest.inStock;
  return rest;
}

// A product is kept as the JSON the admin page sent, so new editor fields need no schema change.
export function insertProduct(db, product, position) {
  db.prepare("INSERT INTO products (id, position, data) VALUES (?, ?, ?)").run(product.id, position, JSON.stringify(product));
}

// The same check the shop pages make before showing the address.
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function saveSetting(db, key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

export function createCatalog(db, logger = silentLogger) {
  const settingRows = db.prepare("SELECT key, value FROM settings ORDER BY rowid");
  const productRows = db.prepare("SELECT id, data FROM products ORDER BY position, rowid");
  const productRow = db.prepare("SELECT data FROM products WHERE id = ?");
  let reported = "";

  // A damaged row (hand edit, disk error) is left out instead of taking the shop pages down. It is neither shown nor editable,
  // so damaged lists it for the admin page and the log; the fix is a restore from db/backups.
  function current() {
    const settings = {};
    const damaged = [];
    for (const row of settingRows.all()) {
      const value = parseColumn(row.value, () => true);
      if (value !== undefined) settings[row.key] = value;
      else damaged.push({ kind: "setting", id: String(row.key) });
    }
    const stock = allStock(db);
    const products = [];
    for (const row of productRows.all()) {
      const product = parseColumn(row.data, (value) => isRecord(value) && typeof value.id === "string");
      if (product) products.push(withStock(product, stock.get(product.id)));
      else damaged.push({ kind: "product", id: String(row.id) });
    }
    // The catalog is read on every page view: the same damage is logged once, not on each visit.
    const key = JSON.stringify(damaged);
    if (damaged.length && key !== reported) logger.error("damaged rows were left out of the catalog - restore the database from db/backups", { rows: damaged });
    reported = key;
    return damaged.length ? { settings, products, damaged } : { settings, products };
  }

  // Visitors see whether a size is on hand, not how many pieces are left.
  function forVisitors({ damaged, ...catalog }) {
    const products = catalog.products.map((product) =>
      product.stock ? { ...product, stock: Object.fromEntries(Object.entries(product.stock).map(([size, qty]) => [size, qty > 0 ? 1 : 0])) } : product
    );
    return { ...catalog, products };
  }

  // Each admin action changes one thing in one transaction, so two open admin pages cannot erase each other's work.
  // apply() returns an error code to refuse the change.
  function change(apply) {
    try {
      transaction(db, () => {
        const error = apply();
        if (error) throw new Refused(error);
      });
      return { ok: true, catalog: current() };
    } catch (error) {
      if (error instanceof Refused) return { ok: false, error: error.message, catalog: current() };
      throw error;
    }
  }

  return {
    read: async () => current(),

    shown: async () => forVisitors(current()),

    // The shop pages load the catalog as a script; built from the database on every request, it is never behind.
    page: async () => `window.SITE_DATA = ${JSON.stringify(forVisitors(current()), null, 2)};\n`,

    // base is the product as the admin page last saw it (null for a new one); anything else means another page changed it meanwhile.
    // stockBase is the counts the editor started from: the admin's change is added to what is on hand now, so orders
    // that took pieces while the editor was open are not undone.
    async saveProduct(payload) {
      const product = cleanProduct(payload?.product);
      if (!product) return { ok: false, error: "invalid", catalog: current() };
      const stockBase = payload.stockBase !== undefined ? payload.stockBase : payload.base?.stock;
      return change(() => {
        const row = productRow.get(product.id);
        const stored = row ? parseColumn(row.data, isRecord) : undefined;
        const saved = stored ? withStock(stored, stockOf(db, product.id)) : null;
        if (JSON.stringify(editable(saved)) !== JSON.stringify(editable(payload.base ?? null))) return "conflict";
        const { stock, ...data } = product;
        let counted = null;
        if (stock) {
          counted = {};
          for (const [size, qty] of Object.entries(stock)) {
            const now = saved?.stock?.[size];
            const was = isRecord(stockBase) ? Number(stockBase[size]) : Number.NaN;
            counted[size] = now !== undefined && Number.isInteger(was) ? Math.min(MAX_STOCK, Math.max(0, now + qty - was)) : qty;
          }
          data.inStock = Object.values(counted).some((qty) => qty > 0);
        }
        if (row) db.prepare("UPDATE products SET data = ? WHERE id = ?").run(JSON.stringify(data), product.id);
        else insertProduct(db, data, db.prepare("SELECT COALESCE(MIN(position), 0) - 1 AS first FROM products").get().first);
        writeStock(db, product.id, counted);
        return "";
      });
    },

    async removeProduct(payload) {
      const id = String(payload?.id ?? "");
      return change(() => {
        db.prepare("DELETE FROM products WHERE id = ?").run(id);
        writeStock(db, id, null);
        return "";
      });
    },

    // email is optional: "" removes it from the site; a request without the field keeps the saved one.
    async saveSettings(payload) {
      let whatsapp = String(payload?.whatsapp ?? "").replace(/\D/g, "");
      if (whatsapp.length === 11 && whatsapp.startsWith("8")) whatsapp = `7${whatsapp.slice(1)}`;
      if (whatsapp.length < 10 || whatsapp.length > 15) return { ok: false, error: "invalid" };
      const email = payload.email === undefined ? undefined : String(payload.email ?? "").trim();
      if (email && (email.length > 120 || !EMAIL.test(email))) return { ok: false, error: "invalid" };
      return change(() => {
        saveSetting(db, "whatsapp", whatsapp);
        if (email !== undefined) saveSetting(db, "email", email);
        return "";
      });
    },

    // The details are printed on invoices the shop page hands to buyers, so they are public like the rest of the settings.
    async saveCompany(payload) {
      const company = cleanCompany(payload?.company);
      if (!company) return { ok: false, error: "invalid" };
      return change(() => {
        saveSetting(db, "company", company);
        return "";
      });
    }
  };
}
