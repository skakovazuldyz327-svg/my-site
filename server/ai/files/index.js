import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { fileKind, READ_LIMITS } from "../../../shared/files.js";
import { silentLogger } from "../../log.js";
import { LIMITS } from "../conversation.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SESSION = /^[a-z0-9]{6,20}$/;
const WORKER = new URL("./worker.js", import.meta.url);
const PARALLEL_READS = 2;

// A crafted document can keep the text parsers busy for hours, so they run off the main thread and are stopped
// after timeoutMs: the site keeps answering everyone else while one file is being read.
function readInWorker(job, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: job, resourceLimits: { maxOldGenerationSizeMb: 512 } });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("file took too long to read"));
    }, timeoutMs);
    worker.once("message", (result) => {
      clearTimeout(timer);
      resolve(result);
      worker.terminate();
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`file reader stopped with code ${code}`));
    });
  });
}

function createQueue(size) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= size || !waiting.length) return;
    active += 1;
    waiting.shift()();
  };
  return (task) => new Promise((resolve) => {
    waiting.push(resolve);
    next();
  }).then(task).finally(() => {
    active -= 1;
    next();
  });
}

// The model is told the real format, never the one the visitor's browser claimed.
function imageType(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(PNG)) return "image/png";
  if (bytes.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return "";
}

/**
 * Reads the visitor's uploaded chat files for the model: text of documents and tables, photos, PDFs.
 * A file is read only for the chat session that uploaded it, so a guessed id cannot expose someone else's file.
 */
export function createFileReader({ store, logger = silentLogger, timeoutMs = 10000 }) {
  const texts = new Map();
  const queue = createQueue(PARALLEL_READS);

  // A failure is remembered too, so a file that timed out once does not take a reader again on every message.
  async function textOf(entry, kind, path) {
    if (!texts.has(entry.id)) {
      // The bytes are loaded only when a reader is free, so files waiting in the queue hold no memory.
      const reading = queue(async () => readInWorker({ kind, name: entry.name, bytes: await readFile(path) }, timeoutMs))
        .catch((error) => ({ error: error.message }));
      texts.set(entry.id, reading);
      if (texts.size > 200) texts.delete(texts.keys().next().value);
    }
    const result = await texts.get(entry.id);
    if (result.error) throw new Error(result.error);
    return result;
  }

  async function readOne(file, session, budget) {
    const found = file.id && session ? await store.chatFiles.find(file.id) : null;
    if (!found || found.entry.session !== session) return { kind: fileKind(file), status: "missing" };
    const { entry, path } = found;
    const kind = fileKind(entry);
    const known = { name: entry.name, size: Number(entry.size) || 0, type: entry.type || "", kind };
    if (!kind) return { ...known, status: "unreadable" };
    if (known.size > READ_LIMITS[kind]) return { ...known, status: "too-big" };
    try {
      if (kind === "text" || kind === "office") {
        if (budget.text <= 0) return { ...known, status: budget.latest ? "limit" : "earlier" };
        const read = await textOf(entry, kind, path);
        if (!read.excerpt) return { ...known, status: "empty" };
        const excerpt = read.excerpt.slice(0, budget.text).replace(/[\uD800-\uDBFF]$/, "");
        budget.text -= excerpt.length;
        return { ...known, status: "read", excerpt, truncated: read.truncated || excerpt.length < read.excerpt.length };
      }
      const left = kind === "image" ? "images" : "pdfs";
      if (!budget.media) return { ...known, status: "earlier" };
      if (budget[left] <= 0 || known.size > budget.bytes) return { ...known, status: "limit" };
      const bytes = await readFile(path);
      const type = kind === "image" ? imageType(bytes) : bytes.toString("latin1", 0, 5) === "%PDF-" ? "application/pdf" : "";
      if (!type) return { ...known, status: "unreadable" };
      budget[left] -= 1;
      budget.bytes -= bytes.length;
      return { ...known, status: "read", data: `data:${type};base64,${bytes.toString("base64")}` };
    } catch (error) {
      logger.warn("chat file read failed", { kind, message: error.message });
      return { ...known, status: "unreadable" };
    }
  }

  return {
    // Fills the files of the turns the model will see, newest first: photos and PDFs travel only for the latest
    // user turns, and older documents get what is left of the shared text budget.
    async attach(turns, rawSession) {
      const session = SESSION.test(String(rawSession || "")) ? String(rawSession) : "";
      const budget = { images: LIMITS.images, pdfs: LIMITS.pdfs, bytes: LIMITS.mediaBytes, text: LIMITS.excerptTotal, media: false, latest: false };
      let userTurns = 0;
      const recent = turns.slice(-LIMITS.aiMessages);
      for (let index = recent.length - 1; index >= 0; index -= 1) {
        const turn = recent[index];
        if (turn.role !== "user") continue;
        budget.latest = userTurns === 0;
        budget.media = userTurns < LIMITS.mediaTurns;
        userTurns += 1;
        for (const file of turn.files) Object.assign(file, await readOne(file, session, budget));
      }
      return turns;
    }
  };
}
