import { formatPrice, openWhatsApp, productById, productCurrency, whatsapp } from "./catalog.js";
import { storageGet, storageRemove, storageSet } from "./storage.js";

export const BAG_KEY = "zhuldyz-order";
const CLIENT_KEY = "zhuldyz-client";
const PENDING_KEY = "zhuldyz-pending-orders";

function validItem(item) {
  const product = productById(item.id);
  if (!product) return false;
  const sizes = product.sizes || [];
  return sizes.length ? sizes.includes(item.size) : !item.size;
}

// The server takes this many lines of an order, so the bag holds no more and the buyer is told instead of losing lines.
export const MAX_BAG_LINES = 50;

function readBag() {
  try {
    const data = JSON.parse(storageGet(BAG_KEY));
    if (!Array.isArray(data)) return [];
    return data
      .filter((item) => item && item.id && Number(item.qty) > 0)
      .map((item) => ({
        id: String(item.id),
        size: String(item.size || ""),
        qty: Math.min(20, Math.max(1, Math.round(Number(item.qty)))),
        ...(item.name ? { name: String(item.name).slice(0, 200) } : {}),
      }));
  } catch {
    return [];
  }
}

// dropped: lines whose product or size the admin removed since they were added; the buyer has to be told about them.
export function checkBag() {
  const items = readBag();
  return { bag: items.filter(validItem), dropped: items.filter((item) => !validItem(item)) };
}

export const loadBag = () => checkBag().bag;

export function droppedNote(dropped) {
  const lines = dropped.map((item) => {
    const product = productById(item.id);
    if (product) return `${product.name}${item.size ? ` ${item.size}` : ""} — размер изменился, выберите его заново`;
    return `${item.name || "Товар"} — его больше нет на сайте`;
  });
  return `Убрали из корзины: ${lines.join("; ")}.`;
}

// null: the bag is full. The name is kept so a line can still be named after its product leaves the site.
export function addLine(bag, { id, size, qty }) {
  const existing = bag.find((item) => item.id === id && item.size === size);
  if (existing) return bag.map((item) => (item === existing ? { ...item, qty: Math.min(20, item.qty + qty) } : item));
  if (bag.length >= MAX_BAG_LINES) return null;
  const name = productById(id)?.name;
  return [...bag, { id, size, qty, ...(name ? { name } : {}) }];
}

export const fullBagNote = `В заказе уже ${MAX_BAG_LINES} позиций — оформите его, а остальное добавьте в следующий заказ.`;

export function saveBag(bag) {
  storageSet(BAG_KEY, JSON.stringify(bag));
}

export function loadClient() {
  try {
    return JSON.parse(storageGet(CLIENT_KEY)) || {};
  } catch {
    return {};
  }
}

const oneLine = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

// buyer: the optional details for an invoice — organisation, BIN/IIN and delivery address.
export function validateClient(rawName, rawPhone, buyer = {}) {
  const name = rawName.trim().replace(/\s+/g, " ");
  const phone = rawPhone.trim();
  const digits = phone.replace(/\D/g, "");
  if (name.length < 2) return { error: "Напишите, как к вам обращаться.", field: "name" };
  if (digits.length < 10 || digits.length > 15) {
    return { error: "Проверьте номер телефона — нужно 10–15 цифр.", field: "phone" };
  }
  const bin = String(buyer.bin ?? "").replace(/\s/g, "");
  if (bin && !/^\d{12}$/.test(bin)) return { error: "БИН / ИИН — это 12 цифр. Если не знаете его, оставьте поле пустым.", field: "bin" };
  return { client: { name, phone, company: oneLine(buyer.company), bin, address: oneLine(buyer.address) } };
}

function orderLine(product, size, qty) {
  const sizeText = size ? ` ${size}` : "";
  const count = qty > 1 ? `, ${qty} шт.` : "";
  return `${product.name}${sizeText}${count} Цена ${formatPrice(product.price, product)}`;
}

