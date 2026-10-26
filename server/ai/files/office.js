import { decodeEntities, stripTags } from "./text.js";
import { readZip } from "./zip.js";

// Text parts of a document are small even when its photos weigh megabytes.
const MAX_UNPACKED = 30 * 1024 * 1024;

const byNumber = (a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1] || 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] || 0);
const all = (text, pattern) => [...text.matchAll(pattern)];

// A bare <w:tab/> is a tab in the text; <w:tab w:val=.../> inside <w:tabs> only sets tab stops.
const BREAKS = /<(?:w|a):tab\/>|<(?:w|a):br\b[^>]*>|<w:cr\b[^>]*\/>|<w:noBreakHyphen\/>/;
const breakText = (tag) => (tag.includes("tab") ? "\t" : tag.includes("noBreakHyphen") ? "-" : "\n");

function runs(xml, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>|${BREAKS.source}`, "g");
  return all(xml, pattern).map((match) => (match[1] !== undefined ? decodeEntities(match[1]) : breakText(match[0]))).join("");
}

// Word and PowerPoint keep a second copy of text boxes and shapes for old readers.
const dropFallbacks = (xml) => xml.replace(/<mc:Fallback\b[\s\S]*?<\/mc:Fallback>/g, "");

function docx(files) {
  return ["word/document.xml", "word/footnotes.xml"]
    .filter((name) => files.has(name))
    .map((name) => dropFallbacks(files.get(name)).split("</w:p>").map((part) => runs(part, "w:t")).join("\n"))
    .join("\n\n");
}

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

// Excel stores dates as day numbers; only the cell style says the number is a date.
function dateStyles(styles) {
  const custom = new Map(all(styles, /<numFmt\b[^>]*\bnumFmtId="(\d+)"[^>]*\bformatCode="([^"]*)"/g).map(([, id, code]) => [Number(id), decodeEntities(code)]));
  const isDate = (id) => {
    if (DATE_FORMATS.has(id)) return true;
    const code = custom.get(id);
    if (!code || /\[[hms]+\]/i.test(code)) return false;
    return /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, ""));
  };
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] || "";
  return all(cellXfs, /<xf\b([^>]*)/g).map(([, attrs]) => isDate(Number(/\bnumFmtId="(\d+)"/.exec(attrs)?.[1])));
}

function excelDate(serial) {
  const date = new Date(Math.round((serial - 25569) * 86400000));
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${pad(date.getUTCDate())}.${pad(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (serial < 1) return time;
  return serial % 1 ? `${day} ${time}` : day;
}

function xlsx(files) {
  const shared = all(files.get("xl/sharedStrings.xml") || "", /<si>([\s\S]*?)<\/si>/g).map((match) => runs(match[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, ""), "t"));
  const names = all(files.get("xl/workbook.xml") || "", /<sheet\b[^>]*?\bname="([^"]*)"/g).map((match) => decodeEntities(match[1]));
  const dates = dateStyles(files.get("xl/styles.xml") || "");
  const sheets = [...files.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort(byNumber);
  return sheets.map((sheet, index) => {
    const rows = all(files.get(sheet), /<row\b[^>]*>([\s\S]*?)<\/row>/g).map((row) =>
      all(row[1], /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g).map(([, attrs, body = ""]) => {
        const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
        const value = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        if (type === "s") return shared[Number(value)] ?? "";
        if (type === "inlineStr") return runs(body, "t");
        if (type === "b") return value === "1" ? "ИСТИНА" : value === "0" ? "ЛОЖЬ" : "";
        if (value === undefined) return "";
        const style = Number(/\bs="(\d+)"/.exec(attrs)?.[1] || 0);
        if (!type && dates[style] && Number.isFinite(Number(value))) return excelDate(Number(value));
        return decodeEntities(value);
      }).join("\t").replace(/\t+$/, "")
    ).filter(Boolean);
    return `Лист «${names[index] || index + 1}»:\n${rows.join("\n")}`;
  }).join("\n\n");
}

function pptx(files) {
  return [...files.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(byNumber).map((slide, index) => {
    const lines = all(dropFallbacks(files.get(slide)), /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g).map((match) => runs(match[1], "a:t")).filter(Boolean);
    return `Слайд ${index + 1}:\n${lines.join("\n")}`;
  }).join("\n\n");
}

function openDocumentInline(xml) {
  return stripTags(xml.replace(/<text:s\b[^>]*\/>/g, " ").replace(/<text:tab\/>/g, "\t").replace(/<text:line-break\/>/g, "\n"));
}

function openDocument(files, ext) {
  const content = (files.get("content.xml") || "").replace(/<text:[ph]\b[^>]*\/>/g, "");
  if (ext === "ods") {
    return all(content, /<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g).map((row) =>
      all(row[1], /<table:table-cell\b[^>]*?(?:\/>|>([\s\S]*?)<\/table:table-cell>)/g).map(([, body = ""]) => openDocumentInline(body.replace(/<\/text:p>/g, " ")).trim()).join("\t").replace(/\t+$/, "")
    ).filter(Boolean).join("\n");
  }
  return all(content, /<text:(p|h)\b[^>]*>([\s\S]*?)<\/text:\1>/g).map((match) => openDocumentInline(match[2])).join("\n");
}

const PARTS = {
  docx: (name) => name === "word/document.xml" || name === "word/footnotes.xml",
  xlsx: (name) => ["xl/sharedStrings.xml", "xl/workbook.xml", "xl/styles.xml"].includes(name) || /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  pptx: (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name),
  open: (name) => name === "content.xml"
};
const READERS = { docx, xlsx, pptx };

// An old .doc or a password-protected file renamed to .docx is not an archive: say so instead of "no text".
export function officeText(name, bytes) {
  const ext = String(name).split(".").pop().toLowerCase();
  const files = readZip(bytes, PARTS[READERS[ext] ? ext : "open"], MAX_UNPACKED);
  if (!files.size) throw new Error("not an office document");
  return READERS[ext] ? READERS[ext](files) : openDocument(files, ext);
}
