import { readProfile, needsLine } from "./profile.js";
import { norm } from "./text.js";

export const HANDOFF_REASONS = ["request", "order", "delivery", "payment", "service", "custom", "health", "stuck", "general"];

const topics = {
  request: "хочу связаться лично",
  order: "хочу оформить заказ",
  delivery: "доставка",
  payment: "оплата и цена",
  service: "возврат, обмен или гарантия",
  custom: "нестандартный размер или под заказ",
  health: "есть проблемы со спиной",
  stuck: "консультант не смог помочь",
  general: "вопрос с сайта"
};

export const handoffIntro = {
  request: "Конечно, соединю с Жулдыз. Я уже собрала для неё ваш вопрос и то, что мы обсудили, — переписываться заново не придётся.",
  order: "Отлично, заказ оформляет сама Жулдыз: подтвердит наличие, размер и сроки. Я подготовила сообщение со всем, что вы выбрали.",
  delivery: "Доставку Жулдыз считает лично — по адресу и размеру. Напишите ей, сообщение уже готово.",
  payment: "Про оплату и цену лучше договориться с Жулдыз напрямую — так честнее, чем гадать. Сообщение для неё уже готово.",
  service: "Сожалею, что так вышло. Такие вопросы Жулдыз решает сама и не отмахивается — напишите ей, я передала суть.",
  custom: "Нестандартные размеры и модели под заказ Жулдыз обсуждает лично. Сообщение с вашими пожеланиями уже готово.",
  health: "Тут лучше живой разговор: Жулдыз подберёт осторожно и подскажет, что спросить у врача.",
  stuck: "Похоже, я не до конца понимаю, что вам нужно. Давайте подключим Жулдыз — она разберётся лично.",
  general: "Передаю вас Жулдыз — она ответит лично."
};

export function handoffReason(text) {
  const q = norm(text);
  if (!q) return "";
  // «позвон» alone would also catch «позвоночник», and «связь с» any «связь с чем-то».
  if (/ватсап|ватцап|whatsapp|(^|[^а-я])позвон(ить|ите|и|ю|ят)(?![а-я])|перезвон|живой человек|живым человеком|оператор|менеджер|позови|связаться|связь с (жулдыз|вами|продав|менеджер|магазин|человек)|написать жулдыз|поговорить с жулдыз|с вами лично|номер телефона|ваш номер|ваш телефон/.test(q)) return "request";
  // A sagging or creaking mattress is a complaint about a purchase only when it is not the client's old one.
  if (/возврат|вернуть(?!ся)|обмен|брак|бракован|гаранти|жалоб|претензи|не подош/.test(q) || (/продавил|скрипит|прогнул/.test(q) && !/стар/.test(q))) return "service";
  if (/оформ|заказать|купить|покупаю|(^|[^а-я])(беру|возьму)|хочу этот|хочу эту|бронь|заброниров|отложите/.test(q)) return "order";
  if (/достав|привез|курьер|самовывоз|забрать|по адрес|в другой город|адрес магазин|где находит|где вы находит/.test(q)) return "delivery";
  if (/оплат|рассроч|кредит|каспи|kaspi|картой|наличн|перевод|скидк|дешевле не|(^|[^а-я])торг(?!ов)|уступ/.test(q)) return "payment";
  if (/нестандарт|свой размер|другой размер|под заказ|индивидуал|на заказ/.test(q)) return "custom";
  return "";
}

const pain = "(болит|болят|болела|болели|болеть|боль|боли|болью|ноет|ноют)";
const back = "(спина|спине|спину|спиной|спины|поясница|пояснице|поясницу|поясницей|поясницы)";
const healthPattern = new RegExp(`грыж|сколиоз|протруз|радикулит|остеохондроз|(^|[^а-я])${pain}( в)? ${back}(?![а-я])|(^|[^а-я])${back} ([а-я]+ )?${pain}(?![а-я])`);

export const isHealth = (text) => healthPattern.test(norm(text));

function almatyNow(date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => (parts.find((part) => part.type === type) || {}).value;
  return { day: get("weekday"), hour: Number(get("hour")) };
}

export function availability(date = new Date()) {
  let now;
  try {
    now = almatyNow(date);
  } catch {
    return "";
  }
  const workday = now.day !== "Sun";
  if (workday && now.hour >= 10 && now.hour < 19) return "Жулдыз сейчас на связи и обычно отвечает в течение часа.";
  if (workday && now.hour < 10) return "Сейчас Жулдыз ещё не на связи — ответит сегодня после 10:00. Сообщение можно отправить уже сейчас.";
  if (now.day === "Sat" || now.day === "Sun") return "Сейчас выходные — Жулдыз ответит в понедельник после 10:00 или раньше, если получится. Сообщение можно отправить уже сейчас.";
  return "Рабочий день уже закончился — Жулдыз ответит завтра после 10:00. Сообщение можно отправить уже сейчас.";
}

export function shownProducts(messages) {
  const seen = new Map();
  messages.filter((item) => item.role === "bot").slice(-4).forEach((item) => {
    (item.products || []).forEach((product) => {
      if (product && product.name) seen.set(product.name, product);
    });
  });
  return [...seen.values()].slice(-3);
}

export function buildHandoff(messages, reason, extra, phone) {
  const list = Array.isArray(messages) ? messages : [];
  const profile = readProfile(list);
  const userLines = list.filter((item) => item.role === "user").map((item) => String(item.text || "").trim()).filter(Boolean);
  const meaningful = userLines.filter((text) => !/^написать жулдыз$/i.test(text));
  const topic = topics[reason] || topics.general;
  const needs = needsLine(profile, list);
  const picked = new Map(shownProducts(list).map((product) => [product.name, product]));
  (extra || []).forEach((product) => picked.set(product.name, product));
  const liked = [...picked.values()].slice(-3).map((product) => `${product.name}${product.price ? ` (${product.price})` : ""}`);
  const lines = [
    "Здравствуйте, Жулдыз! Пишу с сайта, консультант посоветовал обратиться к вам.",
    `Тема: ${topic}.`
  ];
  if (needs) lines.push(`Что ищу: ${needs}.`);
  if (liked.length) lines.push(`Консультант предложил: ${liked.join(", ")}.`);
  if (meaningful.length) lines.push(`Мой вопрос: ${meaningful.slice(-3).join(" / ")}`);
  const files = list.filter((item) => item.role === "user").flatMap((item) => (Array.isArray(item.files) ? item.files : [])).map((file) => file && file.name).filter(Boolean);
  if (files.length) lines.push(`В чате прикрепил(а): ${[...new Set(files)].slice(-5).join(", ")} — отправлю следом.`);
  let text = lines.join("\n");
  if (text.length > 900) text = `${text.slice(0, 897)}…`;
  // A lone half of an emoji (from this cut or from any earlier one) makes encodeURIComponent throw.
  text = text.replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g, (match, pair) => pair || "");
  return {
    link: `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
    phone: `+${phone}`,
    note: availability()
  };
}
