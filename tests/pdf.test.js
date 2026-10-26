import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { CATALOG_LAYOUTS, catalogDoc, catalogFileName } from "../frontend/src/pdf/catalogDoc.js";
import { companyDetails } from "../frontend/src/pdf/company.js";
import { amount, money, shopPhone, shortDate, shorten, tidyItem, tidyText } from "../frontend/src/pdf/format.js";
import { amountInWords, invoiceDoc, invoiceFileName, invoiceReady, invoiceTotals } from "../frontend/src/pdf/invoiceDoc.js";
import { orderDoc, orderFileName } from "../frontend/src/pdf/orderDoc.js";

const catalog = JSON.parse(readFileSync(new URL("./fixtures/products.json", import.meta.url), "utf8"));

// All the text a document would print, in reading order.
function texts(node, out = []) {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => texts(child, out));
  else if (node && typeof node === "object") {
    for (const key of ["text", "stack", "columns", "ul", "table", "body", "content"]) if (key in node) texts(node[key], out);
  }
  return out;
}

const order = {
  id: "abc123",
  number: 42,
  createdAt: "2026-10-12T18:16:58+05:00",
  status: "work",
  name: "Айгуль Серикова",
  phone: "+7 777 123 45 67",
  items: [
    { id: "p2", name: "Матрас «Латекс Нео»", size: "120×200", qty: 2, price: 168300, currency: "KZT", fromStock: 1 },
    { id: "gone", name: "Подушка", size: "", qty: 1, price: 29900, currency: "KZT", removed: true }
  ],
  totals: { KZT: 366500 }
};

test("money keeps the tenge sign and never breaks a price across lines", () => {
  assert.equal(money(1234567), "1\u00A0234\u00A0567\u00A0₸");
  assert.equal(money(10, "USD"), "10\u00A0$");
  assert.equal(money(5, "XXX"), "5\u00A0₸");
  assert.equal(money("oops"), "0\u00A0₸");
});

test("shop phone and long text are made readable", () => {
  assert.equal(shopPhone("77778492164"), "+7 777 849 21 64");
  assert.equal(shopPhone(""), "");
  assert.equal(shorten("один два три четыре", 12), "один два…");
  assert.equal(shorten("коротко", 50), "коротко");
});

test("an order document shows the buyer, every line as ordered and the saved total", () => {
  const doc = orderDoc(order, { whatsapp: "77778492164", photos: { p2: "data:image/jpeg;base64,AAAA" } });
  const all = texts(doc.content).join("\n");
  assert.match(all, /Заказ № 42/);
  assert.match(all, /12 октября 2026/);
  assert.match(all, /Айгуль Серикова/);
  assert.match(all, /\+7 777 123 45 67/);
  assert.match(all, /Матрас «Латекс Нео»/);
  assert.match(all, /Размер: 120×200/);
  assert.match(all, /Под заказ: 1 шт\./);
  assert.match(all, /336\u00A0600\u00A0₸/);
  assert.match(all, /Подушка/);
  assert.match(all, /366\u00A0500\u00A0₸/);
  assert.match(all, /\+7 777 849 21 64/);
  assert.equal(doc.defaultStyle.font, "NotoSans");
  assert.equal(orderFileName(order), "zakaz-42-2026-10-12.pdf");

  const rows = doc.content.find((part) => part.table?.headerRows).table.body;
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1].image, "data:image/jpeg;base64,AAAA");
  assert.equal(rows[2][1].image, undefined);
});

test("an order without saved totals is summed from its lines, one total per currency", () => {
  const doc = orderDoc({ ...order, totals: undefined, items: [...order.items, { id: "x", name: "Плед", qty: 1, price: 50, currency: "USD" }] });
  const all = texts(doc.content).join("\n");
  assert.match(all, /366\u00A0500\u00A0₸/);
  assert.match(all, /50\u00A0\$/);
});

