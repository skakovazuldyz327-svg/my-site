import { silentLogger } from "../log.js";
import { createDailyBudget } from "./budget.js";
import { createToolRegistry } from "./tools.js";

export const REPLY_TOOL = "reply";

/**
 * The final answer is itself a tool call whose schema is assembled from the skills,
 * so every skill can add its own structured field (product ids, handoff reason, ...) without parsing text.
 */
function buildReplyTool(skills) {
  const properties = { text: { type: "string", description: "Текст ответа клиенту, без markdown." } };
  const required = ["text"];
  for (const skill of skills) {
    Object.assign(properties, skill.reply?.properties || {});
    required.push(...(skill.reply?.required || []));
  }
  return {
    name: REPLY_TOOL,
    description: "Финальный ответ клиенту. Вызывай ровно один раз, когда ответ готов.",
    parameters: { type: "object", properties, required }
  };
}

function parseAnswer(raw) {
  const answer = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
  if (!answer || typeof answer.text !== "string" || !answer.text.trim()) throw new Error("reply without text");
  return answer;
}

export function createAiCore({ providers = [], logger = silentLogger, deadlineMs = 40000, maxSteps = 3, dailyTokens = Infinity, usageFile = "", now } = {}) {
  const budget = createDailyBudget({
    tokens: dailyTokens,
    now,
    file: usageFile,
    onSaveError: (error) => logger.warn("AI token count could not be saved", { message: error.message })
  });

  async function runProvider(provider, { system, conversation, registry, replyTool, context, signal }) {
    const messages = [...conversation];
    const tools = [...registry.definitions(), replyTool];
    const usage = { input: 0, output: 0 };
    for (let step = 0; step < maxSteps; step += 1) {
      const forceReply = !registry.size || step === maxSteps - 1;
      const result = await provider.chat({ system, messages, tools, toolChoice: forceReply ? { name: REPLY_TOOL } : "required", signal });
      budget.spend(result.usage);
      usage.input += result.usage?.input || 0;
      usage.output += result.usage?.output || 0;
      const calls = result.toolCalls || [];
      const final = calls.find((call) => call.name === REPLY_TOOL);
      if (final) return { answer: parseAnswer(final.arguments), usage };
      if (!calls.length) return { answer: parseAnswer({ text: result.text || "" }), usage };
      messages.push({ role: "assistant", text: result.text || "", toolCalls: calls });
      for (const call of calls) {
        const output = await registry.run(call.name, call.arguments, context);
        messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: JSON.stringify(output ?? null).slice(0, 20000) });
      }
    }
    throw new Error("no final answer within step limit");
  }

  return {
    async ask(assistant, { conversation, context: base }) {
      const started = Date.now();
      const context = { ...base, turn: {} };
      const skills = assistant.skills || [];

      for (const skill of skills) {
        if (!skill.intercept) continue;
        try {
          const early = await skill.intercept(context);
          if (early) return { ...early, source: `skill:${skill.id}` };
        } catch (error) {
          logger.warn("skill intercept failed", { skill: skill.id, message: error.message });
        }
      }

      const exhausted = budget.exhausted();
      if (exhausted && budget.reportOnce()) {
        logger.warn("AI daily token limit reached - the rules consultant answers until midnight (AI_DAILY_TOKENS in .env)", { limit: budget.tokens, used: budget.used() });
      }
      const chain = exhausted ? [] : providers.filter((provider) => provider.available());
      if (chain.length && conversation.length) {
        const registry = createToolRegistry(skills.flatMap((skill) => (typeof skill.tools === "function" ? skill.tools(context) : skill.tools) || []));
        const replyTool = buildReplyTool(skills);
        const system = skills.map((skill) => (skill.prompt ? skill.prompt(context) : "")).filter(Boolean).join("\n\n");
        const signal = AbortSignal.timeout(deadlineMs);

        for (const provider of chain) {
          if (signal.aborted) break;
          try {
            const { answer, usage } = await runProvider(provider, { system, conversation, registry, replyTool, context, signal });
            const reply = { text: answer.text.trim(), products: [], suggestions: [], handoff: null };
            for (const skill of skills) {
              if (skill.finalize) await skill.finalize(reply, answer, context);
            }
            if (!reply.text) throw new Error("empty text after finalize");
            logger.info("ai reply", { assistant: assistant.id, provider: provider.id, ms: Date.now() - started, usage });
            return { ...reply, source: provider.id };
          } catch (error) {
            logger.warn("ai provider failed", { assistant: assistant.id, provider: provider.id, message: error.message });
          }
        }
      }

      const reply = await assistant.fallback(context);
      logger.info("ai fallback", { assistant: assistant.id, ms: Date.now() - started, providers: chain.map((provider) => provider.id) });
      return { ...reply, source: "rules" };
    }
  };
}
