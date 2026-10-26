import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createAi } from "../server/ai/index.js";
import { createApp } from "../server/app.js";
import { DEFAULT_ADMIN_PASSWORD } from "../server/config.js";
import { createRouter } from "../server/http/router.js";
import { silentLogger } from "../server/log.js";
import { createStore } from "../server/store/index.js";
import { fakeProvider, tempSite } from "./helpers.js";

const site = tempSite();
site.config.chatPerMinute = 3;
site.config.ordersPerHour = 6;
mkdirSync(site.config.paths.dist, { recursive: true });
writeFileSync(join(site.config.paths.dist, "index.html"), "<h1>ok</h1>");
writeFileSync(join(site.config.root, ".env"), "ADMIN_PASSWORD=leak");

const store = createStore(site.config);
const ai = createAi({ config: site.config, store, logger: silentLogger, providers: [fakeProvider("down", [new Error("down")])] });
const server = createApp({ config: site.config, store, logger: silentLogger, ai });
let base = "";

before(() => new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
  base = `http://127.0.0.1:${server.address().port}`;
  resolve();
})));
after(() => {
  server.close();
  store.close();
  site.cleanup();
});

const admin = { "X-Admin-Password": "secret" };
const json = (body, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

test("pages and catalog are served, hidden files are not", async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(home.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal((await (await fetch(`${base}/api/products`)).json()).products.length > 0, true);
  const page = await fetch(`${base}/data/products.js?v=2`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/javascript/);
  assert.match(await page.text(), /^window\.SITE_DATA = \{/);
  assert.equal((await fetch(`${base}/data/products.json`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/data/..%2F.env`)).status, 404);
  assert.equal((await fetch(`${base}/missing.html`)).status, 404);
  assert.equal((await fetch(`${base}/index.html::$DATA`)).status, 404);
  assert.equal((await fetch(`${base}/CON:`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: "DELETE" })).status, 405);
});

test("admin endpoints require the password", async () => {
  assert.equal((await fetch(`${base}/api/orders`)).status, 401);
  assert.equal((await fetch(`${base}/api/login`, { method: "POST", headers: { "X-Admin-Password": "wrong" } })).status, 401);
  assert.equal((await fetch(`${base}/api/login`, { method: "POST", headers: admin })).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/orders`, { headers: admin })).json(), []);
});

test("an order placed by a visitor shows up for the admin", async () => {
  const response = await fetch(`${base}/api/orders`, json({ name: "Тест", phone: "+7 777 000 00 00", items: [{ id: "p8", qty: 1, size: "" }] }));
  const answer = await response.json();
  assert.equal(answer.ok, true);
  assert.equal(answer.number, 1);
  const orders = await (await fetch(`${base}/api/orders`, { headers: admin })).json();
  assert.equal(orders[0].name, "Тест");
  // The visitor gets back their own order as saved, for the invoice, and nothing from the admin's records.
  assert.deepEqual(answer.invoice, { number: 1, createdAt: orders[0].createdAt, name: "Тест", phone: "+7 777 000 00 00", items: orders[0].items.map(({ id, name, size, qty, price, currency }) => ({ id, name, size, qty, price, currency })) });
  assert.equal((await fetch(`${base}/api/orders`, json({ name: "x" }))).status, 400);
  assert.equal((await fetch(`${base}/api/orders`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{broken" })).status, 400);
});

test("only the admin saves the seller's requisites and the buyer's details; both are checked", async () => {
  const company = { company_name: "ИП «Жулдыз»", bin_iin: "900101400123", iik: "KZ12722S000012345678", bank_name: "АО «Банк»", bik: "CASPKZKA", kbe: "19", company_address: "г. Алматы", is_vat_payer: false };
  assert.equal((await fetch(`${base}/api/settings/company`, json({ company }))).status, 401);
  assert.equal((await fetch(`${base}/api/settings/company`, json({ company: { ...company, iik: "KZ1" } }, admin))).status, 400);
  const saved = await fetch(`${base}/api/settings/company`, json({ company }, admin));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).catalog.settings.company.iik, "KZ12722S000012345678");
  assert.equal((await (await fetch(`${base}/api/products`)).json()).settings.company.bin_iin, "900101400123");

  const [first] = await (await fetch(`${base}/api/orders`, { headers: admin })).json();
  assert.equal((await fetch(`${base}/api/orders/buyer`, json({ id: first.id, company: "ТОО «Ромашка»" }))).status, 401);
  assert.equal((await fetch(`${base}/api/orders/buyer`, json({ id: first.id, bin: "12" }, admin))).status, 400);
  assert.equal((await fetch(`${base}/api/orders/buyer`, json({ id: first.id, company: "ТОО «Ромашка»", bin: "123456789012" }, admin))).status, 200);
  const [updated] = await (await fetch(`${base}/api/orders`, { headers: admin })).json();
  assert.equal(updated.company, "ТОО «Ромашка»");
  assert.equal(updated.bin, "123456789012");
});

test("the admin deletes a client card; the orders stay and a new order brings the card back", async () => {
  const [client] = await (await fetch(`${base}/api/clients`, { headers: admin })).json();
  assert.equal((await fetch(`${base}/api/clients/delete`, json({ id: client.id }))).status, 401);
  assert.equal((await fetch(`${base}/api/clients/delete`, json({ id: client.id }, admin))).status, 200);
  assert.deepEqual(await (await fetch(`${base}/api/clients`, { headers: admin })).json(), []);
  assert.equal((await fetch(`${base}/api/clients/delete`, json({ id: client.id }, admin))).status, 404);
  assert.equal((await (await fetch(`${base}/api/orders`, { headers: admin })).json()).length, 1);
  await fetch(`${base}/api/orders`, json({ name: "Тест", phone: "+7 777 000 00 00", items: [{ id: "p8", qty: 1, size: "" }] }));
  assert.equal((await (await fetch(`${base}/api/clients`, { headers: admin })).json())[0].phone, client.phone);
});

test("the admin edits one product at a time and a stale window gets a conflict, not an overwrite", async () => {
  const catalog = await (await fetch(`${base}/api/products`)).json();
  const product = catalog.products[0];
  assert.equal((await fetch(`${base}/api/products/save`, json({ product, base: product }))).status, 401);
  assert.equal((await fetch(`${base}/api/products`, json(catalog, admin))).status, 405);
  const saved = await fetch(`${base}/api/products/save`, json({ product: { ...product, price: 42 }, base: product }, admin));
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).catalog.products[0].price, 42);
  const stale = await fetch(`${base}/api/products/save`, json({ product: { ...product, price: 43 }, base: product }, admin));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).catalog.products[0].price, 42);
});

