import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config.js";
import { holdFolder } from "./instance.js";
import { CounterUnreadableError, listBackups, restoreBackup } from "./store/restore.js";

const config = loadConfig();

if (!(await holdFolder(config.root))) {
  console.log("  The site is still running - close its window or run stop-site.bat, then try again. Nothing was changed.");
  process.exit(1);
}

const backups = listBackups(config.paths);
if (!backups.length) {
  console.log("  There are no database copies in db\\backups yet. Nothing was changed.");
  process.exit(1);
}

console.log("");
console.log("  Daily copies of the database (the state at the first visit of that day):");
backups.forEach(({ day, info }, index) => {
  console.log(`  ${String(index + 1).padStart(3)}. ${day}   orders: ${info.orders} (last No. ${info.lastOrder})   products: ${info.products}   clients: ${info.clients}`);
});
console.log("");

const prompt = createInterface({ input: process.stdin, output: process.stdout });
const lines = prompt[Symbol.asyncIterator]();
// Lines that arrive before their question is shown are kept, and closed input counts as Enter.
async function ask(question) {
  process.stdout.write(question);
  const { value = "" } = await lines.next();
  return value.trim();
}

const answer = await ask("  Number of the copy to restore (Enter to cancel): ");
const chosen = /^\d+$/.test(answer) ? backups[Number(answer) - 1] : undefined;
if (!chosen) {
  prompt.close();
  console.log("  Nothing was changed.");
  process.exit(0);
}

let kept;
try {
  try {
    kept = restoreBackup(config.paths, chosen);
  } catch (error) {
    if (!(error instanceof CounterUnreadableError)) throw error;
    console.log("");
    console.log(`  ${error.message}.`);
    console.log("  Without it the site could give a client a number another client already has.");
    const typed = await ask("  The last order number clients were given (see WhatsApp; Enter to cancel): ");
    if (!/^[1-9]\d*$/.test(typed)) {
      console.log("  Nothing was changed.");
      process.exit(1);
    }
    kept = restoreBackup(config.paths, chosen, { lastNumber: Number(typed) });
  }
} catch (error) {
  console.log("");
  console.log(`  Restore failed: ${error.message}.`);
  process.exit(1);
} finally {
  prompt.close();
}
console.log("");
console.log(`  Restored the copy of ${chosen.day}.`);
if (kept) console.log(`  The database it replaced is kept as db\\${kept} - orders taken after ${chosen.day} are in it.`);
console.log("  Start the site with start-site.bat.");
