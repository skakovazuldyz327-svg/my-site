import { existsSync, rmSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { createZipAsync } from "./zip.js";

const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function createBackups(config, db, { catalog, orders, clients }) {
  const { paths } = config;
  let lastDay = "";
  let running = null;

  // VACUUM INTO writes a consistent copy of the whole database even while the site keeps working.
  function snapshot(file) {
    rmSync(file, { force: true });
    db.prepare("VACUUM INTO ?").run(file);
  }

  // Keeps the first state of each day, so a restart after a mistake does not overwrite the good copy.
  async function daily() {
    const day = dayOf(new Date());
    if (lastDay === day) return;
    const target = join(paths.backups, day, "zhuldyz.sqlite");
    if (!existsSync(target)) {
      await mkdir(join(paths.backups, day), { recursive: true });
      snapshot(`${target}.tmp`);
      await rename(`${target}.tmp`, target);
    }
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
    await mkdir(databases, { recursive: true });
    const target = join(databases, `zhuldyz-${dayOf(new Date())}.sqlite`);
    snapshot(`${target}.tmp`);
    await rename(`${target}.tmp`, target);
    let photos = 0;
    for (const file of await listFiles(paths.images)) {
      const copy = join(dir, relative(config.root, file));
      if (existsSync(copy)) continue;
      await mkdir(dirname(copy), { recursive: true });
      await copyFile(file, `${copy}.tmp`);
      await rename(`${copy}.tmp`, copy);
      photos += 1;
    }
    const days = (await readdir(databases)).filter((name) => /^zhuldyz-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)).sort().reverse();
    for (const old of days.slice(config.backupDays)) await rm(join(databases, old), { force: true });
    return { file: target, photos };
  }

  let copying = null;

  return {
    daily() {
      if (!running) running = daily().finally(() => { running = null; });
      return running;
    },

    offsite() {
      if (!copying) copying = offsite().finally(() => { copying = null; });
      return copying;
    },

    // The database for restoring, the same data as JSON for reading without any database tool, and the product photos.
    async zip() {
      const temp = join(paths.db, `full-backup-${process.pid}-${Date.now()}.sqlite`);
      let database;
      try {
        snapshot(temp);
        database = await readFile(temp);
      } finally {
        await rm(temp, { force: true });
      }
      const now = new Date();
      const json = (value) => Buffer.from(JSON.stringify(value, null, 2), "utf8");
      const entries = [
        { name: "db/zhuldyz.sqlite", data: database, date: now },
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
