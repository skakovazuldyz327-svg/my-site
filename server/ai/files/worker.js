import { parentPort, workerData } from "node:worker_threads";
import { LIMITS } from "../conversation.js";
import { officeText } from "./office.js";
import { plainText } from "./text.js";

function tidy(text) {
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const { kind, name } = workerData;
const bytes = Buffer.from(workerData.bytes.buffer, workerData.bytes.byteOffset, workerData.bytes.byteLength);
const text = tidy(kind === "office" ? officeText(name, bytes) : plainText(name, bytes));
const excerpt = text.slice(0, LIMITS.excerpt).replace(/[\uD800-\uDBFF]$/, "");
parentPort.postMessage({ excerpt, truncated: text.length > excerpt.length });