test("hand-typed product text is tidied for print", () => {
  assert.equal(tidyText("латекс,кокосовая койра.Натуральный латекс"), "латекс, кокосовая койра. Натуральный латекс");
  assert.equal(tidyText("Высота 22 СМ, ширина 160см"), "Высота 22\u00A0см, ширина 160\u00A0см");
  assert.equal(tidyText("ЛДСП ( с мягкой обивкой ) и основание : 30 см"), "ЛДСП (с мягкой обивкой) и основание: 30\u00A0см");
  assert.equal(tidyText("Каркас:Массив дуба"), "Каркас: Массив дуба");
  assert.equal(tidyText("толщина 1,5 мм, сайт zhuldyz.kz, т.д."), "толщина 1,5\u00A0мм, сайт zhuldyz.kz, т.д.");
  assert.equal(tidyText("5 мест,  2 м²"), "5 мест, 2\u00A0м²");
  assert.equal(tidyText("Размер: 1,60*2,00 и 160х200, 90 x 200"), "Размер: 1,60×2,00 и 160×200, 90×200");
  assert.equal(tidyItem("Гарантия: 5 лет."), "Гарантия: 5 лет");
  assert.equal(tidyItem("Высота 22 СМ."), "Высота 22\u00A0см");
  assert.equal(tidyItem("Пружины: 500 шт."), "Пружины: 500 шт.");
  assert.equal(tidyItem("Коллекция 2026 г."), "Коллекция 2026 г.");
  assert.equal(tidyText("Время работы 10:00–19:00"), "Время работы 10:00–19:00");
  assert.equal(shortDate(new Date(2026, 9, 22)), "22.10.2026");
});

