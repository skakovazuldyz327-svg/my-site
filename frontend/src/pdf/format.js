export const SHOP_NAME = "Жулдыз";
export const SHOP_TAGLINE = "Ортопедические матрасы и кровати";
// The shop's web address for the catalog's contacts, e.g. "zhuldyz.kz"; left out while empty.
export const SHOP_SITE = "";
export const COLORS = { ink: "#1e1a14", muted: "#5c5348", olive: "#3f4a38", clay: "#b55238", line: "#d8cbb4", linen: "#f3ead8" };

const CURRENCY_SYMBOL = { KZT: "₸", USD: "$", RUB: "₽" };

export function money(value, currency = "KZT") {
  const number = Number(value) || 0;
  const symbol = CURRENCY_SYMBOL[currency] || CURRENCY_SYMBOL.KZT;
  return `${number.toLocaleString("ru-RU").replace(/\s/g, "\u00A0")}\u00A0${symbol}`;
}

// Invoice amounts carry tiyn and no currency sign, which the column heading gives: 191 700,00.
export function amount(value) {
  const number = Number(value) || 0;
  return number.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, "\u00A0");
}

// The server writes the shop's own time with its offset (…T23:58:12.1234567+05:00). The printed day is the shop's,
// as in the admin, whatever time zone the buyer's computer is in; reading the parts also spares older Safari,
// which rejects seven digits of fractions.
const SHOP_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?[+-]\d{2}:?\d{2}$/;

function validDate(value) {
  const parts = typeof value === "string" ? SHOP_TIME.exec(value) : null;
  const date = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), Number(parts[4]), Number(parts[5]))
    : value instanceof Date ? value : new Date(typeof value === "string" ? value.replace(/(\.\d{3})\d+/, "$1") : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function longDate(value) {
  const date = validDate(value);
  return date ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }) : "";
}

export function shortDate(value) {
  const date = validDate(value);
  return date ? date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

export function fileDay(value) {
  const date = validDate(value) || new Date();
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}

// Settings keep the shop's number as bare digits: 77778492164 reads as +7 777 849 21 64.
export function shopPhone(digits) {
  const text = String(digits || "").replace(/\D/g, "");
  if (text.length === 11 && text.startsWith("7")) return `+7 ${text.slice(1, 4)} ${text.slice(4, 7)} ${text.slice(7, 9)} ${text.slice(9)}`;
  return text ? `+${text}` : "";
}

export function firstPhoto(product) {
  if (!product) return "";
  if (Array.isArray(product.images) && product.images.length) return product.images.find(Boolean) || "";
  return product.image || "";
}

const UNITS = /(\d)\s*(см|мм|кг|м²|м³|м)(?![\p{L}\d])/giu;
const ABBREVIATION_END = /(^|[^\p{L}])(шт|др|тыс|млн|руб|гг|г|т\.\s?[дпе])\.$/u;

// Product texts are typed by hand ("латекс,кокосовая", "22 СМ", "( с обивкой )"); only the printed copy is tidied.
// A comma before a digit is left alone (1,5 м), and a dot only gets a space before a capital, so "т.д." and site.kz stay.
// No lookbehind here: Safari before 16.4 cannot parse it, and this module loads with the shop's catalog page.
export function tidyText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+([,.;:!?)»])/g, "$1")
    .replace(/([,;])(?=[\p{L}«(])/gu, "$1 ")
    .replace(/(\p{L}):(?=[\p{L}\d«(])/gu, "$1: ")
    .replace(/([.!?])(?=[\p{Lu}«])/gu, "$1 ")
    .replace(/(\d)\s*[*xXхХ×]\s*(?=\d)/g, "$1×")
    .replace(UNITS, (match, digit, unit) => `${digit}\u00A0${unit.toLowerCase()}`)
    .trim();
}

// A list item reads without a closing period, unless the period belongs to an abbreviation like "шт.".
export function tidyItem(value) {
  const text = tidyText(value);
  return text.endsWith(".") && !text.endsWith("..") && !ABBREVIATION_END.test(text) ? text.slice(0, -1) : text;
}

export function shorten(text, max) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, "")}…`;
}
