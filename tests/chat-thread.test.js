import assert from "node:assert/strict";
import { test } from "node:test";

const writes = [];
globalThis.localStorage = {
  getItem: () => null,
  setItem: (key, value) => {
    writes.push([key, value]);
    throw new Error("QuotaExceededError");
  }
};

const requests = [];
globalThis.window = globalThis;
globalThis.location = { protocol: "http:" };
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  if (url === "/api/chat") return new Response(JSON.stringify({ text: "Вижу файл." }));
  if (options.headers["X-File-Name"].startsWith("fail")) return new Response("{}", { status: 413 });
  return new Response(JSON.stringify({ id: `00000000000${requests.length}` }));
};

const { askAi, linkWithChatLabel, uploadChatFiles } = await import("../frontend/src/lib/chatThread.js");
const { chatRequest } = await import("../frontend/src/lib/attachments.js");

const labelOf = (link) => decodeURIComponent(link.split("?text=")[1]).match(/номер чата ([A-Z0-9]{6})\.$/)?.[1];

test("the WhatsApp message keeps the question and gets the chat label from the admin", () => {
  const link = linkWithChatLabel(`https://wa.me/77778492164?text=${encodeURIComponent("Здравствуйте, Жулдыз!\nНужен матрас 160×200")}`);
  const text = decodeURIComponent(link.split("?text=")[1]);
  assert.ok(link.startsWith("https://wa.me/77778492164?text="));
  assert.ok(text.startsWith("Здравствуйте, Жулдыз!\nНужен матрас 160×200\n\nМои файлы — в чате на сайте"));
  assert.match(labelOf(link), /^[A-Z0-9]{6}$/);
});

test("with full storage the label stays the same for the whole page, matching the uploads", () => {
  const first = labelOf(linkWithChatLabel("https://wa.me/77778492164?text=a"));
  const second = labelOf(linkWithChatLabel("https://wa.me/77778492164"));
  assert.equal(first, second);
  assert.equal(writes[0][1].slice(0, 6).toUpperCase(), first);
});

test("files already saved on the site are not promised again in the message", () => {
  const original = "Здравствуйте!\nВ чате прикрепил(а): план.dwg, фото.jpg — отправлю следом.";
  const text = decodeURIComponent(linkWithChatLabel(`https://wa.me/7777?text=${encodeURIComponent(original)}`).split("?text=")[1]);
  assert.ok(text.startsWith("Здравствуйте!\nВ чате прикрепил(а): план.dwg, фото.jpg.\n\nМои файлы — в чате на сайте, номер чата "));
  assert.doesNotMatch(text, /отправлю следом/);
});

test("uploads return the server ids in order and the question goes with the same chat session", async () => {
  requests.length = 0;
  const file = (name) => ({ name, size: 3, type: "text/plain", file: new Blob(["abc"]) });
  const ids = await uploadChatFiles([file("a.txt"), file("fail.txt"), file("b.txt")], "вопрос");
  assert.deepEqual(ids, ["000000000001", "", "000000000003"]);
  const session = requests[0].options.headers["X-Chat-Session"];
  assert.match(session, /^[a-z0-9]{10}$/);

  const answer = await askAi([{ role: "user", text: "", files: [{ id: ids[0], name: "a.txt", size: 3, type: "text/plain" }] }]);
  assert.equal(answer.text, "Вижу файл.");
  assert.equal(JSON.parse(requests.at(-1).options.body).session, session);
  assert.equal(await uploadChatFiles([{ name: "x", size: 1, type: "" }], ""), null);
});

test("the browser sends only file references: no previews, no contents", () => {
  const [turn] = chatRequest([{ role: "user", text: "вот", files: [{ id: "0123456789ab", name: "фото.jpg", size: 9, type: "image/jpeg", src: "data:image/jpeg;base64,AAAA", file: new Blob(["x"]), excerpt: "x" }, { name: "без-номера.pdf", size: 1, type: "application/pdf" }] }]);
  assert.deepEqual(turn.files, [{ id: "0123456789ab", name: "фото.jpg", size: 9, type: "image/jpeg" }, { name: "без-номера.pdf", size: 1, type: "application/pdf" }]);
});

test("a broken link is returned untouched", () => {
  assert.equal(linkWithChatLabel("https://wa.me/7777?text=%E0%A4%A"), "https://wa.me/7777?text=%E0%A4%A");
});
