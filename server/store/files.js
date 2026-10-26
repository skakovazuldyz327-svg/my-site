import { randomUUID } from "node:crypto";

// Runs async tasks one after another; chat uploads use it so the quota check and the save cannot interleave.
export function createLock() {
  let tail = Promise.resolve();
  return function locked(task) {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

export const shortId = () => randomUUID().replace(/-/g, "").slice(0, 12);

// Same shape PowerShell wrote ("2026-10-10T00:52:43.7007078+05:00"), so string comparison of dates keeps working.
export function localIso(date = new Date()) {
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}0000${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
