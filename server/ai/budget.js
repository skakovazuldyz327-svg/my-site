import { readFileSync, renameSync, writeFileSync } from "node:fs";

function dayOf(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// The day's count is kept in a small file, so restarting the site does not hand out a fresh limit.
// A missing or damaged file starts the day at zero: the limit is a guard, not a record worth stopping the site for.
function load(file) {
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    return { day: String(saved.day || ""), used: Number(saved.used) || 0 };
  } catch {
    return { day: "", used: 0 };
  }
}

export function createDailyBudget({ tokens = Infinity, now = () => new Date(), file = "", onSaveError = () => {} } = {}) {
  let { day, used } = file ? load(file) : { day: "", used: 0 };
  let reported = false;

  const roll = () => {
    const today = dayOf(now());
    if (today === day) return;
    day = today;
    used = 0;
    reported = false;
  };

  const save = () => {
    if (!file) return;
    try {
      writeFileSync(`${file}.tmp`, JSON.stringify({ day, used }));
      renameSync(`${file}.tmp`, file);
    } catch (error) {
      onSaveError(error);
    }
  };

  return {
    tokens,

    spend(usage) {
      roll();
      const amount = (Number(usage?.input) || 0) + (Number(usage?.output) || 0);
      if (!amount) return;
      used += amount;
      save();
    },

    used() {
      roll();
      return used;
    },

    exhausted() {
      roll();
      return used >= tokens;
    },

    // True only the first time a day, so the log gets one line instead of one per visitor message.
    reportOnce() {
      if (reported) return false;
      reported = true;
      return true;
    }
  };
}
