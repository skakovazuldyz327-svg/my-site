// Browsers that block site data throw even on reading window.localStorage, and a full storage throws on write.
// Values that could not be saved are kept in memory so the bag and the chat still work until the page is closed.
const fallback = new Map();

function area(name) {
  try {
    return window[name] || null;
  } catch {
    return null;
  }
}

export function storageGet(key, name = "localStorage") {
  const id = `${name}:${key}`;
  if (fallback.has(id)) return fallback.get(id);
  try {
    return area(name)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(key, value, name = "localStorage") {
  const id = `${name}:${key}`;
  try {
    area(name).setItem(key, value);
    fallback.delete(id);
  } catch {
    fallback.set(id, String(value));
  }
}

export function storageRemove(key, name = "localStorage") {
  fallback.delete(`${name}:${key}`);
  try {
    area(name)?.removeItem(key);
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}
