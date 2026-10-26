import { COLORS, fileDay, longDate, money, shopPhone } from "./format.js";
import { baseDoc, rule, shopHeader } from "./parts.js";

const PHOTO = 42;

function orderTotals(order) {
  const saved = Object.entries(order.totals || {}).filter(([, sum]) => Number.isFinite(Number(sum)));
  if (saved.length) return saved;
  const totals = {};
  for (const line of order.items || []) {
    const currency = line.currency || "KZT";
    totals[currency] = (totals[currency] || 0) + (Number(line.price) || 0) * (Number(line.qty) || 0);
  }
  return Object.entries(totals);
}

function lineRow(line, index, photo) {
  const qty = Number(line.qty) || 0;
  const details = [{ text: line.name || "Товар", bold: true }];
  if (line.size) details.push({ text: `Размер: ${line.size}`, fontSize: 9, color: COLORS.muted });
  if (typeof line.fromStock === "number" && line.fromStock < qty) {
    details.push({ text: `Под заказ: ${qty - line.fromStock} шт.`, fontSize: 9, color: COLORS.clay });
  }
  return [
    { text: String(index + 1), color: COLORS.muted },
    photo ? { image: photo, fit: [PHOTO, PHOTO] } : { text: "" },
    { stack: details },
    { text: `${qty} шт.`, alignment: "right", noWrap: true },
    { text: money(line.price, line.currency), alignment: "right", noWrap: true },
    { text: money((Number(line.price) || 0) * qty, line.currency), alignment: "right", bold: true, noWrap: true }
  ];
}

const tableLayout = () => ({
  hLineWidth: (row, node) => (row === 0 || row === node.table.body.length ? 0 : 0.6),
  vLineWidth: () => 0,
  hLineColor: () => COLORS.line,
  paddingTop: () => 6,
  paddingBottom: () => 6,
  paddingLeft: (column) => (column === 0 ? 0 : 5),
  paddingRight: (column, node) => (column === node.table.widths.length - 1 ? 0 : 5),
  fillColor: (row) => (row === 0 ? COLORS.linen : null)
});

// photos: product id -> image data URL (missing when the product has no photo or is gone from the catalog).
export function orderDoc(order, { whatsapp = "", photos = {} } = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  const head = ["№", "", "Товар", "Кол-во", "Цена", "Сумма"].map((text) => ({ text, bold: true, fontSize: 9, color: COLORS.muted }));
  const body = [head, ...items.map((line, index) => lineRow(line, index, photos[line.id]))];
  const phone = shopPhone(whatsapp);

  return baseDoc({
    title: `Заказ № ${order.number}`,
    whatsapp,
    content: [
      shopHeader(whatsapp),
      rule(),
      { text: `Заказ № ${order.number}`, fontSize: 18, bold: true },
      { text: `от ${longDate(order.createdAt)}`, color: COLORS.muted, margin: [0, 2, 0, 14] },
      {
        table: {
          widths: [70, "*"],
          body: [
            [{ text: "Покупатель", color: COLORS.muted }, { text: order.name || "—", bold: true }],
            [{ text: "Телефон", color: COLORS.muted }, { text: order.phone || "—" }]
          ]
        },
        layout: "noBorders",
        margin: [0, 0, 0, 16]
      },
      {
        table: { headerRows: 1, dontBreakRows: true, widths: [16, PHOTO, "*", 42, 72, 78], body },
        layout: tableLayout()
      },
      {
        margin: [0, 12, 0, 0],
        stack: orderTotals(order).map(([currency, sum]) => ({
          columns: [{ text: "Итого:", width: "*", alignment: "right", fontSize: 12 }, { text: money(sum, currency), width: 110, alignment: "right", fontSize: 14, bold: true }],
          margin: [0, 2, 0, 0]
        }))
      },
      {
        text: phone
          ? `Спасибо за заказ! Если появятся вопросы, напишите нам в WhatsApp: ${phone}`
          : "Спасибо за заказ!",
        color: COLORS.olive,
        margin: [0, 28, 0, 0]
      }
    ]
  });
}

export const orderFileName = (order) => `zakaz-${order.number}-${fileDay(order.createdAt)}.pdf`;
