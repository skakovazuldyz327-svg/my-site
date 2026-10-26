import { promisify } from "node:util";
import { crc32, deflateRaw, deflateRawSync } from "node:zlib";

const deflateAsync = promisify(deflateRaw);
const STORE = 0;
const DEFLATE = 8;
// Photos are compressed already: deflating them again costs time and saves nothing.
const PACKED_FORMATS = /\.(jpe?g|jfif|png|webp|gif|avif|zip|gz|mp4|pdf)$/i;

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function assemble(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data, date = new Date(), method, packed } of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const { time, day } = dosTime(date);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

// Minimal ZIP writer (deflate, UTF-8 names) so the backup needs no npm packages.
export function createZip(entries) {
  return assemble(entries.map((entry) => ({ ...entry, method: DEFLATE, packed: deflateRawSync(entry.data) })));
}

// Compresses on the libuv thread pool, so a large backup does not stop the server from answering visitors.
export async function createZipAsync(entries) {
  const files = [];
  for (const entry of entries) {
    files.push(PACKED_FORMATS.test(entry.name)
      ? { ...entry, method: STORE, packed: entry.data }
      : { ...entry, method: DEFLATE, packed: await deflateAsync(entry.data) });
  }
  return assemble(files);
}
