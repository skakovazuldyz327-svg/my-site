import { createRateLimiter } from "../http/rateLimit.js";
import { clientIp, readJson, sendJson } from "../http/respond.js";

// Only text and file references: the files themselves are uploaded separately and read on the server.
const CHAT_BODY_LIMIT = 2 * 1024 * 1024;

export function registerChatApi(router, { config, logger, ai }) {
  const allow = createRateLimiter({ limit: config.chatPerMinute, windowMs: 60000 });
  let active = 0;

  router.post("/api/chat", async (req, res) => {
    if (!allow(clientIp(req))) {
      logger.warn("chat rate limit", { ip: clientIp(req) });
      sendJson(res, 429, { error: "rate" });
      return;
    }
    // A request with photos and PDFs holds tens of megabytes until the model answers, so their number is capped;
    // a busy answer makes the chat in the browser reply with its own copy of the rules.
    if (active >= config.chatConcurrent) {
      logger.warn("chat is busy", { active });
      sendJson(res, 503, { error: "busy" });
      return;
    }
    active += 1;
    try {
      const body = await readJson(req, CHAT_BODY_LIMIT);
      const reply = await ai.chat(body);
      sendJson(res, 200, {
        text: reply.text,
        products: reply.products || [],
        suggestions: reply.suggestions || [],
        handoff: reply.handoff || null,
        source: reply.source
      });
    } finally {
      active -= 1;
    }
  });
}
