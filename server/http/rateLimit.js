// weight lets one limiter count bytes instead of requests: allow(ip, upload.length).
export function createRateLimiter({ limit, windowMs = 60000, now = Date.now }) {
  const hits = new Map();

  return function allow(key, weight = 1) {
    const time = now();
    const recent = (hits.get(key) || []).filter(([stamp]) => time - stamp < windowMs);
    const used = recent.reduce((sum, [, amount]) => sum + amount, 0);
    if (used + weight > limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push([time, weight]);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [other, stamps] of hits) {
        if (!stamps.some(([stamp]) => time - stamp < windowMs)) hits.delete(other);
      }
    }
    return true;
  };
}
