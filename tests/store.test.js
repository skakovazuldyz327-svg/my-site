import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";
import { after, test } from "node:test";
import { localIso, readdirOrEmpty, statOrMissing } from "../server/store/files.js";
import { createStore } from "../server/store/index.js";
import { LegacyFileError } from "../server/store/legacy.js";
import { CounterUnreadableError, listBackups, restoreBackup } from "../server/store/restore.js";
import { tempSite } from "./helpers.js";

const site = tempSite();
const store = createStore(site.config);
after(() => {
  store.close();
  site.cleanup();
});

const order = (extra = {}) => ({ name: "Айгуль", phone: "8 777 123 45 67", items: [{ id: "pmuwtba7c", size: "160×200", qty: 2 }], ...extra });
const today = () => {
  const day = new Date();
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};

function withSite(prepare, task) {
  const other = tempSite();
  mkdirSync(other.config.paths.db, { recursive: true });
  prepare?.(other);
  return Promise.resolve()
    .then(() => task(other))
    .finally(other.cleanup);
}

const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value), "utf8");

test("the catalog of the old version is moved into the database and products.json is set aside", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/products.json", import.meta.url), "utf8"));
  const catalog = await store.catalog.read();
  assert.deepEqual(catalog.products, fixture.products);
  assert.deepEqual(catalog.settings, fixture.settings);
  assert.equal(existsSync(site.config.paths.legacy.catalog), false);
  const [stamp] = readdirSync(site.config.paths.legacyArchive);
  assert.ok(existsSync(join(site.config.paths.legacyArchive, stamp, "products.json")));
});

test("an order is validated against the catalog and priced on the server", async () => {
  const number = await store.orders.add(order({ items: [{ id: "pmuwtba7c", size: "999×999", qty: "50" }, { id: "nope", qty: 1 }] }));
  assert.equal(number, 1);
  const [saved] = await store.orders.read();
  assert.equal(saved.items.length, 1);
  assert.equal(saved.items[0].size, "999×999");
  assert.equal(saved.items[0].sizeRemoved, true);
  assert.equal(saved.items[0].qty, 20);
  assert.equal(saved.totals.KZT, saved.items[0].price * 20);
  assert.match(saved.createdAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}[+-]\d\d:\d\d$/);
});

test("a price the visitor saw before the admin changed it is kept next to the catalog price", async () => {
  const before = (await store.orders.read()).length;
  const [product] = (await store.catalog.read()).products;
  await store.orders.add(order({ items: [{ id: product.id, size: "160×200", qty: 1, price: product.price, currency: product.currency }] }));
  await store.orders.add(order({ items: [{ id: product.id, size: "160×200", qty: 1, price: product.price - 100, currency: product.currency }] }));
  const longSize = "Евро  макси с бортиком и съёмным чехлом, 200×220";
  await store.catalog.saveProduct({ product: { ...product, sizes: [...product.sizes, longSize] }, base: product });
  await store.orders.add(order({ items: [{ id: product.id, size: ` ${longSize} `, qty: 1, price: product.price }] }));
  const [same, changed, long] = (await store.orders.read()).slice(before);
  assert.equal(long.items[0].size, longSize);
  assert.equal("sizeRemoved" in long.items[0], false);
  const edited = (await store.catalog.read()).products[0];
  await store.catalog.saveProduct({ product: { ...edited, sizes: product.sizes }, base: edited });
  assert.equal("seenPrice" in same.items[0], false);
  assert.equal("sizeRemoved" in same.items[0], false);
  assert.equal(changed.items[0].price, product.price);
  assert.equal(changed.items[0].seenPrice, product.price - 100);
  assert.equal(changed.totals.KZT, product.price);
  await Promise.all((await store.orders.read()).slice(before).map((entry) => store.orders.remove({ id: entry.id })));
});

test("bad orders are rejected", async () => {
  assert.equal(await store.orders.add(order({ name: "A" })), 0);
  assert.equal(await store.orders.add(order({ phone: "123" })), 0);
  assert.equal(await store.orders.add(order({ items: [{ id: "nope" }] })), 0);
  assert.equal(await store.orders.add(null), 0);
});

test("damaged catalog rows are listed for the admin and logged once, but not shown to visitors", () =>
  withSite(null, async (other) => {
    const errors = [];
    const logger = { info() {}, warn() {}, error: (message, data) => errors.push({ message, data }) };
    const shop = createStore(other.config, logger);
    try {
      const [first, second] = (await shop.catalog.read()).products;
      assert.equal("damaged" in (await shop.catalog.read()), false);
      shop.db.prepare("UPDATE products SET data = '{broken' WHERE id = ?").run(first.id);
      shop.db.prepare("UPDATE settings SET value = '{broken' WHERE key = 'whatsapp'").run();
      const catalog = await shop.catalog.read();
      assert.deepEqual(catalog.damaged, [{ kind: "setting", id: "whatsapp" }, { kind: "product", id: first.id }]);
      assert.equal(catalog.products[0].id, second.id);
      assert.equal("whatsapp" in catalog.settings, false);
      await shop.catalog.read();
      assert.equal("damaged" in (await shop.catalog.shown()), false);
      assert.doesNotMatch(await shop.catalog.page(), /damaged/);
      const logged = errors.filter((entry) => entry.message.startsWith("damaged rows"));
      assert.equal(logged.length, 1);
      assert.deepEqual(logged[0].data.rows, catalog.damaged);
      shop.db.prepare("UPDATE products SET data = ? WHERE id = ?").run(JSON.stringify(first), first.id);
      shop.db.prepare("UPDATE settings SET value = ? WHERE key = 'whatsapp'").run(JSON.stringify("77001234567"));
      assert.equal("damaged" in (await shop.catalog.read()), false);
    } finally {
      shop.close();
    }
  }));

test("a refused order is logged with the reason and the buyer's details", () =>
  withSite(null, async (other) => {
    const warnings = [];
    const logger = { info() {}, error() {}, warn: (message, data) => warnings.push({ message, data }) };
    const shop = createStore(other.config, logger);
    try {
      await shop.orders.add(order({ name: "A" }));
      await shop.orders.add(order({ phone: "123" }));
      await shop.orders.add(order({ items: [{ id: "nope", size: "90×200", qty: 1 }] }));
      await shop.orders.add(null);
      const refused = warnings.filter((entry) => entry.message === "an order was refused");
      assert.deepEqual(refused.map((entry) => entry.data.reason), ["name", "phone", "items", "payload"]);
      assert.equal(refused[1].data.name, "Айгуль");
      assert.equal(refused[1].data.phone, "123");
      assert.deepEqual(refused[2].data.items, [{ id: "nope", name: "", size: "90×200", qty: "1" }]);
      assert.equal(await shop.orders.add(order()), 1);
    } finally {
      shop.close();
    }
  }));

