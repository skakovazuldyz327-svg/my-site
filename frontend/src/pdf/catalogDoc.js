import { COLORS, fileDay, money, SHOP_NAME, SHOP_SITE, SHOP_TAGLINE, shopPhone, shortDate, shorten, tidyItem, tidyText } from "./format.js";
import { LOGO_SVG } from "./logo.js";
import { FONT } from "./parts.js";

const PAGE = { width: 595.28, height: 841.89 };
const MARGINS = [40, 66, 40, 52];
const CONTENT_WIDTH = PAGE.width - MARGINS[0] - MARGINS[2];
const GAP = 10;
const BAND = 150;
const CARD_FILL = "#fbf8f2";
const BAND_TEXT = "#dfe3d6";

// "grid": two columns with the photo beside the text, about six cards a page.
// "compact": three columns with the photo on top, nine cards a page, for long catalogs.
// Text limits are in characters and keep every card of a layout the same height, so the rows stay even.
export const CATALOG_LAYOUTS = {
  grid: { columns: 2, padding: 10, photo: { width: 108, height: 108 }, name: 52, price: 15, sizes: 56, specs: 3, spec: 44, description: 85 },
  compact: { columns: 3, padding: 8, photo: { width: 146, height: 88 }, name: 44, price: 13, sizes: 34, specs: 2, spec: 30, description: 0 }
};

export const COVER_PHOTO = { width: CONTENT_WIDTH, height: 280 };

export const catalogLayout = (name) => CATALOG_LAYOUTS[name] || CATALOG_LAYOUTS.grid;

function groups(products) {
  const byCategory = new Map();
  for (const product of products) {
    const category = tidyText(product.category) || "Другое";
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push(product);
  }
  return [...byCategory];
}

function chunks(list, size) {
  const rows = [];
  for (let index = 0; index < list.length; index += size) rows.push(list.slice(index, index + size));
  return rows;
}

function goodsCount(count) {
  const tens = count % 100;
  const ones = count % 10;
  const word = tens >= 11 && tens <= 14 ? "товаров" : ones === 1 ? "товар" : ones >= 2 && ones <= 4 ? "товара" : "товаров";
  return `${count}\u00A0${word}`;
}

// A highlighted run of text rather than a small table: a table's fill inside a filled card row is painted over.
const plaque = (text, color, fill) => ({ text: `\u00A0\u00A0${text}\u00A0\u00A0`, color, background: fill, bold: true, fontSize: 7.5 });

// Pieces on hand are not printed: the file goes to buyers and colleagues.
function badges(product) {
  const runs = [product.inStock ? plaque("В наличии", COLORS.olive, "#e4e9dd") : plaque("Под заказ", COLORS.clay, "#f6e3dc")];
  const price = Number(product.price);
  const old = Number(product.oldPrice);
  const discount = old > price && price > 0 ? Math.round((1 - price / old) * 100) : 0;
  if (discount >= 1) runs.push({ text: "\u00A0\u00A0", fontSize: 7.5 }, plaque(`−${discount}\u00A0%`, "#ffffff", COLORS.clay));
  return { text: runs };
}

function priceLine(product, size) {
  const parts = [{ text: money(product.price, product.currency), bold: true, fontSize: size }];
  if (Number(product.oldPrice) > Number(product.price)) {
    parts.push({ text: "  ", fontSize: size - 5 }, { text: money(product.oldPrice, product.currency), decoration: "lineThrough", color: COLORS.muted, fontSize: size - 5 });
  }
  return { text: parts };
}

const labelled = (label, value) => ({ text: [{ text: `${label} `, color: COLORS.muted }, value], fontSize: 8 });

function facts(product, layout) {
  const lines = [];
  if (product.sku) lines.push(labelled("Арт.", tidyText(product.sku)));
  const sizes = (product.sizes || []).map(tidyText).filter(Boolean);
  if (sizes.length) lines.push(labelled(sizes.length > 1 ? "Размеры:" : "Размер:", shorten(sizes.join(", "), layout.sizes)));
  return lines;
}

function specs(product, layout) {
  return (product.specs || [])
    .map(tidyItem)
    .filter(Boolean)
    .slice(0, layout.specs)
    .map((spec) => {
      const text = shorten(spec, layout.spec);
      const colon = text.indexOf(": ");
      return colon > 0 && colon < 30 ? { text: [{ text: text.slice(0, colon + 2), color: COLORS.muted }, text.slice(colon + 2)] } : { text };
    });
}

