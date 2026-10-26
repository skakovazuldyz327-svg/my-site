import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { card, createConsultant, handoffReason, isHealth, readProfile, stock } from "../shared/consultant/index.js";

const catalog = JSON.parse(readFileSync(new URL("./fixtures/products.json", import.meta.url), "utf8"));
const consultant = createConsultant({ products: catalog.products, phone: catalog.settings.whatsapp });
const ask = (...texts) => consultant.ask(texts.map((text) => ({ role: "user", text })));

test("greeting asks how the client sleeps", () => {
  const reply = ask("Привет");
  assert.match(reply.text, /Как вы спите/);
  assert.equal(reply.handoff, null);
});

test("side sleeper with a size gets one or two mattresses", () => {
  const reply = ask("сплю на боку, 160х200");
  assert.ok(reply.products.length >= 1 && reply.products.length <= 2);
  assert.ok(reply.products.every((product) => product.href.startsWith("product.html?id=")));
});

test("weight and height never swallow the bed size that follows them", () => {
  const profile = (text) => readProfile([{ role: "user", text }]);
  assert.deepEqual([profile("вес 100 кг, кровать 180х200").size, profile("вес 100 кг, кровать 180х200").weight], ["180", 100]);
  assert.deepEqual([profile("вешу много, кровать 160 на 200").size, profile("вешу много, кровать 160 на 200").weight], ["160", 0]);
  assert.deepEqual([profile("рост 175, вес около 90, 140х200").size, profile("рост 175, вес около 90, 140х200").weight], ["140", 90]);
  assert.equal(profile("вес 120 кг").size, "");
});

test("an emoji cut in half never breaks the WhatsApp link", () => {
  const reply = consultant.ask([
    { role: "user", text: `хочу купить баланс \uD83D ${"о".repeat(820)}😀😀😀`, files: [{ name: `${"а".repeat(119)}\uD83D` }] }
  ]);
  const text = decodeURIComponent(reply.handoff.link.split("?text=")[1]);
  assert.ok(text.isWellFormed());
  assert.ok(text.endsWith("…"));
});

test("buying a named product hands over to Zhuldyz with a WhatsApp link", () => {
  const reply = ask("хочу купить баланс");
  assert.ok(reply.handoff);
  assert.match(reply.handoff.link, /^https:\/\/wa\.me\/\d+\?text=/);
  assert.match(decodeURIComponent(reply.handoff.link), /Тема: хочу оформить заказ/);
});

test("back pain is treated as a health handoff", () => {
  assert.ok(isHealth("болит спина"));
  const reply = ask("болит спина");
  assert.match(reply.text, /не врач/);
  assert.ok(reply.handoff);
});

test("handoff reasons are detected from plain phrases", () => {
  assert.equal(handoffReason("дайте ваш номер телефона"), "request");
  assert.equal(handoffReason("есть доставка в Астану?"), "delivery");
  assert.equal(handoffReason("можно в рассрочку"), "payment");
  assert.equal(handoffReason("какой матрас лучше"), "");
});

test("ordinary questions about the spine or an old mattress are not taken for a handoff", () => {
  assert.equal(handoffReason("Связь с позвоночником важна?"), "");
  assert.equal(handoffReason("болит позвоночник, какой матрас взять"), "");
  assert.equal(handoffReason("Хочу поменять старый матрас на ортопедический"), "");
  assert.equal(handoffReason("старый матрас скрипит, хочу новый"), "");
  assert.equal(handoffReason("где ваш торговый центр"), "");
  assert.equal(handoffReason("хочу вернуться к Балансу, расскажите ещё"), "");
  assert.equal(handoffReason("хочу вернуть матрас"), "service");
  assert.equal(handoffReason("позвоните мне"), "request");
  assert.equal(handoffReason("хочу связь с менеджером"), "request");
  assert.equal(handoffReason("купленный у вас матрас скрипит"), "service");
  assert.equal(handoffReason("можно поторговаться? торг уместен"), "payment");
});

test("cards are found by product names in free text", () => {
  const cards = consultant.cards("Советую «Кокос Хард» и «Баланс».");
  assert.deepEqual(cards.map((item) => item.id).sort(), ["p8", "pmuwtba7c"].sort());
});

test("empty catalog never crashes and hands over", () => {
  const empty = createConsultant({ products: [], phone: "" });
  const reply = empty.ask([{ role: "user", text: "матрас" }]);
  assert.ok(reply.handoff);
});

test("with counted stock the consultant names the sizes on hand and the ones made to order", () => {
  const product = { name: "Матрас", price: 1000, sizes: ["90×200", "160×200"], inStock: true };
  assert.equal(stock(product), "в наличии");
  assert.equal(stock({ ...product, inStock: false }), "под заказ");
  assert.equal(stock({ ...product, stock: { "90×200": 0, "160×200": 2 } }), "в наличии: 160×200; под заказ: 90×200");
  assert.equal(stock({ ...product, stock: { "90×200": 1, "160×200": 2 } }), "в наличии");
  assert.equal(stock({ ...product, stock: { "90×200": 0, "160×200": 0 }, inStock: false }), "под заказ");
  assert.equal(stock({ ...product, sizes: [], stock: { "": 0 }, inStock: false }), "под заказ");
  assert.match(card({ ...product, id: "x", stock: { "90×200": 0, "160×200": 2 } }).meta, /в наличии: 160×200; под заказ: 90×200/);
});
