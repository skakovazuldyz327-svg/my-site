import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

const saved = new Map();
globalThis.window = globalThis;
globalThis.location = { protocol: "http:" };
globalThis.localStorage = {
  getItem: (key) => (saved.has(key) ? saved.get(key) : null),
  setItem: (key, value) => saved.set(key, String(value)),
  removeItem: (key) => saved.delete(key)
};
globalThis.SITE_DATA = {
  settings: {},
  products: [
    { id: "m1", name: "Матрас «Баланс»", price: 100, currency: "KZT", sizes: ["160×200", "180×200"] },
    { id: "p1", name: "Подушка", price: 10, currency: "KZT", sizes: [] }
  ]
};

const { addLine, BAG_KEY, checkBag, droppedNote, loadBag, MAX_BAG_LINES } = await import("../frontend/src/lib/order.js");
const putBag = (items) => saved.set(BAG_KEY, JSON.stringify(items));

beforeEach(() => saved.clear());

test("lines whose product or size left the site are dropped, and the buyer is told which ones", () => {
  putBag([
    { id: "m1", size: "160×200", qty: 2, name: "Матрас «Баланс»" },
    { id: "m1", size: "90×200", qty: 1 },
    { id: "gone", size: "", qty: 1, name: "Кровать «Сон»" },
    { id: "gone2", size: "", qty: 1 },
    { id: "p1", size: "", qty: 30 }
  ]);
  const { bag, dropped } = checkBag();
  assert.deepEqual(bag, [{ id: "m1", size: "160×200", qty: 2, name: "Матрас «Баланс»" }, { id: "p1", size: "", qty: 20 }]);
  assert.equal(
    droppedNote(dropped),
    "Убрали из корзины: Матрас «Баланс» 90×200 — размер изменился, выберите его заново; Кровать «Сон» — его больше нет на сайте; Товар — его больше нет на сайте."
  );
  assert.deepEqual(loadBag(), bag);
});

test("a broken saved bag reads as empty", () => {
  saved.set(BAG_KEY, "{broken");
  assert.deepEqual(checkBag(), { bag: [], dropped: [] });
});

test("a new line keeps the product name; a repeated one adds to its quantity up to 20", () => {
  let bag = addLine([], { id: "m1", size: "160×200", qty: 3 });
  assert.deepEqual(bag, [{ id: "m1", size: "160×200", qty: 3, name: "Матрас «Баланс»" }]);
  bag = addLine(bag, { id: "m1", size: "160×200", qty: 19 });
  assert.deepEqual(bag, [{ id: "m1", size: "160×200", qty: 20, name: "Матрас «Баланс»" }]);
});

test("the bag holds no more lines than the server takes; a line already in it still grows", () => {
  const full = Array.from({ length: MAX_BAG_LINES }, (_, index) => ({ id: "p1", size: String(index), qty: 1 }));
  assert.equal(MAX_BAG_LINES, 50);
  assert.equal(addLine(full, { id: "m1", size: "160×200", qty: 1 }), null);
  assert.equal(addLine(full, { id: "p1", size: "0", qty: 2 })[0].qty, 3);
});
