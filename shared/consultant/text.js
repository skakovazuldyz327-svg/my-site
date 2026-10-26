export const CURRENCY_SYMBOL = { KZT: "₸", USD: "$", RUB: "₽" };

export function norm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function money(value, currency) {
  return `${Number(value).toLocaleString("ru-RU")} ${CURRENCY_SYMBOL[currency] || CURRENCY_SYMBOL.KZT}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// JS \b treats Cyrillic as non-word characters, so word starts are checked by hand.
export function hasWord(text, key) {
  return new RegExp(`(^|[^0-9a-zа-яәіңғүұқөһ])${escapeRegExp(key)}`).test(text);
}

export function userText(messages) {
  return norm(messages.filter((item) => item.role === "user").map((item) => item.text).join(" \n "));
}
