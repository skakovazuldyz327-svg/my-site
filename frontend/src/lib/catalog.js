import { shopPhone } from "../pdf/format.js";

const siteData = window.SITE_DATA || { settings: {}, products: [] };

export const settings = siteData.settings || {};
export const products = Array.isArray(siteData.products) ? siteData.products : [];
// false: /data/products.js failed (server error, no network) or came without a product list, so products is not the real catalog.
export const catalogLoaded = !window.SITE_DATA_FAILED && Array.isArray(window.SITE_DATA?.products);
export const catalogFailedNote = "Не удалось обновить данные о товарах. Ваши товары в корзине сохранены, попробуйте обновить страницу.";

// The shop's working number: shown until the catalog brings the one saved in the admin.
export const DEFAULT_PHONE = "77778492164";
export const whatsapp = String(settings.whatsapp || DEFAULT_PHONE).replace(/\D/g, "") || DEFAULT_PHONE;
export const waLink = `https://wa.me/${whatsapp}`;

// The contacts every page shows come from the admin's settings only; an address that was never saved is not shown at all.
export const contacts = {
  phone: shopPhone(whatsapp),
  phoneHref: `tel:+${whatsapp}`,
  email: typeof settings.email === "string" && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(settings.email) ? settings.email : "",
  hours: "Пн–Сб · 10:00–19:00 · вс — по договорённости",
};

export const CURRENCY_SYMBOL = { KZT: "₸", USD: "$", RUB: "₽" };

export function productCurrency(product) {
  return CURRENCY_SYMBOL[product?.currency] ? product.currency : "KZT";
}

export const formatPrice = (value, product) =>
  `${Number(value).toLocaleString("ru-RU")} ${CURRENCY_SYMBOL[productCurrency(product)]}`;

export function productImages(product) {
  if (!product) return [];
  if (Array.isArray(product.images) && product.images.length) return product.images.filter(Boolean);
  return product.image ? [product.image] : [];
}

export const productUrl = (product) => `product.html?id=${encodeURIComponent(product.id)}`;

export function productById(id) {
  return products.find((product) => product.id === id);
}

// With counted stock each size is on hand or made to order on its own; otherwise the product's mark decides.
export function sizeInStock(product, size) {
  if (!product?.stock) return Boolean(product?.inStock);
  const key = product.sizes?.length ? size : "";
  return (product.stock[key] ?? 0) > 0;
}

export const clampQty = (value) => Math.min(20, Math.max(1, parseInt(value, 10) || 1));

export function openWhatsApp(url) {
  const tab = window.open(url, "_blank");
  if (tab) tab.opener = null;
  else location.href = url;
}
