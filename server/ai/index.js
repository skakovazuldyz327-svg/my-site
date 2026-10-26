import { createConsultant } from "../../shared/consultant/index.js";
import { assistants } from "./assistants/index.js";
import { buildRequest, cleanTurns } from "./conversation.js";
import { createAiCore } from "./core.js";
import { createFileReader } from "./files/index.js";
import { createProviders } from "./providers/index.js";

export function createAi({ config, store, logger, providers }) {
  const chain = providers || createProviders(config.ai, logger);
  const core = createAiCore({ providers: chain, logger, deadlineMs: config.ai.deadlineMs, maxSteps: config.ai.maxSteps, dailyTokens: config.ai.dailyTokens, usageFile: config.paths.aiUsage });
  const files = createFileReader({ store, logger, timeoutMs: config.ai.fileReadMs });
  const consultants = new WeakMap();

  // The catalog store returns the same object until the file changes, so the consultant is rebuilt only after an edit.
  function consultantFor(catalog) {
    if (!consultants.has(catalog)) consultants.set(catalog, createConsultant({ products: catalog.products, phone: catalog.settings.whatsapp }));
    return consultants.get(catalog);
  }

  return {
    providers: chain,

    async chat(body, assistantId = "consultant") {
      const assistant = assistants[assistantId];
      if (!assistant) throw new Error(`unknown assistant ${assistantId}`);
      const request = buildRequest(await files.attach(cleanTurns(body), body?.session));
      const catalog = await store.catalog.read();
      const context = {
        catalog,
        consultant: consultantFor(catalog),
        history: request.history,
        lastUserText: request.lastUserText,
        onlyFiles: request.onlyFiles,
        now: new Date()
      };
      return core.ask(assistant, { conversation: request.conversation, context });
    }
  };
}
