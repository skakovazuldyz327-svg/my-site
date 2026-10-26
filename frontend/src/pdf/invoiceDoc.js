import { companyDetails } from "./company.js";
import { amount, COLORS, fileDay, longDate, tidyText } from "./format.js";
import { baseDoc, FONT } from "./parts.js";

const ONES = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_FEMININE = ["", "одна", "две", ...ONES.slice(3)];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
const SCALES = [
  { forms: null },
  { forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
  { forms: ["миллион", "миллиона", "миллионов"] },
  { forms: ["миллиард", "миллиарда", "миллиардов"] },
  { forms: ["триллион", "триллиона", "триллионов"] }
];

function plural(count, [one, few, many]) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 19) return many;
  if (ones === 1) return one;
  return ones >= 2 && ones <= 4 ? few : many;
}

function triad(count, feminine) {
  const rest = count % 100;
  const words = [HUNDREDS[Math.floor(count / 100)]];
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else words.push(TENS[Math.floor(rest / 10)], (feminine ? ONES_FEMININE : ONES)[rest % 10]);
  return words.filter(Boolean);
}

const tiynOf = (value) => Math.round((Number(value) || 0) * 100);

// 50000 reads "Пятьдесят тысяч тенге 00 тиын": тенге and тиын keep one form whatever the number.
export function amountInWords(value) {
  const tiyn = Math.abs(tiynOf(value));
  let rest = Math.floor(tiyn / 100);
  const words = [];
  for (let scale = 0; rest > 0 && scale < SCALES.length; scale += 1, rest = Math.floor(rest / 1000)) {
    const count = rest % 1000;
    if (!count) continue;
    const { forms, feminine } = SCALES[scale];
    words.unshift(...triad(count, feminine), ...(forms ? [plural(count, forms)] : []));
  }
  const text = `${words.length ? words.join(" ") : "ноль"} тенге ${String(tiyn % 100).padStart(2, "0")} тиын`;
  return text[0].toUpperCase() + text.slice(1);
}

// Prices already include VAT, so it is the part of the total that VAT makes up: total × rate / (100 + rate).
// Counted in whole tiyn, so the printed sums add up exactly.
export function invoiceTotals(items, { is_vat_payer = false, vat_rate = 12 } = {}) {
  const total = (items || []).reduce((sum, line) => sum + tiynOf(line.price) * (Number(line.qty) || 0), 0);
  const vat = is_vat_payer ? Math.round((total * vat_rate) / (100 + vat_rate)) : 0;
  return { total: total / 100, vat: vat / 100 };
}

// The invoice is in tenge; an order with a line in another currency gets none.
export const invoiceReady = (order) =>
  Array.isArray(order?.items) && order.items.length > 0 && order.items.every((line) => !line.currency || line.currency === "KZT");

const gridLayout = (headerFill) => ({
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => COLORS.ink,
  vLineColor: () => COLORS.ink,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  fillColor: (row) => (headerFill && row === 0 ? COLORS.linen : null)
});

const plainLayout = (left, right, bottom) => ({
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => left,
  paddingRight: () => right,
  paddingTop: () => 2,
  paddingBottom: () => bottom
});

const caption = (text) => ({ text, fontSize: 8, color: COLORS.muted });

function bankTable(seller) {
  return {
    table: {
      widths: ["*", 150, 46],
      body: [
        [
          { stack: [caption("Бенефициар (получатель)"), { text: seller.company_name, bold: true }, `БИН/ИИН ${seller.bin_iin}`] },
          { stack: [caption("ИИК"), { text: seller.iik, bold: true }] },
          { stack: [caption("Кбе"), { text: seller.kbe, bold: true }] }
        ],
        [
          { stack: [caption("Банк бенефициара"), seller.bank_name] },
          { stack: [caption("БИК"), { text: seller.bik, bold: true }] },
          { text: "" }
        ]
      ]
    },
    layout: gridLayout(false),
    margin: [0, 0, 0, 18]
  };
}

const party = (title, parts) => [{ text: title, bold: true }, { text: parts.filter(Boolean).join(", ") }];
const phoneText = (phone) => (phone ? `тел.\u00A0${String(phone).trim().replace(/\s+/g, "\u00A0")}` : "");