test("parallel orders get unique, increasing numbers", async () => {
  const numbers = await Promise.all(Array.from({ length: 15 }, () => store.orders.add(order())));
  assert.equal(new Set(numbers).size, 15);
  assert.equal((await store.orders.read()).length, 16);
});

test("deleted orders do not free their numbers", async () => {
  const orders = await store.orders.read();
  const last = orders.reduce((max, entry) => (entry.number > max.number ? entry : max));
  assert.ok(await store.orders.remove({ id: last.id }));
  assert.equal(await store.orders.add(order()), last.number + 1);
});

test("status changes accept only known statuses", async () => {
  const [first] = await store.orders.read();
  assert.equal(await store.orders.setStatus({ id: first.id, status: "weird" }), false);
  assert.equal(await store.orders.setStatus({ id: first.id, status: "done" }), true);
  assert.equal((await store.orders.read())[0].status, "done");
});

test("clients are merged by normalized phone and can be hidden", async () => {
  const clients = await store.clients.read();
  assert.equal(clients.length, 1);
  assert.equal(clients[0].phone, "77771234567");
  assert.ok(await store.clients.setHidden({ id: clients[0].id, hidden: true }));
  assert.equal((await store.clients.read())[0].hidden, true);
  await store.orders.add(order());
  assert.equal((await store.clients.read())[0].hidden, false);
  assert.equal(await store.clients.setHidden({ id: "nobody", hidden: true }), false);
});

test("dates keep the PowerShell format so string comparison stays valid", () => {
  const earlier = localIso(new Date(2026, 0, 1, 9, 5, 7, 12));
  const later = localIso(new Date(2026, 0, 1, 10, 0, 0, 0));
  assert.ok(later > earlier);
});

test("a product edit changes only that product and the shop script is built from the database", async () => {
  assert.equal((await store.catalog.saveProduct({ product: { id: "../x", name: "a" }, base: null })).ok, false);
  assert.equal((await store.catalog.saveProduct({ product: { id: "p1", name: " " }, base: null })).ok, false);
  const { products } = await store.catalog.read();
  const base = structuredClone(products[0]);
  const result = await store.catalog.saveProduct({ product: { ...base, price: 123 }, base });
  assert.equal(result.ok, true);
  assert.equal((await store.catalog.read()).products[0].price, 123);
  assert.equal((await store.catalog.read()).products.length, products.length);
  const page = await store.catalog.page();
  assert.match(page, /^window\.SITE_DATA = \{/);
  assert.equal(JSON.parse(page.slice("window.SITE_DATA = ".length, -2)).products[0].price, 123);
});

test("two admin windows do not erase each other's catalog changes", async () => {
  const windowA = structuredClone(await store.catalog.read());
  const windowB = structuredClone(await store.catalog.read());
  const added = { id: "pnew", name: "Новый товар", price: 1000, currency: "KZT", sizes: [], images: [], inStock: true };
  assert.equal((await store.catalog.saveProduct({ product: added, base: null })).ok, true);
  const [first, second] = windowB.products;
  assert.equal((await store.catalog.saveProduct({ product: { ...second, price: 777 }, base: second })).ok, true);
  assert.equal((await store.catalog.removeProduct({ id: windowA.products.at(-1).id })).ok, true);
  assert.equal((await store.catalog.saveSettings({ whatsapp: "8 777 000 11 22" })).ok, true);
  const now = await store.catalog.read();
  assert.equal(now.products[0].id, "pnew");
  assert.equal(now.products.find((product) => product.id === second.id).price, 777);
  assert.equal(now.products.length, windowA.products.length);
  assert.equal(now.settings.whatsapp, "77770001122");
  assert.equal(now.settings.email, undefined);

  assert.equal((await store.catalog.saveSettings({ whatsapp: "77770001122", email: "not an address" })).ok, false);
  assert.equal((await store.catalog.saveSettings({ whatsapp: "77770001122", email: " shop@mail.kz " })).catalog.settings.email, "shop@mail.kz");
  assert.equal((await store.catalog.saveSettings({ whatsapp: "77770001123" })).catalog.settings.email, "shop@mail.kz");
  assert.equal((await store.catalog.saveSettings({ whatsapp: "77770001122", email: "" })).catalog.settings.email, "");

  const stale = await store.catalog.saveProduct({ product: { ...first, price: 5 }, base: { ...first, price: -1 } });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, "conflict");
  assert.ok(stale.catalog.products.some((product) => product.id === "pnew"));
});

test("daily backup is a full database copy, taken once per day", async () => {
  await store.backups.daily();
  const file = join(site.config.paths.backups, today(), "zhuldyz.sqlite");
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(copy.prepare("SELECT COUNT(*) AS count FROM orders").get().count, (await store.orders.read()).length);
  } finally {
    copy.close();
  }
  await store.orders.add(order());
  await store.backups.daily();
  const again = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(again.prepare("SELECT COUNT(*) AS count FROM orders").get().count, (await store.orders.read()).length - 1);
  } finally {
    again.close();
  }
});

