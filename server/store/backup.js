import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { dumpDatabase } from "./db.js";
import { dumpBytes, writeDumpFile } from "./dumps.js";
import { listFiles } from "./files.js";
import { createZipAsync } from "./zip.js";

// The daily copy is asked for on every request; while the database is down a failed one is tried again only this often.
const DAILY_RETRY_MS = 5 * 60 * 1000;

const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function createBackups(config, db, { catalog, orders, clients }) {
  const { paths } = config;
  let lastDay = "";
  let running = null;
  let failedAt = -Infinity;

  // The dump reads the whole database at one moment, so the copy is consistent even while the site keeps working.
  const snapshot = async (file) => writeDumpFile(file, await dumpDatabase(db));

  // Keeps the first state of each day, so a restart after a mistake does not overwrite the good copy.
  async function daily() {
    const day = dayOf(new Date());
    if (lastDay === day) return;
    const target = join(paths.backups, day, "zhuldyz.json");
    if (!existsSync(target)) await snapshot(target);
    const days = (await readdir(paths.backups, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const old of days.slice(config.backupDays)) await rm(join(paths.backups, old), { recursive: true, force: true });
    lastDay = day;
  }

  // A copy in a folder outside the site (a OneDrive folder, a USB stick) survives a broken disk. Today's file is replaced
  // with a fresh one on every run, earlier days are kept like the daily copies. Photos are only ever added: a saved photo
  // never changes under its name, and one the site removed may still be needed by an older copy of the database.
  async function offsite() {
    const dir = config.backupCopyDir;
    if (!dir) return null;
    const databases = join(dir, "db");
    const target = join(databases, `zhuldyz-${dayOf(new Date())}.json`);
    await snapshot(target);
    let photos = 0;
    for (const file of await listFiles(paths.images)) {
      const copy = join(dir, relative(config.root, file));
      if (existsSync(copy)) continue;
      await mkdir(dirname(copy), { recursive: true });
      await copyFile(file, `${copy}.tmp`);
      await rename(`${copy}.tmp`, copy);
      photos += 1;
    }
    // Copies from the SQLite days (.sqlite) age out together with the new ones.
    const copies = (await readdir(databases)).filter((name) => /^zhuldyz-\d{4}-\d{2}-\d{2}\.(json|sqlite)$/.test(name));
    const days = [...new Set(copies.map((name) => name.slice(8, 18)))].sort().reverse();
    const kept = new Set(days.slice(0, config.backupDays));
    for (const name of copies) if (!kept.has(name.slice(8, 18))) await rm(join(databases, name), { force: true });
    return { file: target, photos };
  }

  let copying = null;

  return {
    daily() {
      if (running) return running;
      if (Date.now() - failedAt < DAILY_RETRY_MS) return Promise.resolve();
      running = daily()
        .catch((error) => {
          failedAt = Date.now();
          throw error;
        })
        .finally(() => { running = null; });
      return running;
    },

    offsite() {
      if (!copying) copying = offsite().finally(() => { copying = null; });
      return copying;
    },

    // The database for restoring, the same data as readable JSON per list, and the product photos.
    async zip() {
      const now = new Date();
      const json = (value) => Buffer.from(JSON.stringify(value, null, 2), "utf8");
      const entries = [
        { name: "db/zhuldyz.json", data: dumpBytes(await dumpDatabase(db)), date: now },
        { name: "export/products.json", data: json(await catalog.read()), date: now },
        { name: "export/orders.json", data: json(await orders.read()), date: now },
        { name: "export/clients.json", data: json(await clients.read()), date: now }
      ];
      const files = [...(existsSync(paths.ordersRescue) ? [paths.ordersRescue] : []), ...(await listFiles(paths.images))];
      for (const file of files) {
        const info = await stat(file);
        entries.push({ name: relative(config.root, file).split(sep).join("/"), data: await readFile(file), date: info.mtime });
      }
      return createZipAsync(entries);
    }
  };
}