function partiesTable(seller, order) {
  const company = tidyText(order.company);
  const address = tidyText(order.address);
  return {
    table: {
      widths: [128, "*"],
      body: [
        party("Поставщик (продавец):", [seller.company_name, `БИН/ИИН ${seller.bin_iin}`, seller.company_address, phoneText(seller.company_phone)]),
        party("Покупатель:", [
          company || order.name || "—",
          order.bin && `БИН/ИИН ${order.bin}`,
          company && order.name && `контактное лицо ${order.name}`,
          address && `адрес доставки: ${address}`,
          phoneText(order.phone)
        ])
      ]
    },
    layout: plainLayout(0, 6, 4),
    margin: [0, 0, 0, 14]
  };
}

const itemName = (line) => tidyText(line.size ? `${line.name}, размер ${line.size}` : line.name) || "Товар";

function goodsTable(items) {
  const head = ["№", "Наименование товара", "Кол-во", "Ед. изм.", "Цена, ₸", "Сумма, ₸"].map((text) => ({ text, bold: true, fontSize: 9, alignment: "center" }));
  const rows = items.map((line, index) => {
    const qty = Number(line.qty) || 0;
    return [
      { text: String(index + 1), alignment: "center" },
      { text: itemName(line) },
      { text: String(qty), alignment: "center" },
      { text: "шт.", alignment: "center" },
      { text: amount(line.price), alignment: "right", noWrap: true },
      { text: amount((tiynOf(line.price) * qty) / 100), alignment: "right", noWrap: true }
    ];
  });
  return {
    table: { headerRows: 1, dontBreakRows: true, widths: [18, "*", 40, 40, 72, 80], body: [head, ...rows] },
    layout: gridLayout(true)
  };
}

const rateText = (rate) => String(rate).replace(".", ",");

function totalsBlock(seller, total, vat) {
  const row = (label, value, bold = false) => [{ text: label, alignment: "right", bold }, { text: value, alignment: "right", bold, noWrap: true }];
  return {
    columns: [
      { width: "*", text: "" },
      {
        width: "auto",
        table: {
          widths: ["auto", 92],
          body: [
            row("Итого:", amount(total)),
            seller.is_vat_payer ? row(`В том числе НДС (${rateText(seller.vat_rate)}%):`, amount(vat)) : row("Без НДС", ""),
            row("Всего к оплате:", amount(total), true)
          ]
        },
        layout: plainLayout(6, 0, 2)
      }
    ],
    margin: [0, 8, 0, 10]
  };
}

const signature = (title) => ({ width: "*", text: [{ text: `${title}: `, bold: true }, "______________________"] });

// company: the details saved in the admin (settings.company); a missing one is filled with a sample and the invoice says so.
export function invoiceDoc(order, { company, whatsapp = "" } = {}) {
  const { details: seller, sample } = companyDetails(company, whatsapp);
  const items = Array.isArray(order.items) ? order.items : [];
  const { total, vat } = invoiceTotals(items, seller);
  const title = `Счёт на оплату № ${order.number}`;

  const doc = baseDoc({
    title,
    whatsapp,
    content: [
      ...(sample
        ? [{ text: "Образец: реквизиты продавца ещё не заполнены. Заполните их в админке, в разделе «Реквизиты для счёта».", color: COLORS.clay, bold: true, fontSize: 9, margin: [0, 0, 0, 10] }]
        : []),
      bankTable(seller),
      { text: `СЧЁТ НА ОПЛАТУ № ${order.number} от ${longDate(order.createdAt)}`, fontSize: 15, bold: true },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: COLORS.ink }], margin: [0, 6, 0, 12] },
      partiesTable(seller, order),
      goodsTable(items),
      // The totals and the sum in words stay together: a long list must not leave "Всего к оплате" alone on the next page.
      {
        stack: [
          totalsBlock(seller, total, vat),
          { text: `Всего наименований ${items.length}, на сумму ${amount(total)} ₸` },
          { text: [{ text: "Сумма прописью: ", bold: true }, amountInWords(total)], margin: [0, 2, 0, 0] }
        ],
        unbreakable: true
      },
      {
        stack: [
          { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: COLORS.ink }], margin: [0, 12, 0, 30] },
          { columns: [signature("Руководитель"), signature("Главный бухгалтер")], columnGap: 24 },
          { text: "М. П.", color: COLORS.muted, margin: [0, 16, 0, 0] }
        ],
        unbreakable: true
      }
    ]
  });
  if (sample) doc.watermark = { text: "ОБРАЗЕЦ", color: COLORS.clay, opacity: 0.08, bold: true, font: FONT };
  return doc;
}

export const invoiceFileName = (order) => `schet-${order.number}-${fileDay(order.createdAt)}.pdf`;