test("a copy outside the site folder holds a fresh database and every photo; older days are dropped, photos are kept", () =>
  withSite(null, async (other) => {
    const outside = join(other.root, "OneDrive", "Zhuldyz-backups");
    const count = (file) => {
      const copy = new DatabaseSync(file, { readOnly: true });
      try {
        assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
        return copy.prepare("SELECT COUNT(*) AS count FROM orders").get().count;
      } finally {
        copy.close();
      }
    };
    writeFileSync(join(other.config.paths.uploads, "a.jpg"), "photo");
    const shop = createStore(other.config);
    try {
      assert.equal(await shop.backups.offsite(), null);
      other.config.backupCopyDir = outside;
      other.config.backupDays = 2;
      await shop.orders.add(order());
      const first = await shop.backups.offsite();
      assert.equal(first.photos, 1);
      assert.equal(count(first.file), 1);
      assert.equal(readFileSync(join(outside, "images", "products", "a.jpg"), "utf8"), "photo");

      await shop.orders.add(order());
      for (const day of ["2020-01-01", "2020-01-02"]) writeFileSync(join(outside, "db", `zhuldyz-${day}.sqlite`), "");
      rmSync(join(other.config.paths.uploads, "a.jpg"));
      const second = await shop.backups.offsite();
      assert.equal(second.file, first.file);
      assert.equal(second.photos, 0);
      assert.equal(count(second.file), 2);
      assert.deepEqual(readdirSync(join(outside, "db")).sort(), ["zhuldyz-2020-01-02.sqlite", first.file.split(/[\\/]/).pop()]);
      assert.ok(existsSync(join(outside, "images", "products", "a.jpg")));
    } finally {
      shop.close();
    }
  }));

test("backup zip holds the database, readable JSON exports and the photos", async () => {
  writeFileSync(join(site.config.paths.uploads, "фото.jpg"), "jpeg-bytes");
  const zip = await store.backups.zip();
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLength = zip.readUInt16LE(26);
  const packedSize = zip.readUInt32LE(18);
  assert.equal(zip.subarray(30, 30 + nameLength).toString("utf8"), "db/zhuldyz.sqlite");
  const database = inflateRawSync(zip.subarray(30 + nameLength, 30 + nameLength + packedSize));
  assert.equal(database.subarray(0, 15).toString(), "SQLite format 3");
  for (const name of ["export/products.json", "export/orders.json", "export/clients.json"]) assert.ok(zip.includes(Buffer.from(name)));
  const photoName = zip.indexOf(Buffer.from("images/products/фото.jpg", "utf8"));
  const photoHeader = photoName - 30;
  assert.equal(zip.readUInt32LE(photoHeader), 0x04034b50);
  assert.equal(zip.readUInt16LE(photoHeader + 8), 0);
  assert.equal(zip.subarray(photoName + zip.readUInt16LE(photoHeader + 26)).subarray(0, 10).toString(), "jpeg-bytes");
  assert.equal(readdirSync(site.config.paths.db).some((name) => name.startsWith("full-backup-")), false);
});

test("an order repeated with the same key is saved once", async () => {
  const key = "k-1234567890";
  const first = await store.orders.add(order({ key }));
  assert.equal(await store.orders.add(order({ key })), first);
  assert.equal((await store.orders.read()).filter((entry) => entry.key === key).length, 1);
});

test("a repeat of a deleted order does not bring it back", async () => {
  const key = "k-deleted-0001";
  const number = await store.orders.add(order({ key }));
  const saved = (await store.orders.read()).find((entry) => entry.key === key);
  assert.ok(await store.orders.remove({ id: saved.id }));
  assert.equal(await store.orders.add(order({ key })), number);
  assert.equal((await store.orders.read()).some((entry) => entry.key === key), false);
});

test("an order for a product removed meanwhile is kept as the visitor saw it", async () => {
  const number = await store.orders.add(order({ items: [{ id: "gone", name: "Снятый матрас", price: 5000, currency: "KZT", size: "90×200", qty: 2 }] }));
  const saved = (await store.orders.read()).find((entry) => entry.number === number);
  assert.deepEqual(saved.items, [{ id: "gone", name: "Снятый матрас", size: "90×200", qty: 2, price: 5000, currency: "KZT", removed: true }]);
  assert.equal(saved.totals.KZT, 10000);
});

test("the buyer's invoice details ride along with the order; a broken BIN is dropped, never the order", async () => {
  const number = await store.orders.add(order({ company: "  ТОО   «Ромашка» ", bin: "1234 5678 9012", address: "г. Алматы, ул. Абая 10" }));
  const saved = (await store.orders.read()).find((entry) => entry.number === number);
  assert.equal(saved.company, "ТОО «Ромашка»");
  assert.equal(saved.bin, "123456789012");
  assert.equal(saved.address, "г. Алматы, ул. Абая 10");

  const sloppy = await store.orders.add(order({ bin: "12345", company: "" }));
  const kept = (await store.orders.read()).find((entry) => entry.number === sloppy);
  assert.ok(kept);
  assert.equal("bin" in kept, false);
  assert.equal("company" in kept, false);

  const invoice = await store.orders.invoice(number);
  assert.deepEqual(Object.keys(invoice).sort(), ["address", "bin", "company", "createdAt", "items", "name", "number", "phone"]);
  assert.equal(invoice.number, number);
  assert.deepEqual(Object.keys(invoice.items[0]).sort(), ["currency", "id", "name", "price", "qty", "size"]);
  assert.equal(await store.orders.invoice(999999), null);
});

test("the admin corrects the buyer's details; a broken BIN is refused and an empty field removes the detail", async () => {
  const number = await store.orders.add(order({ company: "ТОО «Ромашка»", address: "Абая 10" }));
  const { id } = (await store.orders.read()).find((entry) => entry.number === number);
  assert.equal(await store.orders.setBuyer({ id, company: "ИП «Ромашка»", bin: "123", address: "" }), false);
  assert.equal(await store.orders.setBuyer({ id: "nope", company: "x" }), false);
  assert.equal(await store.orders.setBuyer({ id, company: "ИП «Ромашка»", bin: "123456789012", address: "" }), true);
  const saved = (await store.orders.read()).find((entry) => entry.id === id);
  assert.equal(saved.company, "ИП «Ромашка»");
  assert.equal(saved.bin, "123456789012");
  assert.equal("address" in saved, false);
  assert.equal(saved.items.length, 1);
  assert.equal(saved.status, "new");
});

