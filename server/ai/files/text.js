const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? match;
    const point = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  });
}

export function stripTags(xml) {
  return decodeEntities(xml.replace(/<[^>]*>/g, ""));
}

// Russian documents saved by old Windows programs are in Windows-1251; the BOM tells UTF-16 apart.
export function decodeText(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return bytes.toString("utf8", 3);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

// Font tables, styles, pictures and other "{\*...}" destinations hold no text the client wrote.
function dropGroups(rtf) {
  const skip = /^\{\\(?:\*\\[a-z]+|fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|rsidtbl|generator)/i;
  let out = "";
  let i = 0;
  while (i < rtf.length) {
    if (rtf[i] === "{" && skip.test(rtf.slice(i, i + 24))) {
      let depth = 0;
      for (; i < rtf.length; i += 1) {
        if (rtf[i] === "\\") i += 1;
        else if (rtf[i] === "{") depth += 1;
        else if (rtf[i] === "}" && --depth === 0) {
          i += 1;
          break;
        }
      }
      continue;
    }
    out += rtf[i];
    i += 1;
  }
  return out;
}

// Escaped "\\", "\{" and "\}" are parked in private-use characters so the control-word cleanup cannot eat them.
const RTF_ESCAPES = { "\\": "\uE000", "{": "\uE001", "}": "\uE002" };

export function rtfToText(rtf) {
  const cp1251 = new TextDecoder("windows-1251");
  // "\u1072\'e0": the character after \uN is a fallback for old readers and must not be printed twice.
  return dropGroups(rtf)
    .replace(/[\uE000-\uE002]/g, "")
    .replace(/\\([\\{}])/g, (_, char) => RTF_ESCAPES[char])
    .replace(/\\\r?\n/g, "\\par ")
    .replace(/(\\[a-z]+-?\d*)\r?\n/gi, "$1 ")
    .replace(/[\r\n]/g, "")
    .replace(/\\u(-?\d+) ?(?:\\'[0-9a-f]{2}|[^\\{}\s])?/gi, (_, code) => String.fromCharCode((Number(code) + 65536) % 65536))
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => cp1251.decode(Uint8Array.of(parseInt(hex, 16))))
    .replace(/\\(par|line)\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\~/g, " ")
    .replace(/\\[a-z]+-?\d* ?|\\[^a-z\s]|[{}]/gi, "")
    .replace(/[\uE000-\uE002]/g, (char) => Object.keys(RTF_ESCAPES).find((key) => RTF_ESCAPES[key] === char));
}

export function htmlToText(html) {
  return stripTags(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, "")
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|table)>/gi, "\n")
      .replace(/<\/t[dh]>/gi, "\t")
  ).replace(/[ \t]{2,}/g, " ");
}

// A program or an archive renamed to .txt would otherwise reach the model as pages of garbage.
export function plainText(name, bytes) {
  const text = decodeText(bytes);
  if (text.includes("\u0000")) throw new Error("binary file");
  if (/\.rtf$/i.test(name) || text.startsWith("{\\rtf")) return rtfToText(text);
  if (/\.html?$/i.test(name)) return htmlToText(text);
  if (/\.svg$/i.test(name)) return stripTags(text.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "").replace(/<\/(text|title|desc|tspan)>/gi, "$& "));
  return text;
}
