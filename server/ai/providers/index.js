import { createOpenAiProvider } from "./openai.js";

// To add a provider: write a file exporting a factory that returns { id, available(), chat() } and list it here.
const FACTORIES = {
  openai: (ai, options) => createOpenAiProvider({ ...ai.openai, ...options })
};

export function createProviders(ai, logger, options = {}) {
  const providers = [];
  for (const name of ai.providers) {
    const factory = FACTORIES[name];
    if (!factory) {
      logger.warn("unknown AI provider in AI_PROVIDERS", { name });
      continue;
    }
    providers.push(factory(ai, options));
  }
  return providers;
}