test("the seller's requisites are checked, normalised and saved with the settings", async () => {
  const company = {
    company_name: " ИП  «Жулдыз» ",
    bin_iin: "9001 0140 0123",
    iik: "kz12 722s 0000 1234 5678",
    bank_name: "АО «Kaspi Bank»",
    bik: "caspkzka",
    kbe: "19",
    company_address: "г. Алматы",
    company_phone: "+7 777 849 21 64",
    is_vat_payer: true,
    vat_rate: "12"
  };
  const result = await store.catalog.saveCompany({ company });
  assert.equal(result.ok, true);
  assert.deepEqual(result.catalog.settings.company, {
    company_name: "ИП «Жулдыз»",
    bank_name: "АО «Kaspi Bank»",
    company_address: "г. Алматы",
    company_phone: "+7 777 849 21 64",
    bin_iin: "900101400123",
    iik: "KZ12722S000012345678",
    bik: "CASPKZKA",
    kbe: "19",
    is_vat_payer: true,
    vat_rate: 12
  });
  assert.match(await store.catalog.page(), /"bin_iin": "900101400123"/);

  for (const broken of [{ bin_iin: "123" }, { iik: "KZ123" }, { iik: "RU12722S000012345678" }, { bik: "CASP" }, { kbe: "1" }, { vat_rate: 0 }, { vat_rate: 50 }, { vat_rate: "abc" }]) {
    assert.equal((await store.catalog.saveCompany({ company: { ...company, ...broken } })).ok, false, JSON.stringify(broken));
  }
  assert.equal((await store.catalog.saveCompany({ company: null })).ok, false);
  assert.equal((await store.catalog.read()).settings.company.bin_iin, "900101400123");

  const empty = await store.catalog.saveCompany({ company: { is_vat_payer: "yes" } });
  assert.equal(empty.ok, true);
  assert.equal(empty.catalog.settings.company.bin_iin, "");
  assert.equal(empty.catalog.settings.company.is_vat_payer, false);
  assert.equal(empty.catalog.settings.company.vat_rate, 12);
});

test("everything survives a restart", () =>
  withSite(null, async (other) => {
    const first = createStore(other.config);
    const number = await first.orders.add(order({ key: "k-restart-0001" }));
    const [client] = await first.clients.read();
    await first.clients.setHidden({ id: client.id, hidden: true });
    const { products } = await first.catalog.read();
    await first.catalog.saveProduct({ product: { ...products[1], price: 4321 }, base: products[1] });
    await first.orders.remove({ id: (await first.orders.read())[0].id });
    first.close();

    const second = createStore(other.config);
    try {
      assert.deepEqual(await second.orders.read(), []);
      assert.equal(await second.orders.add(order({ key: "k-restart-0001" })), number);
      assert.equal(await second.orders.add(order()), number + 1);
      assert.equal((await second.clients.read())[0].hidden, false);
      const catalog = await second.catalog.read();
      assert.equal(catalog.products[1].price, 4321);
      assert.equal(catalog.products.length, products.length);
    } finally {
      second.close();
    }
  }));

test("all data of the old version is moved into the database: numbers, counter, clients, tombstones, chat files", () =>
  withSite((other) => {
    const { legacy } = other.config.paths;
    writeJson(legacy.orders, [
      { id: "o1", number: 8, key: "k-aaaa-0001", createdAt: "2026-01-01T10:00:00.0000000+05:00", status: "done", name: "Айгуль", phone: "8 777 123 45 67", items: [], totals: { KZT: 100 }, note: "позвонить" },
      { id: "o2", number: 9, createdAt: "2026-01-02T10:00:00.0000000+05:00", status: "new", name: "Ерлан", phone: "+7 701 555 22 11", items: [], totals: {} },
      { id: "o2", number: 9, name: "Ерлан", phone: "+7 701 555 22 11" },
      { id: "o3", number: 9, createdAt: "2026-01-03T10:00:00.0000000+05:00", name: "Дана", phone: "87005554433", items: [], totals: {} }
    ]);
    writeJson(legacy.deletedOrders, [{ key: "k-gone-0001", number: 5 }]);
    writeFileSync(legacy.lastNumber, "12");
    writeFileSync(legacy.clients, "{");
    writeJson(`${legacy.clients}.bak`, [{ id: "c1", name: "Айгуль", phone: "77771234567", createdAt: "2025-12-01T10:00:00.0000000+05:00", lastOrderAt: "2026-01-01T10:00:00.0000000+05:00", hidden: true, vip: 1 }]);
    writeJson(legacy.chatFilesIndex, [{ id: "f1", name: "анализ.pdf", type: "application/pdf", size: 3, session: "s1", text: "текст", createdAt: localIso(), time: Date.now() }]);
  }, async (other) => {
    const moved = createStore(other.config);
    try {
      const orders = await moved.orders.read();
      assert.deepEqual(orders.map((entry) => [entry.id, entry.number]), [["o1", 8], ["o2", 9], ["o3", 13]]);
      assert.equal(orders[0].note, "позвонить");
      assert.equal(orders[0].status, "done");
      assert.equal(await moved.orders.add(order()), 14);
      assert.equal(await moved.orders.add(order({ key: "k-gone-0001" })), 5);
      assert.equal(await moved.orders.add(order({ key: "k-aaaa-0001" })), 8);

      const clients = await moved.clients.read();
      const aigul = clients.find((client) => client.id === "c1");
      assert.equal(aigul.vip, 1);
      assert.equal(aigul.createdAt, "2025-12-01T10:00:00.0000000+05:00");
      assert.deepEqual(clients.map((client) => client.phone).sort(), ["77005554433", "77015552211", "77771234567"]);

      assert.equal((await moved.chatFiles.find("f1")).entry.name, "анализ.pdf");
      assert.equal((await moved.catalog.read()).products.length > 0, true);

      const [stamp] = readdirSync(other.config.paths.legacyArchive);
      const archived = readdirSync(join(other.config.paths.legacyArchive, stamp)).sort();
      assert.deepEqual(archived, ["chat-files.json", "clients.json", "clients.json.bak", "deleted-orders.json", "last-order-number.txt", "orders.json", "products.json"]);
    } finally {
      moved.close();
    }
  }));

test("a damaged old file without a readable copy stops the start and imports nothing", () =>
  withSite((other) => {
    writeJson(other.config.paths.legacy.orders, [{ id: "o1", number: 1, name: "Айгуль", phone: "87771234567" }]);
    writeFileSync(other.config.paths.legacy.clients, "");
  }, async (other) => {
    assert.throws(() => createStore(other.config), LegacyFileError);
    assert.ok(existsSync(other.config.paths.legacy.orders));
    writeJson(other.config.paths.legacy.clients, []);
    const fixed = createStore(other.config);
    try {
      assert.equal((await fixed.orders.read()).length, 1);
      assert.equal(existsSync(other.config.paths.legacy.orders), false);
    } finally {
      fixed.close();
    }
  }));