test("a stock change made in the admin reaches the shop page at once; a broken price is refused", async () => {
  const product = (await (await fetch(`${base}/api/products`)).json()).products[1];
  const saved = await fetch(`${base}/api/products/save`, json({ product: { ...product, inStock: !product.inStock }, base: product }, admin));
  assert.equal(saved.status, 200);
  const shop = await (await fetch(`${base}/data/products.js`)).text();
  const shown = JSON.parse(shop.slice("window.SITE_DATA = ".length, -2)).products.find((entry) => entry.id === product.id);
  assert.equal(shown.inStock, !product.inStock);
  const current = (await saved.json()).catalog.products.find((entry) => entry.id === product.id);
  const bad = await fetch(`${base}/api/products/save`, json({ product: { ...current, price: 0 }, base: current }, admin));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).catalog.products.find((entry) => entry.id === product.id).price, current.price);
});

test("uploads are stored as images, non-JPEG bodies are refused", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const response = await fetch(`${base}/api/upload`, { method: "POST", headers: admin, body: jpeg });
  const { url } = await response.json();
  assert.match(url, /^images\/products\/[0-9a-f]{12}\.jpg$/);
  assert.equal((await fetch(`${base}/${url}`)).status, 200);
  const html = await fetch(`${base}/api/upload`, { method: "POST", headers: admin, body: Buffer.from("<script>alert(1)</script>") });
  assert.equal(html.status, 415);
});

test("repeated wrong admin passwords lock that address only", async () => {
  const attacker = { "X-Forwarded-For": "10.9.9.9" };
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await fetch(`${base}/api/login`, { method: "POST", headers: { ...attacker, "X-Admin-Password": `guess${i}` } })).status, 401);
  }
  assert.equal((await fetch(`${base}/api/login`, { method: "POST", headers: { ...attacker, ...admin } })).status, 429);
  assert.equal((await fetch(`${base}/api/login`, { method: "POST", headers: admin })).status, 200);
});

test("one address cannot flood the orders; the refusal is one the shop page retries later", async () => {
  const from = (ip) => json({ name: "Поток", phone: "+7 700 000 11 22", items: [{ id: "p8", qty: 1 }] }, { "X-Forwarded-For": ip });
  for (let i = 0; i < 6; i += 1) assert.equal((await fetch(`${base}/api/orders`, from("10.7.7.7"))).status, 200);
  assert.equal((await fetch(`${base}/api/orders`, from("10.7.7.7"))).status, 429);
  assert.equal((await fetch(`${base}/api/orders`, from("10.7.7.8"))).status, 200);
});