function photoNode(photo, { width, height }) {
  if (photo) return { image: photo, width, height };
  return { width, canvas: [{ type: "rect", x: 0, y: 0, w: width, h: height, color: COLORS.linen }] };
}

const spaced = (nodes, top) => nodes.map((node, index) => ({ ...node, margin: [0, index ? top : 0, 0, 0] }));

// photo: an image data URL already cut to layout.photo, so every card shows the same frame.
function card(product, photo, layout) {
  const name = { text: shorten(tidyText(product.name), layout.name), bold: true, fontSize: layout.columns > 2 ? 10 : 11, lineHeight: 1.1 };
  const head = spaced([name, priceLine(product, layout.price), badges(product), ...facts(product, layout)], 4);
  const list = specs(product, layout);
  const description = layout.description ? shorten(tidyText(product.description), layout.description) : "";

  const stack =
    layout.columns > 2
      ? [{ ...photoNode(photo, layout.photo), margin: [0, 0, 0, 8] }, ...head]
      : [{ columns: [photoNode(photo, layout.photo), { width: "*", stack: head }], columnGap: 10 }];
  if (list.length) stack.push({ ul: list, fontSize: 8, markerColor: COLORS.muted, margin: [0, layout.columns > 2 ? 5 : 8, 0, 0] });
  if (description) stack.push({ text: description, fontSize: 8, color: COLORS.muted, margin: [0, 4, 0, 0] });
  return stack;
}

// One table row per row of cards: cells of a row share their height, and the narrow empty columns are the gaps.
function cardRow(cards, layout) {
  const widths = [];
  const cells = [];
  const none = [false, false, false, false];
  for (let column = 0; column < layout.columns; column += 1) {
    if (column) {
      widths.push(GAP);
      cells.push({ text: "", border: none });
    }
    widths.push("*");
    cells.push(cards[column] ? { stack: cards[column], fillColor: CARD_FILL, lineHeight: 1.1, border: [true, true, true, true] } : { text: "", border: none });
  }
  const padding = (column) => (column % 2 ? 0 : layout.padding);
  return {
    table: { widths, body: [cells], dontBreakRows: true },
    layout: {
      hLineWidth: () => 0.6,
      vLineWidth: () => 0.6,
      hLineColor: () => COLORS.line,
      vLineColor: () => COLORS.line,
      paddingLeft: padding,
      paddingRight: padding,
      paddingTop: () => layout.padding,
      paddingBottom: () => layout.padding
    }
  };
}

function categoryHeading(name, count) {
  return {
    stack: [
      { text: [{ text: name, fontSize: 13, bold: true, color: COLORS.olive }, { text: `   ${goodsCount(count)}`, fontSize: 9, color: COLORS.muted }], lineHeight: 1 },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 0.8, lineColor: COLORS.line }], margin: [0, 4, 0, 0] }
    ],
    margin: [0, 0, 0, 7]
  };
}

function cover({ whatsapp, site, date, category, sections, hero }) {
  const phone = shopPhone(whatsapp);
  const contacts = phone
    ? [
        { text: "Заказ и консультация", fontSize: 9, color: BAND_TEXT },
        { text: phone, fontSize: 22, bold: true, color: "#ffffff", margin: [0, 2, 0, 0] },
        { text: ["WhatsApp", site].filter(Boolean).join(" · "), fontSize: 10, color: BAND_TEXT, margin: [0, 2, 0, 0] }
      ]
    : [{ text: [SHOP_NAME, site].filter(Boolean).join(" · "), fontSize: 14, bold: true, color: "#ffffff" }];
  const summary = sections.map(([name, items]) => `${name} — ${items.length}`).join("    ·    ");

  return {
    pageBreak: "after",
    stack: [
      {
        columns: [
          { svg: LOGO_SVG, width: 58 },
          {
            width: "*",
            stack: [
              { text: SHOP_NAME, fontSize: 30, bold: true, lineHeight: 1 },
              { text: SHOP_TAGLINE, fontSize: 11, color: COLORS.muted, margin: [0, 4, 0, 0] }
            ],
            margin: [14, 4, 0, 0]
          }
        ]
      },
      hero ? { image: hero, width: COVER_PHOTO.width, height: COVER_PHOTO.height, margin: [0, 34, 0, 0] } : { text: "", margin: [0, 120, 0, 0] },
      { text: "КАТАЛОГ ТОВАРОВ", fontSize: 34, bold: true, characterSpacing: 1.5, margin: [0, 30, 0, 0] },
      category ? { text: category, fontSize: 18, bold: true, color: COLORS.olive, margin: [0, 2, 0, 0] } : { text: "" },
      { text: `Актуально на ${shortDate(date)}`, fontSize: 13, color: COLORS.muted, margin: [0, 6, 0, 0] },
      summary ? { text: summary, fontSize: 10, color: COLORS.olive, margin: [0, 14, 0, 0] } : { text: "" },
      // An absolutely placed block must end above the bottom margin, or pdfmake leaves its last lines out.
      { absolutePosition: { x: MARGINS[0], y: PAGE.height - BAND + 30 }, lineHeight: 1, stack: contacts }
    ]
  };
}