test("an order the database refused is kept in the rescue file and moved in on the next start", () =>
  withSite(null, async (other) => {
    const first = createStore(other.config);
    const saved = await first.orders.add(order());
    first.db.close();
    const rescued = await first.orders.add(order({ name: "Ерлан", phone: "+7 701 555 22 11" }));
    assert.equal(rescued, saved + 1);
    const line = JSON.parse(readFileSync(other.config.paths.ordersRescue, "utf8").trim());
    assert.equal(line.name, "Ерлан");

    const second = createStore(other.config);
    try {
      const orders = await second.orders.read();
      assert.deepEqual(orders.map((entry) => entry.number), [saved, rescued]);
      assert.ok((await second.clients.read()).some((client) => client.phone === "77015552211"));
      assert.equal(existsSync(other.config.paths.ordersRescue), false);
      assert.equal(await second.orders.add(order()), rescued + 1);
    } finally {
      second.close();
    }
  }));

test("after a brief refusal of the database the next order does not reuse the number of the rescued one", () =>
  withSite(null, async (other) => {
    const first = createStore(other.config);
    const saved = await first.orders.add(order());
    first.db.exec("CREATE TRIGGER refuse BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END;");
    const rescued = await first.orders.add(order({ name: "Ерлан", phone: "+7 701 555 22 11" }));
    first.db.exec("DROP TRIGGER refuse");
    const next = await first.orders.add(order({ name: "Дина", phone: "+7 702 555 33 44" }));
    assert.deepEqual([saved, rescued, next], [saved, saved + 1, saved + 2]);
    first.close();

    const second = createStore(other.config);
    try {
      const orders = await second.orders.read();
      assert.deepEqual(orders.map((entry) => [entry.number, entry.name]), [[saved, "Айгуль"], [rescued, "Ерлан"], [next, "Дина"]]);
      assert.equal(await second.orders.add(order()), next + 1);
    } finally {
      second.close();
    }
  }));

test("a product edit with stock status is stored exactly, survives a restart and reaches the shop script", () =>
  withSite(null, async (other) => {
    const first = createStore(other.config);
    const { products } = await first.catalog.read();
    const base = products.find((product) => product.inStock);
    const edited = {
      ...base,
      name: "  Матрас «Баланс Плюс»  ",
      category: "Матрасы",
      price: 205000,
      oldPrice: 230000,
      currency: "KZT",
      description: "Новое описание",
      sizes: ["90×200", " 200×200 ", ""],
      specs: ["Жёсткость: высокая", ""],
      image: base.images[1],
      images: [base.images[1], base.images[0]],
      inStock: false
    };
    const saved = await first.catalog.saveProduct({ product: edited, base });
    assert.equal(saved.ok, true);
    const expected = { ...edited, name: "Матрас «Баланс Плюс»", sizes: ["90×200", "200×200"], specs: ["Жёсткость: высокая"] };
    assert.deepEqual(saved.catalog.products.find((product) => product.id === base.id), expected);

    const back = await first.catalog.saveProduct({ product: { ...expected, inStock: true }, base: expected });
    assert.equal(back.ok, true);
    const again = back.catalog.products.find((product) => product.id === base.id);
    assert.equal((await first.catalog.saveProduct({ product: { ...again, inStock: false }, base: again })).ok, true);
    first.close();

    const second = createStore(other.config);
    try {
      const product = (await second.catalog.read()).products.find((entry) => entry.id === base.id);
      assert.deepEqual(product, expected);
      assert.equal(products.findIndex((entry) => entry.id === base.id), (await second.catalog.read()).products.findIndex((entry) => entry.id === base.id));
      const page = JSON.parse((await second.catalog.page()).slice("window.SITE_DATA = ".length, -2));
      assert.equal(page.products.find((entry) => entry.id === base.id).inStock, false);
    } finally {
      second.close();
    }
  }));

test("a product with a broken price is refused and a missing stock mark is stored as in stock", async () => {
  const { products } = await store.catalog.read();
  const base = products.at(-1);
  for (const bad of [{ price: 0 }, { price: "abc" }, { price: -5 }, { oldPrice: base.price }, { oldPrice: "x" }, { name: "" }]) {
    const result = await store.catalog.saveProduct({ product: { ...base, ...bad }, base });
    assert.equal(result.ok, false, JSON.stringify(bad));
    assert.equal(result.error, "invalid");
  }
  assert.deepEqual((await store.catalog.read()).products.at(-1), base);
  const added = { id: "pstock", name: "Подушка", price: "4500", sizes: [], images: [] };
  const result = await store.catalog.saveProduct({ product: added, base: null });
  assert.equal(result.ok, true);
  const saved = result.catalog.products.find((product) => product.id === "pstock");
  assert.equal(saved.inStock, true);
  assert.equal(saved.price, 4500);
  assert.equal(saved.currency, "KZT");
  assert.equal(saved.oldPrice, null);
});

