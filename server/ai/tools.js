const TYPE_CHECKS = {
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  array: (value) => Array.isArray(value),
  object: (value) => value !== null && typeof value === "object" && !Array.isArray(value)
};

// Top-level validation only: enough to reject garbage from the model without pulling in a schema library.
export function validateArgs(schema, args) {
  if (!TYPE_CHECKS.object(args)) return "arguments must be an object";
  for (const name of schema?.required || []) {
    if (args[name] === undefined || args[name] === null) return `missing "${name}"`;
  }
  for (const [name, rule] of Object.entries(schema?.properties || {})) {
    const value = args[name];
    if (value === undefined || value === null) continue;
    const types = [].concat(rule.type || []);
    if (types.length && !types.some((type) => TYPE_CHECKS[type]?.(value))) return `"${name}" must be ${types.join(" or ")}`;
    if (rule.enum && !rule.enum.includes(value)) return `"${name}" must be one of ${rule.enum.join(", ")}`;
  }
  return "";
}

export function createToolRegistry(tools, { timeoutMs = 5000 } = {}) {
  const byName = new Map();
  for (const tool of tools) {
    if (!tool?.name || typeof tool.run !== "function") throw new Error(`Tool without name or run(): ${JSON.stringify(tool?.name)}`);
    if (byName.has(tool.name)) throw new Error(`Tool registered twice: ${tool.name}`);
    byName.set(tool.name, tool);
  }

  return {
    size: byName.size,

    definitions: () => [...byName.values()].map(({ name, description, parameters }) => ({
      name,
      description: description || "",
      parameters: parameters || { type: "object", properties: {} }
    })),

    async run(name, rawArgs, context) {
      const tool = byName.get(name);
      if (!tool) return { error: `unknown tool ${name}` };
      let args;
      try {
        args = typeof rawArgs === "string" ? JSON.parse(rawArgs || "{}") : rawArgs || {};
      } catch {
        return { error: "arguments are not valid JSON" };
      }
      const problem = validateArgs(tool.parameters, args);
      if (problem) return { error: problem };
      let timer;
      try {
        return await Promise.race([
          Promise.resolve(tool.run(args, context)),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("tool timeout")), timeoutMs); })
        ]);
      } catch (error) {
        return { error: error.message };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
