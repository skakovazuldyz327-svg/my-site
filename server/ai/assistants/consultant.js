import attachments from "../skills/attachments.js";
import catalog from "../skills/catalog.js";
import handoff, { publicHandoff } from "../skills/handoff.js";
import persona from "../skills/persona.js";
import schedule from "../skills/schedule.js";

function safeReply(text, handoffData) {
  return { text, products: [], suggestions: [], handoff: publicHandoff(handoffData) };
}

export default {
  id: "consultant",

  // Order matters: finalize runs top to bottom, and handoff needs the product cards picked by catalog.
  skills: [persona, catalog, schedule, attachments, handoff],

  fallback(context) {
    const { consultant, history } = context;
    try {
      if (context.onlyFiles) {
        return safeReply(
          "Файл получила и передаю Жулдыз — она посмотрит его лично. Если хотите, чтобы я помогла с подбором прямо сейчас, напишите в двух словах, что на нём.",
          consultant.handoff(history, "general")
        );
      }
      const reply = consultant.ask(history);
      if (reply && typeof reply.text === "string") return { ...reply, handoff: publicHandoff(reply.handoff) };
    } catch {
      /* fall through to the safe answer */
    }
    return safeReply("Что-то пошло не так с ответом. Давайте я передам ваш вопрос Жулдыз — она ответит лично.", consultant.handoff(history, "stuck"));
  }
};
