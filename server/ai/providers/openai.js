const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

// Half of an emoji left by any length cut is serialized as "\ud83d", and the API rejects the whole request as invalid JSON.
const wellFormed = (key, value) => (typeof value === "string" ? value.toWellFormed() : value);

function toOpenAiMessage(message, imageDetail) {
  if (message.role === "tool") return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  if (message.role === "assistant") {
    const out = { role: "assistant", content: message.text || null };
    if (message.toolCalls?.length) {
      out.tool_calls = message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }));
    }
    return out;
  }
  const images = message.images || [];
  const files = message.files || [];
  if (!images.length && !files.length) return { role: "user", content: message.text };
  return {
    role: "user",
    content: [
      { type: "text", text: message.text || "Клиент прислал файл." },
      ...images.map((url) => ({ type: "image_url", image_url: { url, detail: imageDetail } })),
      ...files.map((file) => ({ type: "file", file: { filename: file.name, file_data: file.data } }))
    ]
  };
}

/**
 * Works with OpenAI and any OpenAI-compatible endpoint (OpenRouter, a local Ollama, Gemini's compatibility API)
 * by changing OPENAI_BASE_URL and OPENAI_MODEL.
 */
// imageDetail "low" sees a photo at about 512px: cheaper, but labels, receipts and small defects become unreadable.
export function createOpenAiProvider({ id = "openai", key, model, baseUrl, maxTokens = 600, imageDetail = "auto", fetchImpl = fetch }) {
  const detail = ["low", "high", "auto"].includes(imageDetail) ? imageDetail : "auto";
  async function post(body, signal) {
    for (let attempt = 0; ; attempt += 1) {
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify(body, wellFormed),
          signal
        });
      } catch (error) {
        if (signal?.aborted || attempt >= 1) throw error;
        await sleep(800, signal);
        continue;
      }
      if (response.ok) return response.json();
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      if (attempt >= 1 || !RETRY_STATUSES.has(response.status)) throw new Error(`${id} HTTP ${response.status}: ${detail}`);
      const wait = Math.min(5000, Number(response.headers.get("retry-after")) * 1000 || 1000);
      await sleep(wait, signal);
    }
  }

  return {
    id,
    available: () => Boolean(key),

    async chat({ system, messages, tools, toolChoice, signal }) {
      const body = {
        model,
        messages: [{ role: "system", content: system }, ...messages.map((message) => toOpenAiMessage(message, detail))],
        // Reasoning models spend this cap on thinking first; at 600 they often return no answer at all.
        max_completion_tokens: /^(o\d|gpt-5)/.test(model) ? Math.max(maxTokens, 4000) : maxTokens
      };
      if (/^gpt-4/.test(model)) body.temperature = 0.3;
      if (tools?.length) {
        body.tools = tools.map((tool) => ({ type: "function", function: tool }));
        body.tool_choice = toolChoice === "required" ? "required" : { type: "function", function: { name: toolChoice.name } };
      }
      const data = await post(body, signal);
      const message = data?.choices?.[0]?.message || {};
      return {
        text: typeof message.content === "string" ? message.content : "",
        toolCalls: (message.tool_calls || []).map((call) => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments || "{}" })),
        usage: { input: data?.usage?.prompt_tokens || 0, output: data?.usage?.completion_tokens || 0 }
      };
    }
  };
}
