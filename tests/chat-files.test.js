import assert from "node:assert/strict";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createAi } from "../server/ai/index.js";
import { createApp } from "../server/app.js";
import { silentLogger } from "../server/log.js";
import { createStore } from "../server/store/index.js";
import { fakeProvider, tempSite } from "./helpers.js";

const site = tempSite();
site.config.chatFiles = { maxFileBytes: 64 * 1024, totalBytes: 100 * 1024, days: 90, perHour: 8, bytesPerDay: 90 * 1024 };

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
const upload = (body, { name = "фото кровати.jpg", type = "image/jpeg", ip = "10.0.0.1", text = "Вот моя кровать" } = {}) =>
  fetch(`${base}/api/chat/files`, {
    method: "POST",
    headers: {
      "Content-Type": type,
      "X-File-Name": encodeURIComponent(name),
      "X-Chat-Session": "abc123def4",
      "X-Chat-Text": encodeURIComponent(text),
      "X-Forwarded-For": ip
    },
    body
  });

test("a visitor's file is saved and only the admin can list, download and delete it", async () => {
  const bytes = Buffer.from([1, 2, 3, 4, 5, 250]);
  const response = await upload(bytes);
  assert.equal(response.status, 200);
  const { id } = await response.json();

  assert.equal((await fetch(`${base}/api/chat/files`)).status, 401);
  assert.equal((await fetch(`${base}/api/chat/files/download?id=${id}`)).status, 401);

  const list = await (await fetch(`${base}/api/chat/files`, { headers: admin })).json();
  const entry = list.files.find((file) => file.id === id);
  assert.equal(entry.name, "фото кровати.jpg");
  assert.equal(entry.text, "Вот моя кровать");
  assert.equal(entry.session, "abc123def4");
  assert.equal(entry.size, bytes.length);
  assert.equal(list.usedBytes >= bytes.length, true);

  const download = await fetch(`${base}/api/chat/files/download?id=${id}`, { headers: admin });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.match(download.headers.get("content-disposition"), /^attachment; .*filename\*=UTF-8''%D1%84%D0%BE%D1%82%D0%BE/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

  const removed = await fetch(`${base}/api/chat/files/delete`, { method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
  assert.equal(removed.status, 200);
  assert.equal(existsSync(join(site.config.paths.chatFiles, id)), false);
  assert.equal((await fetch(`${base}/api/chat/files/download?id=${id}`, { headers: admin })).status, 404);
});

test("file names never reach the disk path and dangerous files are served only as downloads", async () => {
  const response = await upload(Buffer.from("<script>alert(1)</script>"), { name: "../../server/index.js", type: "text/html", ip: "10.0.0.2" });
  const { id } = await response.json();
  assert.deepEqual(readdirSync(site.config.paths.chatFiles).filter((name) => name !== id && !/^[0-9a-f]{12}$/.test(name)), []);
  const list = await (await fetch(`${base}/api/chat/files`, { headers: admin })).json();
  assert.equal(list.files.find((file) => file.id === id).name, "_.._server_index.js");
  const download = await fetch(`${base}/api/chat/files/download?id=${id}`, { headers: admin });
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await fetch(`${base}/api/chat/files/download?id=../../.env`, { headers: admin })).status, 404);
});

test("long names with emoji and quotes are trimmed safely, keep the extension and still download", async () => {
  const name = `${"а".repeat(115)}😀😀 и ещё длинный хвост.pdf`;
  const response = await upload(Buffer.from("pdf"), { name, text: `${"т".repeat(499)}😀 конец`, ip: "10.0.0.4" });
  assert.equal(response.status, 200);
  const { id } = await response.json();
  const list = await (await fetch(`${base}/api/chat/files`, { headers: admin })).json();
  const entry = list.files.find((file) => file.id === id);
  assert.equal(entry.name, `${"а".repeat(115)}😀.pdf`);
  assert.equal(entry.text, `${"т".repeat(499)}😀`);
  const download = await fetch(`${base}/api/chat/files/download?id=${id}`, { headers: admin });
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /filename\*=UTF-8''(%D0%B0){115}%F0%9F%98%80\.pdf$/);

  const quoted = await (await upload(Buffer.from("x"), { name: "it's (1).pdf", ip: "10.0.0.4" })).json();
  const disposition = (await fetch(`${base}/api/chat/files/download?id=${quoted.id}`, { headers: admin })).headers.get("content-disposition");
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), "it's (1).pdf");
  assert.doesNotMatch(disposition.split("filename*=UTF-8''")[1], /['()*]/);
  for (const file of [id, quoted.id]) await store.chatFiles.remove(file);
});

test("one visitor cannot upload more than the daily size limit, so the storage stays free for others", async () => {
  const responses = [];
  for (let i = 0; i < 3; i += 1) responses.push(await upload(Buffer.alloc(40 * 1024, i), { ip: "10.0.2.1" }));
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 429]);
  for (const response of responses.slice(0, 2)) await store.chatFiles.remove((await response.json()).id);
});

test("empty, oversized and over-quota uploads are refused", async () => {
  assert.equal((await upload(Buffer.alloc(0), { ip: "10.0.0.3" })).status, 400);
  assert.equal((await upload(Buffer.alloc(65 * 1024), { ip: "10.0.0.3" })).status, 413);
  const statuses = [];
  for (let i = 0; i < 3; i += 1) statuses.push((await upload(Buffer.alloc(40 * 1024, i), { ip: `10.0.1.${i}` })).status);
  assert.deepEqual(statuses, [200, 200, 507]);
});

test("one visitor cannot upload more than the hourly limit", async () => {
  const statuses = [];
  for (let i = 0; i < 9; i += 1) statuses.push((await upload(Buffer.from([i + 1]), { ip: "10.0.0.9" })).status);
  assert.deepEqual(statuses.slice(0, 8).every((status) => status === 200), true);
  assert.equal(statuses[8], 429);
});

test("cleanup drops expired files and files left without an index entry", async () => {
  const entry = await store.chatFiles.add({ name: "старое.pdf", type: "application/pdf", session: "", text: "", bytes: Buffer.from("old") });
  writeFileSync(join(site.config.paths.chatFiles, "orphan"), "x");
  assert.equal(await store.chatFiles.cleanup(), 0);
  assert.equal(existsSync(join(site.config.paths.chatFiles, "orphan")), true);
  const removed = await store.chatFiles.cleanup(Date.now() + 91 * 24 * 60 * 60 * 1000);
  assert.equal(removed >= 2, true);
  assert.equal(existsSync(join(site.config.paths.chatFiles, entry.id)), false);
  assert.equal(existsSync(join(site.config.paths.chatFiles, "orphan")), false);
  assert.deepEqual(await store.chatFiles.read(), []);
});