test("counted stock: an order takes pieces when taken into work, a shortage is made to order, cancel and delete give them back", () =>
  withSite(null, async (other) => {
    const shop = createStore(other.config);
    try {
      const id = "pmuwtba7c";
      const stockNow = async () => (await shop.catalog.read()).products.find((product) => product.id === id);
      const base = await stockNow();
      const counted = await shop.catalog.saveProduct({ product: { ...base, stock: { "160×200": 3, "180×200": 0 } }, base });
      assert.equal(counted.ok, true);
      assert.deepEqual((await stockNow()).stock, { "90×200": 0, "160×200": 3, "180×200": 0 });
      assert.equal((await stockNow()).inStock, true);

      const first = await shop.orders.add(order({ items: [{ id, size: "160×200", qty: 2 }] }));
      const second = await shop.orders.add(order({ items: [{ id, size: "160×200", qty: 3 }, { id, size: "180×200", qty: 1 }, { id, size: "", qty: 1 }] }));
      const byNumber = async (number) => (await shop.orders.read()).find((entry) => entry.number === number);
      const status = async (number, value) => assert.ok(await shop.orders.setStatus({ id: (await byNumber(number)).id, status: value }));
      assert.deepEqual((await byNumber(second)).items.map((item) => item.fromStock), [undefined, undefined, undefined]);
      assert.equal((await stockNow()).stock["160×200"], 3);

      await status(first, "work");
      assert.deepEqual((await byNumber(first)).items.map((item) => item.fromStock), [2]);
      await status(second, "done");
      assert.deepEqual((await byNumber(second)).items.map((item) => item.fromStock), [1, 0, undefined]);
      assert.deepEqual((await stockNow()).stock, { "90×200": 0, "160×200": 0, "180×200": 0 });
      assert.equal((await stockNow()).inStock, false);
      assert.match(await shop.catalog.page(), /"inStock": false/);

      await status(first, "cancel");
      assert.equal((await stockNow()).stock["160×200"], 2);
      assert.deepEqual((await byNumber(first)).items.map((item) => item.fromStock), [0]);
      await status(first, "cancel");
      assert.equal((await stockNow()).stock["160×200"], 2);
      await status(first, "new");
      assert.equal((await stockNow()).stock["160×200"], 2);
      assert.deepEqual((await byNumber(first)).items.map((item) => item.fromStock), [undefined]);
      await status(first, "work");
      assert.equal((await stockNow()).stock["160×200"], 0);
      assert.deepEqual((await byNumber(first)).items.map((item) => item.fromStock), [2]);
      await status(first, "done");
      assert.equal((await stockNow()).stock["160×200"], 0);
      await status(first, "new");
      assert.equal((await stockNow()).stock["160×200"], 2);
      assert.deepEqual((await byNumber(first)).items.map((item) => item.fromStock), [undefined]);
      await status(first, "work");

      assert.ok(await shop.orders.remove({ id: (await byNumber(second)).id }));
      assert.equal((await stockNow()).stock["160×200"], 0);
      assert.ok(await shop.orders.remove({ id: (await byNumber(first)).id }));
      assert.equal((await stockNow()).stock["160×200"], 2);

      const third = await shop.orders.add(order({ items: [{ id, size: "160×200", qty: 1 }] }));
      assert.ok(await shop.orders.setStatus({ id: (await byNumber(third)).id, status: "cancel" }));
      const tracked = await stockNow();
      assert.equal((await shop.catalog.saveProduct({ product: { ...tracked, stock: null, inStock: true }, base: tracked })).ok, true);
      assert.ok(await shop.orders.setStatus({ id: (await byNumber(third)).id, status: "work" }));
      assert.equal((await byNumber(third)).items[0].fromStock, undefined);
    } finally {
      shop.close();
    }
  }));

test("an admin stock change is added to what orders left, survives a restart and can be switched off", () =>
  withSite(null, async (other) => {
    const id = "pmuwtba7c";
    const first = createStore(other.config);
    const read = async (store) => (await store.catalog.read()).products.find((product) => product.id === id);
    const base = await read(first);
    await first.catalog.saveProduct({ product: { ...base, stock: { "90×200": 1, "160×200": 3, "180×200": 0 } }, base });
    const opened = await read(first);
    await first.orders.add(order({ items: [{ id, size: "160×200", qty: 1 }] }));
    const [taken] = await first.orders.read();
    assert.ok(await first.orders.setStatus({ id: taken.id, status: "work" }));
    const listed = await read(first);
    const saved = await first.catalog.saveProduct({ product: { ...opened, price: 199000, stock: { ...opened.stock, "160×200": 5 } }, base: listed, stockBase: opened.stock });
    assert.equal(saved.ok, true);
    assert.equal((await read(first)).stock["160×200"], 4);
    assert.equal((await read(first)).price, 199000);
    const broken = await first.catalog.saveProduct({ product: { ...(await read(first)), stock: { "160×200": -1 } }, base: await read(first) });
    assert.equal(broken.error, "invalid");
    first.close();

    const second = createStore(other.config);
    try {
      const after = await read(second);
      assert.deepEqual(after.stock, { "90×200": 1, "160×200": 4, "180×200": 0 });
      const off = await second.catalog.saveProduct({ product: { ...after, stock: null, inStock: false }, base: after });
      assert.equal(off.ok, true);
      const plain = await read(second);
      assert.equal(plain.stock, undefined);
      assert.equal(plain.inStock, false);
      const number = await second.orders.add(order({ items: [{ id, size: "160×200", qty: 1 }] }));
      assert.equal((await second.orders.read()).find((entry) => entry.number === number).items[0].fromStock, undefined);
      await second.catalog.removeProduct({ id });
      assert.equal(second.db.prepare("SELECT COUNT(*) AS count FROM stock").get().count, 0);
    } finally {
      second.close();
    }
  }));

test("a rescued order is moved in as new and takes its stock only when taken into work", () =>
  withSite(null, async (other) => {
    const id = "pmuwtba7c";
    const first = createStore(other.config);
    const base = (await first.catalog.read()).products.find((product) => product.id === id);
    await first.catalog.saveProduct({ product: { ...base, stock: { "160×200": 2 } }, base });
    first.db.close();
    await first.orders.add(order({ items: [{ id, size: "160×200", qty: 1 }] }));
    const second = createStore(other.config);
    const onHand = async () => (await second.catalog.read()).products.find((product) => product.id === id).stock["160×200"];
    try {
      const [rescued] = await second.orders.read();
      assert.equal(rescued.items[0].fromStock, undefined);
      assert.equal(await onHand(), 2);
      assert.ok(await second.orders.setStatus({ id: rescued.id, status: "work" }));
      assert.equal(await onHand(), 1);
    } finally {
      second.close();
    }
  }));

test("a flood of anonymous orders does not touch the stock", () =>
  withSite(null, async (other) => {
    const shop = createStore(other.config);
    try {
      const id = "pmuwtba7c";
      const base = (await shop.catalog.read()).products.find((product) => product.id === id);
      await shop.catalog.saveProduct({ product: { ...base, stock: { "160×200": 5 } }, base });
      const items = Array.from({ length: 50 }, () => ({ id, size: "160×200", qty: 20 }));
      for (let i = 0; i < 5; i += 1) assert.ok(await shop.orders.add(order({ items })));
      const after = (await shop.catalog.read()).products.find((product) => product.id === id);
      assert.equal(after.stock["160×200"], 5);
      assert.equal(after.inStock, true);
    } finally {
      shop.close();
    }
  }));

