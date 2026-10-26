import { line, normalizeSizes, readProfile, stock, widths } from "../../../shared/consultant/index.js";

// Above this size the catalog no longer fits the prompt comfortably and the model searches it with a tool instead.
const INLINE_LIMIT = 80;

const UNITS = { USD: "долларов", RUB: "рублей" };

function flat(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function productLine(product) {
  const old = product.oldPrice ? ` (было ${product.oldPrice})` : "";
  const specs = (product.specs || []).map(flat).filter(Boolean).join("; ");
  return [
    `- [${product.id}] ${flat(product.name)}`,
    flat(product.category),
    `${product.price} ${UNITS[product.currency] || "тенге"}${old}`,
    `размеры: ${normalizeSizes(product.sizes).join(", ")}`,
    stock(product),
    flat(product.description),
    specs ? `характеристики: ${specs}` : ""
  ].filter(Boolean).join(" | ");
}

function words(text) {
  return flat(text).toLowerCase().replace(/ё/g, "е").split(" ").filter((word) => word.length >= 3);
}

// Models compare sizes across a long catalog poorly, so the match is computed here and handed over as a fact.
function sizeHint(context) {
  const profile = readProfile(context.history);
  if (!profile.size) return "";
  const wanted = profile.sizeText || profile.size;
  const fits = context.catalog.products.filter((product) => widths(product).includes(profile.size)).map((product) => flat(product.name));
  if (!fits.length) return `Клиент просил размер ${wanted}. В этом размере в каталоге нет ни одной модели — скажи прямо и предложи уточнить у Жулдыз размер под заказ.`;
  return `Клиент просил размер ${wanted}. В этом размере есть только: ${fits.join(", ")}. Остальные модели в этом размере не выпускаются: не советуй их как подходящие. Если такая модель лучше по остальным признакам, одной фразой скажи, что нужного размера у неё нет и Жулдыз может уточнить под заказ.`;
}

const findProducts = {
  name: "find_products",
  description: "Поиск по каталогу: по словам, категории, размеру и наличию. Возвращает до 8 товаров с id.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Слова для поиска, например «латекс детский»." },
      category: { type: "string", description: "Матрасы, Кровати или Аксессуары." },
      size: { type: "string", description: "Размер, например 160×200." },
      inStockOnly: { type: "boolean" }
    }
  },
  run(args, context) {
    const query = words(args.query);
    const width = (String(args.size || "").match(/\d{2,3}/) || [])[0];
    const found = context.catalog.products.filter((product) => {
      const text = `${product.name} ${product.description} ${product.category} ${(product.specs || []).join(" ")}`.toLowerCase().replace(/ё/g, "е");
      if (args.category && !String(product.category).toLowerCase().includes(String(args.category).toLowerCase())) return false;
      if (args.inStockOnly && !product.inStock) return false;
      if (width && !normalizeSizes(product.sizes).some((size) => size.startsWith(width))) return false;
      return query.every((word) => text.includes(word.slice(0, Math.max(3, word.length - 2))));
    });
    return { total: found.length, products: found.slice(0, 8).map((product) => ({ id: product.id, line: line(product), description: flat(product.description).slice(0, 300) })) };
  }
};

export default {
  id: "catalog",

  prompt(context) {
    const products = context.catalog.products;
    const inline = products.length <= INLINE_LIMIT;
    const rules = [
      "Советуй только товары из каталога, с ценой, размером и наличием. Не выдумывай товары, скидки, сроки и стоимость доставки.",
      "Сначала уточни позу сна, вес и размер кровати, если их нет. Предлагай один-два варианта, не больше.",
      "Размер называй только так, как он записан у этой модели в строке «размеры». Перед ответом сверь: если клиенту нужен 160×200, а у модели только 180×200 — это другой размер, не предлагай её как подходящую.",
      "Если нужного размера в каталоге нет — прямо скажи об этом и предложи уточнить у Жулдыз размер под заказ. Не выдавай другой размер за подходящий.",
      "Как подбирать жёсткость: на боку — средне-жёсткий или мягче, слишком жёсткий давит плечо; на спине — средне-жёсткий или жёсткий; на животе и при весе от 95 кг — жёстче; ребёнку — только детский матрас. Жёсткость бери из описания товара.",
      "Пиши уверенно и последовательно: сначала сверь размер и жёсткость, потом отвечай; не поправляй себя посреди ответа.",
      "Id товара (в квадратных скобках) клиенту не пиши. Товары, которые советуешь в ответе, перечисли в поле products инструмента reply."
    ];
    const hint = sizeHint(context);
    if (hint) rules.push(hint);
    if (inline) return [...rules, "", "Каталог:", ...products.map(productLine)].join("\n");
    const categories = [...new Set(products.map((product) => flat(product.category)))].join(", ");
    return [...rules, `В каталоге ${products.length} товаров (категории: ${categories}). Ищи их инструментом find_products, не угадывай.`].join("\n");
  },

  tools: (context) => (context.catalog.products.length > INLINE_LIMIT ? [findProducts] : []),

  reply: {
    properties: {
      products: { type: "array", items: { type: "string" }, description: "Id товаров из каталога, которые ты советуешь в этом ответе (0–2)." }
    }
  },

  finalize(reply, answer, context) {
    const known = new Set(context.catalog.products.map((product) => String(product.id)));
    reply.text = reply.text.replace(/\s*\[([\w-]+)\]/g, (match, id) => (known.has(id) ? "" : match)).trim();
    const picked = context.consultant.cardsById(answer.products);
    reply.products = picked.length ? picked : context.consultant.cards(reply.text);
  }
};

export { findProducts };
