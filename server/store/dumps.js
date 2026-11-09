import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { checkDump } from "./db.js";

export const dumpBytes = (dump) => Buffer.from(JSON.stringify(dump), "utf8");

// Written next to the target and renamed, so a copy cut short by a crash never stands under the real name.
export async function writeDumpFile(file, dump) {
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(`${file}.tmp`, dumpBytes(dump));
    await rename(`${file}.tmp`, file);
  } catch (error) {
    await rm(`${file}.tmp`, { force: true });
    throw error;
  }
}

export function writeDumpFileSync(file, dump) {
  try {
    writeFileSync(`${file}.tmp`, dumpBytes(dump));
    renameSync(`${file}.tmp`, file);
  } catch (error) {
    rmSync(`${file}.tmp`, { force: true });
    throw error;
  }
}

// Throws with the reason when the file is not a whole copy of this site's database.
export function readDumpFile(file) {
  let dump;
  try {
    dump = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(error.code ? error.message : "the file is not a readable copy (broken JSON)", { cause: error });
  }
  checkDump(dump);
  return dump;
}
