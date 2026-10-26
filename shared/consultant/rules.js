import { availability, buildHandoff, handoffIntro, handoffReason, isHealth, shownProducts } from "./handoff.js";
import { beds, blob, brief, byId, card, feel, isChildProduct, line, mattresses, mentioned, widths } from "./products.js";
import { readProfile } from "./profile.js";
import { money, norm } from "./text.js";

const hiddenSuggestions = ["Сплю на боку", "Для ребёнка", "Нужен жёсткий"];

function sizeScore(product, size) {
  if (!size) return 0;
  const have = widths(product);
  if (have.includes(size)) return 6;
  if ((size === "180" || size === "160") && (have.includes("160") || have.includes("180"))) return 1;
  return -3;
}

function scoreMattress(product, profile) {
  const text = blob(product);
  const level = feel(product);
  let score = 0;
  const child = isChildProduct(product);
  if (profile.child && child) score += 10;
  if (profile.child && !child) score -= 4;
  if (!profile.child && child) score -= 8;
  if (profile.firm === "hard" && level === "hard") score += 7;
  if (profile.firm === "hard" && level === "medium") score += 1;
  if (profile.firm === "hard" && level === "soft") score -= 3;
  if (profile.firm === "soft" && level === "soft") score += 6;
  if (profile.firm === "soft" && level === "hard") score -= 6;
  if (profile.firm === "medium" && level === "medium") score += 6;
  if (profile.pose === "side" && (level === "medium" || level === "soft")) score += 4;
  if (profile.pose === "side" && level === "hard") score -= 4;
  if (profile.pose === "stomach" && level === "hard") score += 5;
  if (profile.pose === "back" && (level === "medium" || level === "hard")) score += 3;
  if (profile.hot && /латекс|дышит|не греет/.test(text)) score += 3;
  if (profile.weight >= 95 && (level === "hard" || /пружин/.test(text))) score += 3;
  if (profile.weight && profile.weight < 60 && level === "hard") score -= 3;
  score += sizeScore(product, profile.size);
  if (product.inStock) score += 1;
  return score;
}

function rank(list, score) {
  return list
    .map((product) => ({ product, score: score(product) }))
    .sort((a, b) => b.score - a.score || a.product.price - b.product.price);
}

function poseLine(profile) {
  if (profile.pose === "side") return "На боку плечу нужно место, поэтому самый жёсткий матрас обычно мешает.";
  if (profile.pose === "back") return "На спине нужна ровная поддержка поясницы, без гамака.";
  if (profile.pose === "stomach") return "На животе лучше жёстче, чтобы таз не проваливался.";
  if (profile.firm === "hard") return "Если нужна жёсткая ровная опора, мягкий матрас быстро разочарует.";
  return "Подбираю под человека, а не «средний матрас для всех».";
}

function skippedNames(messages) {
  const previous = [...messages].reverse().find((item) => item.role === "bot" && Array.isArray(item.products) && item.products.length);
  return new Set((previous ? previous.products : []).map((product) => product.name));
}

export function makeReply(text, items, suggestions, handoff, messages, phone) {
  const reason = typeof handoff === "string" ? handoff : handoff ? "general" : "";
  const cards = (items || []).filter(Boolean).slice(0, 2).map(card);
  return {
    text,
    products: cards,
    suggestions: (suggestions || []).filter((label) => !hiddenSuggestions.includes(label) && !(reason && label === "Написать Жулдыз")),
    handoff: reason ? buildHandoff(messages, reason, cards, phone) : null
  };
}

