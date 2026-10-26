import { availability, buildHandoff, HANDOFF_REASONS, handoffIntro, handoffReason, isHealth } from "./handoff.js";
import { card, mentioned } from "./products.js";
import { makeReply, askRules } from "./rules.js";
import { norm } from "./text.js";

export { availability, card, HANDOFF_REASONS, handoffReason, isHealth };
export { line, normalizeSizes, stock, widths } from "./products.js";
export { readProfile } from "./profile.js";

export const DEFAULT_PHONE = "77778492164";

// One consultant per catalog snapshot; the same object runs on the server and in the browser.
export function createConsultant({ products, phone }) {
  const list = Array.isArray(products) ? products : [];
  const digits = String(phone || DEFAULT_PHONE).replace(/\D/g, "") || DEFAULT_PHONE;

  return {
    products: list,
    phone: digits,
    ask: (messages) => askRules(messages, { products: list, phone: digits }),
    cards: (text) => mentioned(list, norm(text)).slice(0, 2).map(card),
    cardsById: (ids) => (Array.isArray(ids) ? ids : []).map((id) => list.find((product) => product.id === id)).filter(Boolean).slice(0, 2).map(card),
    handoff: (messages, reason) => ({ intro: handoffIntro[reason] || handoffIntro.general, ...buildHandoff(messages, reason || "general", [], digits) }),
    handOver: (messages, reason, items) => makeReply(handoffIntro[reason] || handoffIntro.general, items || [], ["Подобрать матрас"], reason, messages, digits)
  };
}