test("a new order saved before stock waited for work still gives its pieces back on cancel and delete", () =>
  withSite(null, async (other) => {
    const shop = createStore(other.config);
    try {
      const id = "pmuwtba7c";
      const onHand = async () => (await shop.catalog.read()).products.find((product) => product.id === id).stock["160×200"];
      const base = (await shop.catalog.read()).products.find((product) => product.id === id);
      await shop.catalog.saveProduct({ product: { ...base, stock: { "160×200": 4 } }, base });
      const holdOld = (orderId, taken) => {
        const items = JSON.parse(shop.db.prepare("SELECT items FROM orders WHERE id = ?").get(orderId).items).map((item) => ({ ...item, fromStock: taken }));
        shop.db.prepare("UPDATE orders SET items = ? WHERE id = ?").run(JSON.stringify(items), orderId);
        shop.db.prepare("UPDATE stock SET qty = qty - ? WHERE product_id = ? AND size = '160×200'").run(taken, id);
      };
      await shop.orders.add(order({ items: [{ id, size: "160×200", qty: 2 }] }));
      await shop.orders.add(order({ items: [{ id, size: "160×200", qty: 1 }] }));
      const [cancelled, deleted] = await shop.orders.read();
      holdOld(cancelled.id, 2);
      holdOld(deleted.id, 1);
      assert.equal(await onHand(), 1);

      assert.ok(await shop.orders.setStatus({ id: cancelled.id, status: "work" }));
      assert.equal(await onHand(), 1);
      assert.ok(await shop.orders.setStatus({ id: cancelled.id, status: "cancel" }));
      assert.equal(await onHand(), 3);
      assert.ok(await shop.orders.setStatus({ id: deleted.id, status: "new" }));
      assert.equal((await shop.orders.read()).find((entry) => entry.id === deleted.id).items[0].fromStock, 1);
      assert.ok(await shop.orders.remove({ id: deleted.id }));
      assert.equal(await onHand(), 4);
    } finally {
      shop.close();
    }
  }));

test("one damaged row does not stop the lists or the shop page; the rest of the record is kept for a repair", () =>
  withSite(null, async (other) => {
    const shop = createStore(other.config);
    try {
      const good = await shop.orders.add(order());
      const bad = await shop.orders.add(order({ name: "Ерлан", phone: "+7 701 555 22 11", company: "ТОО «Ромашка»" }));
      const badId = (await shop.orders.read()).find((entry) => entry.number === bad).id;
      shop.db.prepare("UPDATE orders SET items = '[{broken', extra = '{broken' WHERE id = ?").run(badId);
      shop.db.prepare("UPDATE clients SET extra = '{broken' WHERE phone = '77015552211'").run();
      const { products } = await shop.catalog.read();
      shop.db.prepare("UPDATE products SET data = '{broken' WHERE id = ?").run(products[0].id);
      shop.db.prepare("INSERT INTO settings (key, value) VALUES ('broken', '{broken')").run();

      const orders = await shop.orders.read();
      assert.deepEqual(orders.map((entry) => [entry.number, Boolean(entry.damaged)]), [[good, false], [bad, true]]);
      const damaged = orders.find((entry) => entry.id === badId);
      assert.deepEqual([damaged.name, damaged.items, damaged.totals.KZT > 0], ["Ерлан", [], true]);
      assert.equal((await shop.clients.read()).length, 2);
      const catalog = await shop.catalog.read();
      assert.equal(catalog.products.length, products.length - 1);
      assert.equal("broken" in catalog.settings, false);
      assert.match(await shop.catalog.page(), /^window\.SITE_DATA = /);

      assert.ok(await shop.orders.setStatus({ id: badId, status: "work" }));
      assert.equal(await shop.orders.setBuyer({ id: badId, company: "Другая" }), false);
      const row = shop.db.prepare("SELECT status, items, extra FROM orders WHERE id = ?").get(badId);
      assert.deepEqual({ ...row }, { status: "work", items: "[{broken", extra: "{broken" });
      assert.ok(await shop.orders.remove({ id: badId }));

      const repaired = await shop.catalog.saveProduct({ product: products[0], base: null });
      assert.equal(repaired.ok, true);
      assert.equal((await shop.catalog.read()).products.length, products.length);
    } finally {
      shop.close();
    }
  }));

test("visitors see whether a size is on hand, the admin sees the counts", () =>
  withSite(null, async (other) => {
    const shop = createStore(other.config);
    try {
      const base = (await shop.catalog.read()).products.find((product) => product.id === "pmuwtba7c");
      await shop.catalog.saveProduct({ product: { ...base, stock: { "90×200": 0, "160×200": 7, "180×200": 2 } }, base });
      const real = (await shop.catalog.read()).products.find((product) => product.id === base.id);
      assert.deepEqual(real.stock, { "90×200": 0, "160×200": 7, "180×200": 2 });
      const shown = (await shop.catalog.shown()).products.find((product) => product.id === base.id);
      assert.deepEqual(shown.stock, { "90×200": 0, "160×200": 1, "180×200": 1 });
      assert.equal(shown.inStock, true);
      const page = JSON.parse((await shop.catalog.page()).slice("window.SITE_DATA = ".length, -2));
      assert.deepEqual(page.products.find((product) => product.id === base.id).stock, shown.stock);
    } finally {
      shop.close();
    }
  }));

test("an order with more lines than the bag holds keeps the first 50 and tells the log", () =>
  withSite(null, async (other) => {
    const warnings = [];
    const logger = { info() {}, error() {}, warn: (message, data) => warnings.push([message, data]) };
    const shop = createStore(other.config, logger);
    try {
      const items = Array.from({ length: 60 }, (_, index) => ({ id: "gone", name: `Снятый товар ${index}`, price: 100, qty: 1 }));
      const number = await shop.orders.add(order({ items }));
      assert.equal((await shop.orders.read()).find((entry) => entry.number === number).items.length, 50);
      assert.deepEqual(warnings.map(([, data]) => data), [{ lines: 60, kept: 50 }]);
    } finally {
      shop.close();
    }
  }));

test("an old data file put back after the move is reported, not read", () =>
  withSite(null, async (other) => {
    createStore(other.config).close();
    writeJson(other.config.paths.legacy.orders, [{ id: "o1", number: 1, name: "Айгуль", phone: "87771234567" }]);
    const warnings = [];
    const logger = { info() {}, error() {}, warn: (message, data) => warnings.push({ message, data }), flush: async () => {} };
    const again = createStore(other.config, logger);
    try {
      assert.deepEqual(await again.orders.read(), []);
      assert.deepEqual(warnings.map((warning) => warning.data.files), [["orders.json"]]);
    } finally {
      again.close();
    }
  }));