export function askRules(messages, { products, phone }) {
  const list = Array.isArray(messages) ? messages : [];
  const reply = (text, items, suggestions, handoff) => makeReply(text, items, suggestions, handoff, list, phone);
  const handOver = (reason, items) => reply(handoffIntro[reason] || handoffIntro.general, items || [], ["Подобрать матрас"], reason);
  const find = (id) => byId(products, id);

  const last = [...list].reverse().find((item) => item.role === "user");
  const question = norm(last && last.text);
  const profile = readProfile(list);
  const names = mentioned(products, question);

  const previousBot = [...list].reverse().find((item) => item.role === "bot");
  const repeated = (text) => previousBot && previousBot.text === text;

  if (!products.length) {
    return reply("Каталог сейчас обновляется. Жулдыз подберёт вариант под заказ — напишите ей.", [], [], "custom");
  }

  const reason = handoffReason(question);
  if (reason === "order" && !names.length && !shownProducts(list).length && !profile.pose && !profile.size && !/кроват|подуш/.test(question)) {
    return reply("С радостью помогу с заказом. Подскажите, что именно хотите — матрас, кровать или подушку, и какой размер? Тогда передам Жулдыз уже готовый выбор. Или можно сразу написать ей.", [], ["Подобрать матрас", "Написать Жулдыз"], false);
  }
  if (reason) return handOver(reason, names);

  if (/график|режим работы|во сколько|до скольки|когда работ|часы работы|выходн/.test(question)) {
    return reply(`Жулдыз на связи пн–сб, с 10:00 до 19:00, в воскресенье — по договорённости. ${availability()}`, [], ["Подобрать матрас", "Написать Жулдыз"], false);
  }

  const greeting = /^(привет|здравствуй|добрый день|добрый вечер|доброе утро|хай|салем|сәлем)/.test(question);
  if (greeting && question.length < 48 && !names.length && !profile.pose && !profile.size && !profile.firm && !profile.child) {
    return reply("Здравствуйте. Я виртуальный консультант Жулдыз: подберу матрас, кровать или подушку из того, что есть сейчас. Как вы спите — на боку, на спине или на животе?", [], ["Сплю на боку", "Сплю на спине", "Для ребёнка"], false);
  }

  if (/спасибо|благодар/.test(question) && question.length < 40) {
    if (shownProducts(list).length) return reply("Пожалуйста! Когда решите — Жулдыз подтвердит наличие и размер. Я подготовила для неё сообщение с вашим выбором.", [], [], "order");
    return reply("Пожалуйста! Если появятся вопросы — пишите, я здесь.", [], ["Подобрать матрас", "Написать Жулдыз"], false);
  }

  if (isHealth(question)) {
    return reply("Я не врач и диагноз не ставлю. При боли в спине обычно спокойнее ровная жёсткая опора, без ямы, — из каталога это «Кокос Хард». Но с диагнозом лучше подбирать вместе с Жулдыз и согласовать с врачом.", [find("p8")], [], "health");
  }

  if (/подуш/.test(question) || (profile.neck && !names.length && !/матрас|кроват/.test(question))) {
    const neck = find("p5");
    const latex = find("p12");
    const side = profile.pose === "side" || profile.neck;
    const ordered = side ? [neck, latex] : [latex, neck];
    const text = side
      ? "На боку шею держит анатомическая подушка «Шея». «Латекс Классик» — если нужна обычная форма, которая не сбивается."
      : "«Латекс Классик» держит форму годами. «Шея» — если важнее поддержка шеи на боку или на спине.";
    return reply(text, ordered, ["Написать Жулдыз", "Подобрать матрас"], false);
  }

  if (names.length >= 2) {
    const pair = names.slice(0, 2);
    const text = pair.map((product) => `${line(product)}. ${brief(product)}`).join("\n\n");
    return reply(`${text}\n\nНапишите, как спите — скажу, какой из них ближе.`, pair, ["Сплю на боку", "Нужен жёсткий", "Написать Жулдыз"], false);
  }

  if (names.length === 1 && (/сколько|цена|стоит|налич|есть ли|расскаж|что за|покажи/.test(question) || question.length < 42)) {
    const product = names[0];
    const was = product.oldPrice ? ` Раньше было ${money(product.oldPrice, product.currency)}.` : "";
    return reply(`${line(product)}.${was} ${brief(product)}`, [product], ["Написать Жулдыз", "Подобрать другой"], false);
  }

  if (/что есть|какие есть|ассортимент|каталог|какие матрас|покажи матрас/.test(question)) {
    const items = mattresses(products);
    return reply(`Матрасы сейчас:\n${items.map(line).join("\n")}\n\nНапишите позу и размер — оставлю один-два варианта, не всю полку.`, items.slice(0, 2), ["Сплю на боку", "Нужен жёсткий", "Для ребёнка"], false);
  }

  if (/наматрас|чехол/.test(question)) {
    const product = find("p6");
    return reply(product ? `${line(product)}. ${brief(product)} Его кладут поверх любого матраса.` : "Наматрасника сейчас нет в каталоге.", [product], ["Подобрать матрас", "Написать Жулдыз"], false);
  }

  if (/одеял/.test(question)) {
    const product = find("p11");
    return reply(product ? `${line(product)}. ${brief(product)}` : "Одеяла сейчас нет в каталоге.", [product], ["Написать Жулдыз"], false);
  }

  if (/основан|ламел/.test(question) && !/кроват/.test(question)) {
    const product = find("p10");
    return reply(product ? `${line(product)}. ${brief(product)} Без нормального основания даже хороший матрас проседает.` : "Основания сейчас нет в каталоге.", [product], ["Какие кровати", "Написать Жулдыз"], false);
  }

  if (/кроват/.test(question)) {
    const ranked = rank(beds(products), (product) => {
      let score = sizeScore(product, profile.size);
      const text = blob(product);
      if (profile.storage && /ящик|подъем/.test(text)) score += 6;
      if (/дуб|массив|дерев/.test(question) && /дуб|массив/.test(text)) score += 5;
      if (product.inStock) score += 1;
      return score;
    });
    const shown = ranked.slice(0, 2).map((item) => item.product);
    const noSize = profile.size && !shown.some((product) => widths(product).includes(profile.size));
    const missing = noSize ? ` Размера ${profile.sizeText || profile.size} в готовых кроватях нет — Жулдыз может сделать под заказ, я передам ей запрос.` : "";
    return reply(`Из кроватей ближе всего: ${shown.map(line).join("; ")}.${missing} Смотрю не только изголовье, но и основание.`, shown, profile.size ? ["Нужен матрас", "Написать Жулдыз"] : ["160×200", "180×200", "Написать Жулдыз"], noSize ? "custom" : false);
  }

  const offTopic = "Я консультант по сну: матрасы, кровати и подушки Жулдыз. Напишите, как спите и какой размер — подберу из каталога.";
  const domain = /матрас|кроват|подуш|сон|сплю|жест|мягк|размер|налич|цен|стоит|ортопед|подбер|помог/;
  if (!domain.test(question) && !profile.pose && !profile.size && !profile.firm && !profile.child && !names.length && question.length > 24) {
    if (repeated(offTopic)) return handOver("stuck");
    return reply(offTopic, [], ["Сплю на спине", "Написать Жулдыз"], false);
  }

  const clarify = "Чтобы не предлагать лишнее: как вы спите — на боку, на спине или на животе? И какой размер кровати.";
  if (/подобрать матрас|помоги|не знаю что|подскаж/.test(question) && !profile.pose && !profile.size && !profile.firm && !profile.child) {
    if (repeated(clarify)) return handOver("stuck");
    return reply(clarify, [], ["Сплю на спине", "Написать Жулдыз"], false);
  }

  let pool = mattresses(products).filter((product) => profile.child || !isChildProduct(product));
  if (/друг(ой|ую|ое)|еще вариант|ещё вариант|не этот|подобрать другой/.test(question)) {
    const skip = skippedNames(list);
    const rest = pool.filter((product) => !skip.has(product.name));
    if (rest.length) pool = rest;
  }

  if (profile.child) {
    const kid = pool.find(isChildProduct) || find("p7");
    return reply(`Ребёнку не кладу взрослый пружинный матрас. ${line(kid)}. ${brief(kid)}`, [kid], ["Написать Жулдыз", "Какие кровати"], false);
  }

  if (profile.firm === "soft") {
    const neo = find("p2");
    return reply(`Если любите проваливаться, ортопедия может не совпасть — говорю об этом сразу. Самый податливый в каталоге: ${line(neo)}. ${brief(neo)} Жёсткий «Кокос Хард» в этом случае я бы не ставила.`, [neo], profile.size ? ["Написать Жулдыз", "Нужна подушка"] : ["120×200", "Написать Жулдыз"], false);
  }

  if (profile.pose === "side" && profile.firm === "hard") {
    return reply("На боку слишком жёсткий матрас давит плечо. Если жёсткость принципиальна — «Кокос Хард». Если важнее, чтобы плечо утопало, — «Баланс», он средне-жёсткий.", [find("p8"), find("pmuwtba7c")], ["160×200", "180×200", "Написать Жулдыз"], false);
  }

  if (/подешевл|дешевл|недорог|бюджет/.test(question)) {
    const ranked = rank(pool, (product) => scoreMattress(product, profile));
    const viable = ranked.filter((item) => item.score > 0);
    let candidates = viable.length ? viable : ranked;
    if (profile.size) {
      const sized = candidates.filter((item) => widths(item.product).includes(profile.size));
      if (sized.length) candidates = sized;
    }
    const pick = candidates.slice().sort((a, b) => a.product.price - b.product.price)[0];
    if (!pick) return reply("Не вижу подходящего варианта дешевле. Жулдыз иногда находит вариант под заказ — передам ей запрос.", [], [], "payment");
    return reply(`Самый спокойный по цене из подходящих — ${line(pick.product)}. ${brief(pick.product)} Это не «самый дешёвый вообще», а то, что не спорит с тем, как вы спите.`, [pick.product], ["Написать Жулдыз", "Нужна подушка"], false);
  }

  const askPose = "Напишите, как спите и какой размер кровати. Например: на боку, 180×200. Тогда назову одну-две модели, а не весь список.";
  if (!profile.pose && !profile.firm && !profile.size) {
    if (repeated(askPose) || repeated(clarify)) return handOver("stuck");
    return reply(askPose, [], ["Сплю на спине", "На животе", "Написать Жулдыз"], false);
  }

  const ranked = rank(pool, (product) => scoreMattress(product, profile));
  const best = ranked[0];
  const second = ranked[1];
  const chosen = [best && best.product].filter(Boolean);
  if (second && best.score - second.score <= 2 && second.score >= 4) chosen.push(second.product);
  const noSize = profile.size && !chosen.some((product) => widths(product).includes(profile.size));
  const missing = noSize ? ` Точного размера ${profile.sizeText || profile.size} среди них нет — Жулдыз может сделать под заказ, я передам ей запрос.` : "";
  const ask = !profile.size
    ? " Какой размер кровати: 160×200 или 180×200?"
    : !profile.pose
      ? " Уточните ещё, как спите — на боку, спине или животе."
      : " Если нужно, добавлю подушку или подберу кровать.";
  const text = `${poseLine(profile)} ${chosen.map((product) => `${line(product)}.`).join("\n\n")}`;
  return reply(`${text}${missing}${ask}`, chosen, !profile.size ? ["160×200", "180×200", "90×200"] : ["Нужна подушка", "Какие кровати", "Написать Жулдыз"], noSize ? "custom" : false);
}
