import { SHOP_NAME, shopPhone } from "./format.js";

export const DEFAULT_VAT_RATE = 12;

// Printed until the admin fills in the real details; such an invoice is marked as a sample and the shop page offers none.
export const COMPANY_SAMPLE = {
  company_name: `ИП «${SHOP_NAME}»`,
  bin_iin: "000000000000",
  iik: "KZ000000000000000000",
  bank_name: "АО «Название банка»",
  bik: "XXXXKZKA",
  kbe: "19",
  company_address: "г. Алматы, ул. Примерная, 1",
  company_phone: "",
  is_vat_payer: false,
  vat_rate: DEFAULT_VAT_RATE
};

export const COMPANY_LABELS = {
  company_name: "Наименование",
  bin_iin: "БИН / ИИН",
  iik: "ИИК",
  bank_name: "Банк",
  bik: "БИК",
  kbe: "Кбе",
  company_address: "Адрес"
};

// Without any of these an invoice cannot be paid; the phone falls back to the shop's WhatsApp number.
export const COMPANY_REQUIRED = Object.keys(COMPANY_LABELS);

const filledText = (value) => String(value ?? "").trim();

export function companyDetails(saved, whatsapp = "") {
  const given = saved && typeof saved === "object" ? saved : {};
  const missing = COMPANY_REQUIRED.filter((field) => !filledText(given[field]));
  const details = { ...COMPANY_SAMPLE, company_phone: shopPhone(whatsapp) };
  for (const field of [...COMPANY_REQUIRED, "company_phone"]) if (filledText(given[field])) details[field] = filledText(given[field]);
  details.is_vat_payer = given.is_vat_payer === true;
  const rate = Number(given.vat_rate);
  details.vat_rate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_VAT_RATE;
  return { details, sample: missing.length > 0, missing };
}