test("with the default password the admin API answers only on this computer, never through a tunnel", async () => {
  const router = createRouter({ adminPassword: DEFAULT_ADMIN_PASSWORD, localOnly: true });
  router.get("/api/orders", (req, res) => res.writeHead(200).end(), { admin: true });
  const call = async (remoteAddress, headers = {}) => {
    const res = { headersSent: false, status: 0, writeHead(status) { this.status = status; return this; }, end() {} };
    await router.handle({ method: "GET", headers: { host: "127.0.0.1:8765", "x-admin-password": DEFAULT_ADMIN_PASSWORD, ...headers }, socket: { remoteAddress } }, res, "/api/orders");
    return res.status;
  };
  assert.equal(await call("127.0.0.1"), 200);
  assert.equal(await call("::1", { host: "[::1]:8765" }), 200);
  assert.equal(await call("127.0.0.1", { host: "localhost:8765" }), 200);
  assert.equal(await call("127.0.0.1", { host: "evil.example:8765" }), 403);
  assert.equal(await call("127.0.0.1", { "x-forwarded-for": "203.0.113.5" }), 403);
  assert.equal(await call("127.0.0.1", { "cf-connecting-ip": "203.0.113.5" }), 403);
  assert.equal(await call("192.168.1.20"), 403);
});

test("an aborted upload does not hang the server", async () => {
  const { request } = await import("node:http");
  await new Promise((resolve) => {
    const req = request(`${base}/api/upload`, { method: "POST", headers: { ...admin, "Content-Length": "1000" } });
    req.on("error", resolve);
    req.write("partial");
    setTimeout(() => {
      req.destroy();
      resolve();
    }, 50);
  });
  assert.equal((await fetch(`${base}/api/products`)).status, 200);
});

test("visitors behind a local tunnel are rate-limited separately", async () => {
  const via = (ip) => json({ messages: [] }, { "X-Forwarded-For": ip });
  for (let i = 0; i < 3; i += 1) assert.equal((await fetch(`${base}/api/chat`, via("10.0.0.1"))).status, 200);
  assert.equal((await fetch(`${base}/api/chat`, via("10.0.0.1"))).status, 429);
  assert.equal((await fetch(`${base}/api/chat`, via("10.0.0.2"))).status, 200);
});

test("chat answers from the rules when the AI is down, then rate-limits", async () => {
  const response = await fetch(`${base}/api/chat`, json({ messages: [{ role: "user", text: "Привет" }] }));
  const reply = await response.json();
  assert.equal(reply.source, "rules");
  assert.ok(reply.text);
  await fetch(`${base}/api/chat`, json({ messages: [] }));
  await fetch(`${base}/api/chat`, json({ messages: [] }));
  assert.equal((await fetch(`${base}/api/chat`, json({ messages: [] }))).status, 429);
});

test("a saved order is confirmed even when reading it back for the invoice fails", async () => {
  const { invoice } = store.orders;
  store.orders.invoice = async () => {
    throw new Error("disk I/O error");
  };
  try {
    const response = await fetch(`${base}/api/orders`, json({ name: "Тест", phone: "+7 777 000 00 00", items: [{ id: "p8", qty: 1 }] }, { "X-Forwarded-For": "10.5.5.5" }));
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.equal(answer.ok, true);
    assert.equal(answer.number > 0, true);
    assert.equal(answer.invoice, null);
  } finally {
    store.orders.invoice = invoice;
  }
});

test("the public catalog tells only whether a size is on hand; the counts need the admin password", async () => {
  const product = (await (await fetch(`${base}/api/admin/products`, { headers: admin })).json()).products[0];
  const sizes = product.sizes?.length ? product.sizes : [""];
  const stock = Object.fromEntries(sizes.map((size, index) => [size, index ? 0 : 9]));
  assert.equal((await fetch(`${base}/api/products/save`, json({ product: { ...product, stock }, base: product }, admin))).status, 200);
  const find = (catalog) => catalog.products.find((entry) => entry.id === product.id);
  const visible = Object.fromEntries(sizes.map((size, index) => [size, index ? 0 : 1]));
  assert.deepEqual(find(await (await fetch(`${base}/api/products`)).json()).stock, visible);
  const page = await (await fetch(`${base}/data/products.js`)).text();
  assert.deepEqual(find(JSON.parse(page.slice("window.SITE_DATA = ".length, -2))).stock, visible);
  assert.equal((await fetch(`${base}/api/admin/products`)).status, 401);
  assert.deepEqual(find(await (await fetch(`${base}/api/admin/products`, { headers: admin })).json()).stock, stock);
});

test("an order sent by another site's page (not JSON) is refused and not saved", async () => {
  const count = async () => (await (await fetch(`${base}/api/orders`, { headers: admin })).json()).length;
  const before = await count();
  const body = Buffer.from(JSON.stringify({ name: "Чужой", phone: "+7 700 999 88 77", items: [{ id: "p8", qty: 1 }] }), "utf8");
  const from = { "X-Forwarded-For": "10.3.3.3", Origin: "https://evil.example" };
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
    const headers = type ? { ...from, "Content-Type": type } : from;
    assert.equal((await fetch(`${base}/api/orders`, { method: "POST", headers, body })).status, 415, type || "no type");
  }
  assert.equal(await count(), before);
  assert.equal((await fetch(`${base}/api/orders`, { method: "POST", headers: { ...from, "Content-Type": "Application/JSON; charset=utf-8" }, body })).status, 200);
  assert.equal(await count(), before + 1);
});
