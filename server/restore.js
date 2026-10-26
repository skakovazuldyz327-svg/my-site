import { createInterface } from "node:readline/promises";
import { loadConfig } from "./config.js";
import { holdFolder } from "./instance.js";
import { listBackups, restoreBackup } from "./store/restore.js";

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
const answer = (await prompt.question("  Number of the copy to restore (Enter to cancel): ")).trim();
prompt.close();
const chosen = /^\d+$/.test(answer) ? backups[Number(answer) - 1] : undefined;
if (!chosen) {
  console.log("  Nothing was changed.");
  process.exit(0);
}

const kept = restoreBackup(config.paths, chosen);
console.log("");
console.log(`  Restored the copy of ${chosen.day}.`);
if (kept) console.log(`  The database it replaced is kept as db\\${kept} - orders taken after ${chosen.day} are in it.`);
console.log("  Start the site with start-site.bat.");
