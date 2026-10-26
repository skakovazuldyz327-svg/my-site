import { HANDOFF_REASONS, handoffReason, isHealth } from "../../../shared/consultant/index.js";

const LEGACY_MARK = /\s*\[\[ЖУЛДЫЗ\]\]\s*/gi;

export function publicHandoff(handoff) {
  return handoff ? { link: handoff.link, phone: handoff.phone, note: handoff.note } : null;
}

export default {
  id: "handoff",

  prompt: () => [
    "Про скидки, оплату, рассрочку, доставку и сроки никогда не говори «есть» или «нет» и не придумывай правила магазина — это решает только Жулдыз, передай ей.",
    "Передавай клиента Жулдыз, когда: он просит живого человека или телефон (request); готов купить или оформить заказ (order); спрашивает доставку (delivery); оплату, рассрочку, скидку (payment); нужен нестандартный размер или модель под заказ (custom); возврат, обмен, брак, гарантия (service); проблемы со здоровьем спины (health); ты дважды не смог помочь (stuck); другое (general).",
    "Как передавать: одной-двумя фразами по-человечески объясни, почему лучше к Жулдыз, и что сообщение для неё уже собрано — клиенту останется нажать кнопку WhatsApp под ответом и отправить его. Не обещай, что Жулдыз сама напишет или позвонит. Не диктуй номер и не пиши ссылки. Причину передачи укажи в поле handoff инструмента reply.",
    "Не передавай без причины: если можешь помочь сама, помоги — тогда handoff = none. На посторонние просьбы Жулдыз не передавай. Не выдумывай за Жулдыз цены доставки, сроки и скидки."
  ].join("\n"),

  reply: {
    properties: {
      handoff: { type: "string", enum: [...HANDOFF_REASONS, "none"], description: "Причина передачи клиента Жулдыз или none." }
    },
    required: ["handoff"]
  },

  // A direct request for a human skips the model: the answer is instant and the WhatsApp message is already filled in.
  intercept(context) {
    if (handoffReason(context.lastUserText) !== "request") return null;
    const reply = context.consultant.ask(context.history);
    return { ...reply, handoff: publicHandoff(reply.handoff) };
  },

  finalize(reply, answer, context) {
    const marked = /\[\[ЖУЛДЫЗ\]\]/i.test(reply.text);
    reply.text = reply.text.replace(LEGACY_MARK, " ").trim();
    // The model reads the whole conversation, so its choice wins; keywords stand in only when it gave none (a plain-text answer).
    const fromModel = answer.handoff === "none" ? "none" : HANDOFF_REASONS.includes(answer.handoff) ? answer.handoff : "";
    const reason = fromModel === "none" ? "" : fromModel || handoffReason(context.lastUserText) || (isHealth(context.lastUserText) ? "health" : marked ? "general" : "");
    if (!reason) {
      reply.suggestions = ["Написать Жулдыз"];
      return;
    }
    const withCards = context.history.concat([{ role: "bot", text: reply.text, products: reply.products }]);
    reply.handoff = publicHandoff(context.consultant.handoff(withCards, reason));
    reply.suggestions = [];
  }
};
