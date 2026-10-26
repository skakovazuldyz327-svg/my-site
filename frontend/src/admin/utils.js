export const CURRENCY_SYMBOL = { KZT: "₸", USD: "$", RUB: "₽" };
export const ORDER_STATUS = { new: "Новый", work: "В работе", done: "Выполнен", cancel: "Отменён" };
export const DEFAULT_CATEGORIES = ["Матрасы", "Кровати", "Аксессуары"];
export const MAX_PHOTOS = 8;

export const formatPrice = (value, currency = "KZT") =>
  `${Number(value).toLocaleString("ru-RU")} ${CURRENCY_SYMBOL[currency] || CURRENCY_SYMBOL.KZT}`;

export function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function plural(count, one, few, many) {
  const tens = count % 100;
  const last = count % 10;
  if (last === 1 && tens !== 11) return one;
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

export function phoneDigits(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

export function normalizePhone(value) {
  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  return digits;
}

export function normalizeSize(value) {
  const parts = value.replace(/\s*на\s*/gi, "×").replace(/\s/g, "").split(/[xXхХ*×]/);
  if (parts.length < 2 || !parts.every((part) => /^\d+([.,]\d+)?$/.test(part))) return value.trim();
  const meters = parts.some((part) => /[.,]/.test(part));
  return parts.map((part) => {
    const number = parseFloat(part.replace(",", "."));
    return meters && number < 10 ? String(Math.round(number * 100)) : String(number);
  }).join("×");
}

export function splitSizes(value) {
  return value.split(/;|,\s+/).flatMap((chunk) =>
    chunk.split(",").reduce((list, piece) => {
      const last = list.length - 1;
      if (last >= 0 && (/^\d+$/.test(list[last].trim()) || /^\d+$/.test(piece.trim()))) list[last] += `,${piece}`;
      else list.push(piece);
      return list;
    }, [])
  );
}

export function productImages(product) {
  if (!product) return [];
  if (Array.isArray(product.images) && product.images.length) return product.images.filter(Boolean);
  return product.image ? [product.image] : [];
}

export function resizeImage(file, maxSide = 1400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("blob"))), "image/jpeg", 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

export function contactLinks(phone, text) {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  return {
    call: `tel:+${digits}`,
    wa: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
  };
}