function pageHeader(date) {
  return (currentPage) =>
    currentPage === 1
      ? null
      : {
          margin: [MARGINS[0], 22, MARGINS[2], 0],
          table: {
            widths: [14, "*", "auto"],
            body: [
              [
                { svg: LOGO_SVG, width: 14 },
                { text: `Магазин «${SHOP_NAME}» — Каталог продукции`, bold: true, fontSize: 9, margin: [0, 1, 0, 0] },
                { text: `Актуально на ${shortDate(date)}`, fontSize: 8, color: COLORS.muted, margin: [0, 2, 0, 0] }
              ]
            ]
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: () => COLORS.linen,
            paddingLeft: (column) => (column === 0 ? 8 : 6),
            paddingRight: (column) => (column === 2 ? 8 : 0),
            paddingTop: () => 5,
            paddingBottom: () => 5
          }
        };
}

function pageFooter(whatsapp, site) {
  const phone = shopPhone(whatsapp);
  const contacts = [SHOP_NAME, phone && `WhatsApp ${phone}`, site].filter(Boolean).join(" · ");
  return (currentPage, pageCount) =>
    currentPage === 1
      ? null
      : {
          margin: [MARGINS[0], 20, MARGINS[2], 0],
          columns: [
            { text: contacts, color: COLORS.muted },
            { text: `Страница ${currentPage} из ${pageCount}`, width: "auto", alignment: "right", color: COLORS.muted }
          ],
          fontSize: 8
        };
}

// photos: product id -> image data URL cut to the layout's photo frame; hero: cover photo cut to COVER_PHOTO.
// A category heading is kept on the same page as its first row of cards.
export function catalogDoc(products, { whatsapp = "", site = SHOP_SITE, photos = {}, hero = null, category = "", layout = "grid", date = new Date() } = {}) {
  const list = (Array.isArray(products) ? products : []).filter((product) => !category || product.category === category);
  const grid = catalogLayout(layout);
  const sections = groups(list);
  const title = category ? `Каталог: ${category}` : "Каталог товаров";

  const content = [cover({ whatsapp, site, date, category, sections, hero })];
  if (!list.length) content.push({ text: "В каталоге пока нет товаров.", color: COLORS.muted });
  for (const [name, items] of sections) {
    chunks(items, grid.columns).forEach((row, index) => {
      const cards = cardRow(row.map((product) => card(product, photos[product.id], grid)), grid);
      content.push({ stack: index ? [cards] : [categoryHeading(name, items.length), cards], unbreakable: true, margin: [0, 0, 0, GAP] });
    });
  }

  return {
    pageSize: "A4",
    pageMargins: MARGINS,
    info: { title, author: SHOP_NAME, creator: SHOP_NAME },
    defaultStyle: { font: FONT, fontSize: 10, color: COLORS.ink, lineHeight: 1.2 },
    background: (currentPage) =>
      currentPage === 1
        ? {
            canvas: [
              { type: "rect", x: 0, y: 0, w: PAGE.width, h: PAGE.height, color: COLORS.linen },
              { type: "rect", x: 0, y: PAGE.height - BAND, w: PAGE.width, h: BAND, color: COLORS.olive }
            ]
          }
        : null,
    header: pageHeader(date),
    footer: pageFooter(whatsapp, site),
    content
  };
}

export const catalogFileName = (date = new Date()) => `zhuldyz-katalog-${fileDay(date)}.pdf`;
