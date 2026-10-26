import { hasWord, money, norm } from "./text.js";

const aliases = [
  ["pmuwtba7c", ["баланс"]],
  ["p2", ["латекс нео", "нео"]],
  ["p8", ["кокос хард", "хард"]],
  ["p7", ["бобек", "бөбек", "бебек"]],
  ["p3", ["тала"]],
  ["p4", ["сафия"]],
  ["p9", ["айсулу"]],
  ["p10", ["ламели", "ламель"]],
  ["p5", ["шея"]],
  ["p6", ["наматрасник"]],
  ["p11", ["бамбук"]],
  ["p12", ["латекс классик"]]
];

function nameKey(product) {
  const name = String(product.name || "");
  const match = name.match(/[«"“„]([^»"”“]+)[»"”“]/);
  if (match) return norm(match[1]);
  const words = norm(name).split(" ");
  return words.length > 1 ? words.slice(1).join(" ") : "";
}

function oneSize(size) {
  if (/[×xх]/i.test(size) && !size.includes(".") && !size.includes(",")) {
    return size.replace(/[xх*]/gi, "×");
  }
  const text = size.replace(/\s/g, "").replace(/,/g, ".").replace(/[xх*]/gi, "×");
  const match = text.match(/(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)(?:×(\d+(?:\.\d+)?))?/);
  if (!match) return size;
  const num = (value) => (value.includes(".") ? String(Math.round(parseFloat(value) * 100)) : value);
  return [num(match[1]), num(match[2]), match[3] ? num(match[3]) : ""].filter(Boolean).join("×");
}

export function normalizeSizes(sizes) {
  const raw = (sizes || []).map((size) => String(size).trim()).filter(Boolean);
  if (raw.length >= 3 && /^\d$/.test(raw[0]) && raw[1].includes("*")) {
    const parts = raw[1].split("*");
    const width = String(Number(raw[0] + parts[0]));
    const height = String(Number((parts[1] || "") + raw[2]));
    return [`${width}×${height}`];
  }
  return raw.map(oneSize);
}

export function widths(product) {
  return normalizeSizes(product.sizes).map((size) => (String(size).match(/^(\d+)/) || [])[1] || "");
}

// With counted stock the answer depends on the size: a model can be on hand in 160×200 and made to order in 180×200.
export function stock(product) {
  const sizes = Object.entries(product.stock || {});
  if (!sizes.length || (sizes.length === 1 && sizes[0][0] === "")) return product.inStock ? "в наличии" : "под заказ";
  const have = sizes.filter(([, qty]) => qty > 0).map(([size]) => size);
  if (have.length === sizes.length) return "в наличии";
  if (!have.length) return "под заказ";
  const order = sizes.filter(([, qty]) => !(qty > 0)).map(([size]) => size);
  return `в наличии: ${have.join(", ")}; под заказ: ${order.join(", ")}`;
}

export function brief(product) {
  const text = String(product.description || "").trim();
  if (text.length <= 140) return text;
  return `${text.slice(0, 137).replace(/\s+\S*$/, "")}…`;
}

export function line(product) {
  const sizes = normalizeSizes(product.sizes);
  const size = sizes.length ? `, ${sizes.join(", ")}` : "";
  return `${product.name} — ${money(product.price, product.currency)}${size}, ${stock(product)}`;
}

export function card(product) {
  return {
    id: product.id,
    name: product.name,
    image: typeof product.image === "string" && product.image.startsWith("images/") ? product.image : "",
    price: money(product.price, product.currency),
    meta: [normalizeSizes(product.sizes).join(", "), stock(product)].filter(Boolean).join(" · "),
    href: `product.html?id=${encodeURIComponent(product.id)}`
  };
}

export function byId(products, id) {
  return products.find((product) => product.id === id);
}

export function blob(product) {
  return norm(`${product.name} ${product.description} ${product.category}`);
}

export function isChildProduct(product) {
  return /дет|бобек|бөбек|гипоаллер/.test(blob(product));
}

export function mattresses(products) {
  return products.filter((product) => norm(product.category) === "матрасы");
}

export function beds(products) {
  return products.filter((product) => norm(product.category) === "кровати" && !/ламел|основан/.test(norm(product.name)));
}

export function feel(product) {
  const text = blob(product);
  if (/хард/.test(text) || (/жестк|тверд/.test(text) && !/средне/.test(text))) return "hard";
  if (/средне/.test(text)) return "medium";
  if (/латекс/.test(text)) return "soft";
  return "";
}

export function mentioned(products, text) {
  const found = [];
  const add = (product) => {
    if (product && !found.includes(product)) found.push(product);
  };
  aliases.forEach(([id, keys]) => {
    if (keys.some((key) => hasWord(text, key))) add(byId(products, id));
  });
  products.forEach((product) => {
    const key = nameKey(product);
    if (key.length >= 3 && hasWord(text, key)) add(product);
  });
  if (hasWord(text, "латекс") && !found.some((product) => product.id === "p2" || product.id === "p12")) {
    const ids = /подуш/.test(text) ? ["p12"] : /матрас/.test(text) ? ["p2"] : ["p2", "p12"];
    ids.forEach((id) => add(byId(products, id)));
  }
  if (hasWord(text, "защит") && /наматрас|чехол|матрас/.test(text)) add(byId(products, "p6"));
  return found;
}
