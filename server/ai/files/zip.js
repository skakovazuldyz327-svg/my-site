import { inflateRawSync } from "node:zlib";

// Reads only the wanted entries of an Office/OpenDocument archive; maxBytes caps the unpacked size against zip bombs.
export function readZip(buffer, wanted, maxBytes) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  const files = new Map();
  if (end < 0) return files;
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  let budget = maxBytes;
  for (let n = 0; n < count && pos + 46 <= buffer.length && buffer.readUInt32LE(pos) === 0x02014b50; n += 1) {
    const method = buffer.readUInt16LE(pos + 10);
    const packedSize = buffer.readUInt32LE(pos + 20);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const skip = nameLength + buffer.readUInt16LE(pos + 30) + buffer.readUInt16LE(pos + 32);
    const local = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString("utf8", pos + 46, pos + 46 + nameLength);
    pos += 46 + skip;
    if (!wanted(name) || local + 30 > buffer.length) continue;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + packedSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(1, budget) });
    else continue;
    budget -= data.length;
    if (budget < 0) throw new Error("archive unpacks too large");
    files.set(name, data.toString("utf8"));
  }
  return files;
}