test("a daily copy is restored without losing the database it replaces", () =>
  withSite(null, async (other) => {
    const live = createStore(other.config);
    await live.orders.add(order());
    await live.backups.daily();
    await live.orders.add(order());
    live.close();
    writeFileSync(join(other.config.paths.backups, "2020-01-01"), "not a folder");

    const [backup, ...rest] = listBackups(other.config.paths);
    assert.equal(rest.length, 0);
    assert.equal(backup.day, today());
    assert.deepEqual(backup.info, { orders: 1, lastOrder: 1, products: backup.info.products, clients: 1 });
    const kept = restoreBackup(other.config.paths, backup);
    assert.match(kept, /^before-restore-.+\.sqlite$/);

    const restored = createStore(other.config);
    try {
      assert.deepEqual((await restored.orders.read()).map((entry) => entry.number), [1]);
      assert.equal(await restored.orders.add(order()), 3);
    } finally {
      restored.close();
    }
    const old = new DatabaseSync(join(other.config.paths.db, kept), { readOnly: true });
    try {
      assert.equal(old.prepare("SELECT COUNT(*) AS count FROM orders").get().count, 2);
    } finally {
      old.close();
    }
  }));

test("cleanup helpers decide only from a confirmed missing file, never from a folder they could not read", () =>
  withSite(null, async (other) => {
    createStore(other.config).close();
    const { db, database } = other.config.paths;
    assert.equal(await statOrMissing(join(db, "no-such-file"), { delayMs: 1 }), null);
    assert.ok(await statOrMissing(database));
    assert.deepEqual(await readdirOrEmpty(join(db, "no-such-folder")), []);
    await assert.rejects(readdirOrEmpty(database), (error) => error.code !== "ENOENT");
  }));

test("a damaged or foreign copy is refused before the live database is touched", () =>
  withSite(null, async (other) => {
    const live = createStore(other.config);
    await live.orders.add(order());
    live.close();
    const { db, database } = other.config.paths;
    const before = readFileSync(database);

    const garbage = join(db, "garbage.sqlite");
    writeFileSync(garbage, "not a database");
    const foreign = join(db, "foreign.sqlite");
    const stranger = new DatabaseSync(foreign);
    stranger.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    stranger.close();

    assert.throws(() => restoreBackup(other.config.paths, { day: "garbage", file: garbage }), /garbage was not restored, nothing was changed/);
    assert.throws(() => restoreBackup(other.config.paths, { day: "foreign", file: foreign }), /no settings, products, orders/);
    assert.deepEqual(readFileSync(database), before);
    assert.deepEqual(readdirSync(db).filter((name) => /^before-restore-|\.tmp/.test(name)), []);
  }));

test("a restore never resets the order counter: an unreadable one stops it unless the owner gives the last number", () =>
  withSite(null, async (other) => {
    const live = createStore(other.config);
    await live.orders.add(order());
    await live.backups.daily();
    live.close();
    const [backup] = listBackups(other.config.paths);
    const { db, database } = other.config.paths;
    writeFileSync(database, "not a database");

    assert.throws(() => restoreBackup(other.config.paths, backup), (error) => error instanceof CounterUnreadableError);
    assert.equal(readFileSync(database, "utf8"), "not a database");
    assert.deepEqual(readdirSync(db).filter((name) => /^before-restore-|\.tmp/.test(name)), []);

    const kept = restoreBackup(other.config.paths, backup, { lastNumber: 7 });
    assert.equal(readFileSync(join(db, kept), "utf8"), "not a database");
    const restored = createStore(other.config);
    try {
      assert.equal(await restored.orders.add(order()), 8);
    } finally {
      restored.close();
    }
  }));

test("photos no product and no saved copy uses are removed; fresh uploads and photos of daily copies stay", () =>
  withSite(null, async (other) => {
    const live = createStore(other.config);
    try {
      const { uploads, backups, db } = other.config.paths;
      const photo = (name) => join(uploads, name);
      const old = Date.now() / 1000 - 2 * 24 * 60 * 60;
      const names = ["kept.jpg", "Upper.jpg", "фото 1.jpg", "мой файл.jpg", "in-code.jpg", "in-backup.jpg", "unused.jpg"];
      for (const name of [...names, "fresh.jpg"]) writeFileSync(photo(name), "jpeg");
      for (const name of names) utimesSync(photo(name), old, old);
      mkdirSync(join(other.config.paths.dist, "assets"), { recursive: true });
      writeFileSync(join(other.config.paths.dist, "assets", "home.js"), 'const hero = "images/products/in-code.jpg";');

      const base = (await live.catalog.read()).products[0];
      const first = await live.catalog.saveProduct({ product: { ...base, image: "images/products/in-backup.jpg", images: ["images/products/in-backup.jpg"] }, base });
      await live.backups.daily();
      const saved = first.catalog.products.find((product) => product.id === base.id);
      const images = ["images/products/kept.jpg?v=2", "/images/products/upper.JPG", "images/products/%D1%84%D0%BE%D1%82%D0%BE%201.jpg", "images\\products\\мой файл.jpg"];
      assert.equal((await live.catalog.saveProduct({ product: { ...saved, image: images[0], images }, base: saved })).ok, true);

      assert.deepEqual(await live.photos.cleanup(), ["unused.jpg"]);
      assert.deepEqual(readdirSync(uploads).sort(), ["fresh.jpg", "in-backup.jpg", "in-code.jpg", "kept.jpg", "Upper.jpg", "мой файл.jpg", "фото 1.jpg"].sort());

      rmSync(join(backups, today()), { recursive: true });
      writeFileSync(join(db, "before-restore-broken.sqlite"), "not a database");
      await assert.rejects(live.photos.cleanup());
      assert.ok(existsSync(photo("in-backup.jpg")));

      rmSync(join(db, "before-restore-broken.sqlite"));
      assert.deepEqual(await live.photos.cleanup(), ["in-backup.jpg"]);
      assert.deepEqual(readdirSync(uploads).sort(), ["fresh.jpg", "in-code.jpg", "kept.jpg", "Upper.jpg", "мой файл.jpg", "фото 1.jpg"].sort());
    } finally {
      live.close();
    }
  }));