export function orderTotals(items) {
  const totals = new Map();
  items.forEach((item) => {
    const product = productById(item.id);
    if (!product) return;
    const code = productCurrency(product);
    totals.set(code, (totals.get(code) || 0) + product.price * item.qty);
  });
  return [...totals].map(([code, sum]) => formatPrice(sum, { currency: code })).join(" · ");
}

function orderMessage(items, { name, phone, company, bin, address }) {
  const lines = items.flatMap((item) => {
    const product = productById(item.id);
    return product ? [orderLine(product, item.size, item.qty)] : [];
  });
  return [
    "Здравствуйте, Жулдыз! Как у вас дела?",
    `Хочу у вас заказать ${lines.join("\n")}`,
    `Итого: ${orderTotals(items)}`,
    `Имя: ${name}`,
    `Телефон: ${phone}`,
    ...(company ? [`Организация: ${company}`] : []),
    ...(bin ? [`БИН/ИИН: ${bin}`] : []),
    ...(address ? [`Адрес доставки: ${address}`] : []),
  ].join("\n");
}

function orderKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

// Orders the server never confirmed are given up after two days, so the queue cannot grow without end.
const PENDING_MS = 2 * 24 * 60 * 60 * 1000;

function loadPending() {
  try {
    const list = JSON.parse(storageGet(PENDING_KEY) || "[]");
    const since = Date.now() - PENDING_MS;
    return Array.isArray(list) ? list.filter((entry) => entry?.body?.key && Number(entry.time) > since) : [];
  } catch {
    return [];
  }
}

function savePending(list) {
  if (list.length) storageSet(PENDING_KEY, JSON.stringify(list.slice(-20)));
  else storageRemove(PENDING_KEY);
}

// A 4xx answer will not change on a retry; a 5xx or a network error keeps the order for the next visit.
// Resolves to { state, answer }: "saved" with the server's answer ({ number, invoice }), "rejected" when the server refused
// the order for good, "queued" when it is kept to be sent again.
function deliver(body) {
  return fetch("/api/orders", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  })
    .then(async (response) => {
      const final = response.status < 500 && response.status !== 408 && response.status !== 429;
      if (final) savePending(loadPending().filter((entry) => entry.body.key !== body.key));
      if (!response.ok) return { state: final ? "rejected" : "queued", answer: null };
      return { state: "saved", answer: await response.json().catch(() => null) };
    })
    .catch(() => ({ state: "queued", answer: null }));
}

export function retryPendingOrders() {
  if (location.protocol === "file:") return;
  const list = loadPending();
  savePending(list);
  list.forEach((entry) => deliver(entry.body));
}

export const SEND_FAILED = "Не получилось отправить заказ. Ваши данные и товары сохранены — нажмите ещё раз или напишите Жулдыз в WhatsApp.";

// Resolves to { state, invoice }: the state of deliver ("local" for a page opened as a file) and the order as the server
// saved it, for the invoice (null when the server did not confirm it).
export function sendOrder(items, client) {
  const { name, phone, company = "", bin = "", address = "" } = client;
  storageSet(CLIENT_KEY, JSON.stringify({ name, phone, company, bin, address }));
  const url = `https://wa.me/${whatsapp}?text=${encodeURIComponent(orderMessage(items, client))}`;
  let saved = Promise.resolve({ state: "local", invoice: null });
  if (location.protocol !== "file:") {
    // Name and price travel too, so the order is still recorded if the admin removes the product meanwhile.
    const body = {
      key: orderKey(),
      name,
      phone,
      ...(company ? { company } : {}),
      ...(bin ? { bin } : {}),
      ...(address ? { address } : {}),
      items: items.map(({ id, size, qty }) => {
        const product = productById(id);
        return { id, size, qty, name: product?.name || "", price: product?.price ?? 0, currency: productCurrency(product) };
      }),
    };
    savePending([...loadPending(), { body, time: Date.now() }]);
    saved = deliver(body).then(({ state, answer }) => ({ state, invoice: answer?.invoice || null }));
  }
  openWhatsApp(url);
  return saved;
}