// The PDF module loads with the public catalog page, so one regex Safari cannot parse would blank that page on older iPhones.
test("the PDF code has no regex lookbehind, which Safari before 16.4 cannot parse", () => {
  for (const name of readdirSync(new URL("../frontend/src/pdf/", import.meta.url)).filter((file) => file.endsWith(".js"))) {
    const source = readFileSync(new URL(`../frontend/src/pdf/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\(\?<[=!]/, name);
  }
});

const cardRows = (doc) => doc.content.slice(1).map((part) => part.stack[part.stack.length - 1].table);
const cardCells = (table) => table.body[0].filter((cell) => cell.fillColor);

test("a catalog opens with a cover page, then groups products by category and hides stock counts", () => {
  const doc = catalogDoc(catalog.products, { whatsapp: "77778492164", site: "zhuldyz.kz", date: new Date(2026, 9, 21) });
  const coverText = texts(doc.content[0]).join("\n");
  assert.equal(doc.content[0].pageBreak, "after");
  assert.match(coverText, /КАТАЛОГ ТОВАРОВ/);
  assert.match(coverText, /Актуально на 21\.10\.2026/);
  assert.match(coverText, /\+7 777 849 21 64/);
  assert.match(coverText, /zhuldyz\.kz/);
  assert.ok(doc.content[0].stack[0].columns[0].svg.includes("<svg"));

  const all = texts(doc.content).join("\n");
  for (const product of catalog.products) assert.ok(all.includes(product.name), product.name);
  const counted = catalogDoc([{ ...catalog.products[0], stock: { "90×200": 7531 }, inStock: true }]);
  assert.doesNotMatch(texts(counted.content).join("\n"), /7531/);
  assert.match(texts(counted.content).join("\n"), /В наличии/);
  assert.match(texts(catalogDoc([{ ...catalog.products[0], inStock: false }]).content).join("\n"), /Под заказ/);

  const headings = doc.content.filter((part) => part.unbreakable && part.stack.length === 2);
  assert.equal(headings.length, new Set(catalog.products.map((product) => product.category)).size);
  assert.equal(catalogFileName(new Date(2026, 9, 21)), "zhuldyz-katalog-2026-10-21.pdf");
});

test("the catalog is a grid of two cards a row by default, or three in the compact layout", () => {
  const grid = cardRows(catalogDoc(catalog.products));
  assert.ok(grid.every((table) => table.widths.length === 3 && cardCells(table).length <= 2));
  assert.equal(grid.reduce((sum, table) => sum + cardCells(table).length, 0), catalog.products.length);
  assert.ok(grid.every((table) => table.dontBreakRows));

  const compact = cardRows(catalogDoc(catalog.products, { layout: "compact" }));
  assert.ok(compact.every((table) => table.widths.length === 5 && cardCells(table).length <= 3));
  assert.equal(compact.reduce((sum, table) => sum + cardCells(table).length, 0), catalog.products.length);
  assert.deepEqual(cardRows(catalogDoc(catalog.products, { layout: "unknown" })).map((table) => table.widths.length), grid.map((table) => table.widths.length));
});

test("every catalog card shows its photo in the same frame, with short texts and a sale badge", () => {
  const photo = "data:image/jpeg;base64,AAAA";
  const photos = Object.fromEntries(catalog.products.map((product) => [product.id, photo]));
  const long = { ...catalog.products[0], id: "long", oldPrice: catalog.products[0].price * 2, description: "Очень длинное описание. ".repeat(40), specs: Array(12).fill("Характеристика: значение") };
  const doc = catalogDoc([long, ...catalog.products], { photos: { ...photos, long: photo } });
  const images = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if (node.image) images.push(node);
      Object.values(node).forEach(walk);
    }
  };
  walk(doc.content.slice(1));
  assert.equal(images.length, catalog.products.length + 1);
  const { width, height } = CATALOG_LAYOUTS.grid.photo;
  assert.ok(images.every((image) => image.width === width && image.height === height));

  const first = texts(cardCells(cardRows(doc)[0])[0]).join("\n");
  assert.match(first, /−50\u00A0%/);
  const tiny = catalogDoc([{ ...catalog.products[0], price: 10000, oldPrice: 10040 }]);
  assert.doesNotMatch(texts(tiny.content).join("\n"), /−\d+\u00A0%/);
  assert.doesNotMatch(texts(catalogDoc(catalog.products, { whatsapp: "77778492164" }).content[0]).join("\n"), /WhatsApp ·/);
  const description = first.split("\n").find((line) => line.startsWith("Очень длинное"));
  assert.ok(description.length <= CATALOG_LAYOUTS.grid.description + 1 && description.endsWith("…"));
  assert.equal((first.match(/Характеристика:/g) || []).length, CATALOG_LAYOUTS.grid.specs);
});

test("catalog pages after the cover carry a header and a numbered footer with contacts", () => {
  const doc = catalogDoc(catalog.products, { whatsapp: "77778492164", date: new Date(2026, 9, 22) });
  assert.equal(doc.header(1, 3), null);
  assert.equal(doc.footer(1, 3), null);
  assert.match(texts(doc.header(2, 3).table).join("\n"), /Магазин «Жулдыз» — Каталог продукции/);
  const footer = texts(doc.footer(2, 3)).join("\n");
  assert.match(footer, /Страница 2 из 3/);
  assert.match(footer, /\+7 777 849 21 64/);
  assert.ok(doc.background(1).canvas.length);
  assert.equal(doc.background(2), null);
});

test("every document is built from fresh objects, because pdfmake writes into what it prints", () => {
  const first = orderDoc(order);
  const second = catalogDoc(catalog.products);
  assert.notEqual(first.content[1], second.content[1]);
  assert.notEqual(first.content[0], orderDoc(order).content[0]);
  const layout = (doc) => doc.content.find((part) => part.table?.headerRows).layout;
  assert.notEqual(layout(first), layout(orderDoc(order)));
});

const company = {
  company_name: "ИП «Жулдыз»",
  bin_iin: "900101400123",
  iik: "KZ12722S000012345678",
  bank_name: "АО «Kaspi Bank»",
  bik: "CASPKZKA",
  kbe: "19",
  company_address: "г. Алматы, ул. Толе би, 100",
  company_phone: "",
  is_vat_payer: true,
  vat_rate: 12
};

const invoiceOrder = {
  ...order,
  company: "ТОО «Ромашка»",
  bin: "123456789012",
  address: "г. Алматы,ул. Абая 10",
  items: [
    { id: "p1", name: "Матрас «Баланс»", size: "160*200", qty: 2, price: 191700, currency: "KZT" },
    { id: "p5", name: "Подушка  «Шея»", size: "", qty: 3, price: 24900, currency: "KZT" }
  ]
};

test("an amount is written out in words, with tenge and tiyn", () => {
  assert.equal(amountInWords(50000), "Пятьдесят тысяч тенге 00 тиын");
  assert.equal(amountInWords(0), "Ноль тенге 00 тиын");
  assert.equal(amountInWords(1), "Один тенге 00 тиын");
  assert.equal(amountInWords(21), "Двадцать один тенге 00 тиын");
  assert.equal(amountInWords(112), "Сто двенадцать тенге 00 тиын");
  assert.equal(amountInWords(1001), "Одна тысяча один тенге 00 тиын");
  assert.equal(amountInWords(2000), "Две тысячи тенге 00 тиын");
  assert.equal(amountInWords(5000), "Пять тысяч тенге 00 тиын");
  assert.equal(amountInWords(11000), "Одиннадцать тысяч тенге 00 тиын");
  assert.equal(amountInWords(22000), "Двадцать две тысячи тенге 00 тиын");
  assert.equal(amountInWords(778100), "Семьсот семьдесят восемь тысяч сто тенге 00 тиын");
  assert.equal(amountInWords(1234567.89), "Один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь тенге 89 тиын");
  assert.equal(amountInWords(2000000000), "Два миллиарда тенге 00 тиын");
  assert.equal(amountInWords(1000000000000), "Один триллион тенге 00 тиын");
  assert.equal(amountInWords(83367.86), "Восемьдесят три тысячи триста шестьдесят семь тенге 86 тиын");
  assert.equal(amountInWords(0.05), "Ноль тенге 05 тиын");
});

test("VAT is the part of the total it makes up, counted in whole tiyn", () => {
  const items = invoiceOrder.items;
  assert.deepEqual(invoiceTotals(items, { is_vat_payer: true, vat_rate: 12 }), { total: 458100, vat: 49082.14 });
  assert.deepEqual(invoiceTotals(items, { is_vat_payer: false, vat_rate: 12 }), { total: 458100, vat: 0 });
  assert.deepEqual(invoiceTotals([{ price: 112, qty: 1 }], { is_vat_payer: true, vat_rate: 12 }), { total: 112, vat: 12 });
  assert.deepEqual(invoiceTotals([{ price: 116, qty: 1 }], { is_vat_payer: true, vat_rate: 16 }), { total: 116, vat: 16 });
  assert.deepEqual(invoiceTotals([{ price: 0.1, qty: 3 }], {}), { total: 0.3, vat: 0 });
  assert.deepEqual(invoiceTotals(undefined), { total: 0, vat: 0 });
  assert.equal(amount(49082.14), "49\u00A0082,14");
  assert.equal(amount(191700), "191\u00A0700,00");
});

test("an invoice carries the bank details, both parties, the goods and the totals with VAT", () => {
  const doc = invoiceDoc(invoiceOrder, { company, whatsapp: "77778492164" });
  const all = texts(doc.content).join("\n");
  for (const value of ["ИП «Жулдыз»", "БИН/ИИН 900101400123", "KZ12722S000012345678", "АО «Kaspi Bank»", "CASPKZKA", "Кбе", "19"]) assert.ok(all.includes(value), value);
  assert.match(all, /СЧЁТ НА ОПЛАТУ № 42 от 12 октября 2026/);
  assert.match(all, /г\. Алматы, ул\. Толе би, 100/);
  assert.match(all, /тел\.\u00A0\+7\u00A0777\u00A0849\u00A021\u00A064/);
  assert.match(all, /ТОО «Ромашка», БИН\/ИИН 123456789012, контактное лицо Айгуль Серикова, адрес доставки: г\. Алматы, ул\. Абая 10/);
  assert.match(all, /Матрас «Баланс», размер 160×200/);
  assert.match(all, /Подушка «Шея»/);
  assert.match(all, /383\u00A0400,00/);
  assert.match(all, /В том числе НДС \(12%\):\n49\u00A0082,14/);
  assert.match(all, /Всего к оплате:\n458\u00A0100,00/);
  assert.match(all, /Всего наименований 2, на сумму 458\u00A0100,00 ₸/);
  assert.match(all, /Четыреста пятьдесят восемь тысяч сто тенге 00 тиын/);
  assert.match(all, /Руководитель/);
  assert.match(all, /Главный бухгалтер/);
  assert.doesNotMatch(all, /Образец|Без НДС/);
  assert.equal(doc.watermark, undefined);
  assert.equal(doc.info.title, "Счёт на оплату № 42");

  const goods = doc.content.find((part) => part.table?.headerRows).table;
  assert.deepEqual(goods.body[0].map((cell) => cell.text), ["№", "Наименование товара", "Кол-во", "Ед. изм.", "Цена, ₸", "Сумма, ₸"]);
  assert.deepEqual(goods.body[1].map((cell) => cell.text), ["1", "Матрас «Баланс», размер 160×200", "2", "шт.", "191\u00A0700,00", "383\u00A0400,00"]);
  assert.equal(invoiceFileName(invoiceOrder), "schet-42-2026-10-12.pdf");

  const stamped = invoiceDoc({ ...invoiceOrder, createdAt: "2026-10-22T19:13:22.8880000+05:00" }, { company });
  assert.match(texts(stamped.content).join("\n"), /№ 42 от 22 октября 2026/);
});

test("the invoice is dated by the shop's day, whatever time zone the buyer's computer is in", () => {
  const zone = process.env.TZ;
  const late = { ...invoiceOrder, createdAt: "2026-10-22T23:40:05.1230000+05:00" };
  const early = { ...invoiceOrder, createdAt: "2026-10-23T00:20:00+05:00" };
  try {
    for (const tz of ["America/New_York", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = tz;
      assert.match(texts(invoiceDoc(late, { company }).content).join("\n"), /№ 42 от 22 октября 2026/, tz);
      assert.equal(invoiceFileName(late), "schet-42-2026-10-22.pdf", tz);
      assert.equal(invoiceFileName(early), "schet-42-2026-10-23.pdf", tz);
    }
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
  assert.equal(invoiceFileName({ number: 1, createdAt: "не дата" }).startsWith("schet-1-"), true);
});

test("a seller without VAT gets «Без НДС», a buyer without an organisation is named by the order", () => {
  const doc = invoiceDoc({ ...order, items: invoiceOrder.items }, { company: { ...company, is_vat_payer: false } });
  const all = texts(doc.content).join("\n");
  assert.match(all, /Без НДС/);
  assert.doesNotMatch(all, /В том числе НДС/);
  assert.match(all, /Покупатель:\nАйгуль Серикова, тел\./);
  assert.doesNotMatch(all, /контактное лицо|адрес доставки/);
});

test("an invoice without the seller's details is a marked sample filled with placeholders", () => {
  for (const saved of [undefined, null, {}, { ...company, iik: "" }]) {
    const doc = invoiceDoc(invoiceOrder, { company: saved, whatsapp: "77778492164" });
    const all = texts(doc.content).join("\n");
    assert.match(all, /Образец: реквизиты продавца ещё не заполнены/);
    assert.equal(doc.watermark.text, "ОБРАЗЕЦ");
    assert.equal(doc.watermark.font, "NotoSans");
  }
  assert.match(texts(invoiceDoc(invoiceOrder).content).join("\n"), /KZ000000000000000000/);
  const partial = companyDetails({ ...company, iik: " ", company_phone: "" }, "77778492164");
  assert.equal(partial.sample, true);
  assert.deepEqual(partial.missing, ["iik"]);
  assert.equal(partial.details.company_phone, "+7 777 849 21 64");
  assert.equal(companyDetails(company).sample, false);
  assert.equal(companyDetails({ ...company, vat_rate: "oops" }).details.vat_rate, 12);
});

test("only an order in tenge gets an invoice", () => {
  assert.equal(invoiceReady(invoiceOrder), true);
  assert.equal(invoiceReady({ items: [{ price: 1, qty: 1 }] }), true);
  assert.equal(invoiceReady({ items: [{ price: 1, qty: 1, currency: "USD" }] }), false);
  assert.equal(invoiceReady({ items: [] }), false);
  assert.equal(invoiceReady(null), false);
});

test("every invoice is built from fresh objects", () => {
  const first = invoiceDoc(invoiceOrder, { company });
  const second = invoiceDoc(invoiceOrder, { company });
  assert.notEqual(first.content[0], second.content[0]);
  assert.notEqual(first.content[0].layout, second.content[0].layout);
});

test("a catalog for one category lists only that category", () => {
  const doc = catalogDoc(catalog.products, { category: "Кровати" });
  const all = texts(doc.content).join("\n");
  assert.equal(doc.info.title, "Каталог: Кровати");
  assert.match(texts(doc.content[0]).join("\n"), /Кровати/);
  for (const product of catalog.products) {
    assert.equal(all.includes(product.name), product.category === "Кровати", product.name);
  }
  assert.match(texts(catalogDoc([], {}).content).join("\n"), /пока нет товаров/);
});
