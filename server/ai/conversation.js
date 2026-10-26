export const LIMITS = {
  messages: 40,
  aiMessages: 12,
  text: 9000,
  files: 5,
  excerpt: 8000,
  excerptTotal: 24000,
  images: 3,
  pdfs: 2,
  mediaBytes: 20 * 1024 * 1024,
  mediaTurns: 2
};

const FILE_ID = /^[0-9a-f]{12}$/;

const NOTES = {
  missing: "файл не дошёл до сайта, содержимое недоступно",
  "too-big": "файл слишком большой, консультант его не читает",
  earlier: "был в чате раньше, сейчас не приложен",
  limit: "не поместился: за один раз консультант смотрит до 3 фото, 2 PDF и ограниченный объём текста",
  empty: "текста в файле не нашлось",
  unreadable: "этот формат консультант прочитать не может"
};

function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

// Never leaves half of an emoji at the cut.
function cleanString(value, max) {
  return typeof value === "string" ? value.slice(0, max).replace(/[\uD800-\uDBFF]$/, "") : "";
}

// Only a reference travels from the browser; what the file contains is read on the server (see ./files).
function cleanFiles(files) {
  return (Array.isArray(files) ? files : []).filter((file) => file && typeof file.name === "string").slice(0, LIMITS.files).map((file) => ({
    id: typeof file.id === "string" && FILE_ID.test(file.id) ? file.id : "",
    name: cleanString(file.name, 120),
    size: Number(file.size) || 0,
    type: cleanString(file.type, 100)
  }));
}

function cleanProducts(products) {
  return (Array.isArray(products) ? products : []).filter((product) => product && typeof product.name === "string").slice(0, 2).map((product) => ({
    id: cleanString(product.id, 60),
    name: cleanString(product.name, 200),
    price: cleanString(product.price, 60)
  }));
}

function filesNote(files) {
  return files.map((file) => {
    const head = `[Клиент прикрепил ${file.kind === "image" ? "фото" : "файл"} «${file.name}», ${fileSize(file.size)}${file.type ? `, ${file.type}` : ""}]`;
    if (file.excerpt) return `${head}\nСодержимое файла${file.truncated ? " (показано начало)" : ""}:\n${file.excerpt}`;
    if (file.data) return `${head} — приложено к сообщению.`;
    return `${head} — ${NOTES[file.status] || NOTES.unreadable}.`;
  }).join("\n");
}

function pdfName(name) {
  const clean = String(name || "file").replace(/[^\w\s.\-()]/g, "_").trim() || "file";
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean}.pdf`;
}

export function cleanTurns(body) {
  const raw = Array.isArray(body?.messages) ? body.messages.slice(-LIMITS.messages) : [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      role: item.role === "user" ? "user" : "bot",
      text: cleanString(item.text, LIMITS.text).trim(),
      files: cleanFiles(item.files),
      products: cleanProducts(item.products)
    }))
    .filter((item) => item.text || item.files.length);
}

/**
 * Turns cleaned chat turns (files already filled in by the file reader) into two views of the same thread:
 * - history: plain text turns with shown products, for the rules consultant and WhatsApp handoff;
 * - conversation: provider-neutral turns with images and PDFs, for the model.
 */
export function buildRequest(turns) {
  const history = turns.map(({ role, text, files, products }) => ({
    role,
    text: [text, files.map((file) => `(файл: ${file.name})`).join(" ")].filter(Boolean).join(" "),
    files: files.map(({ name, size, type }) => ({ name, size, type })),
    products
  }));

  const conversation = turns.slice(-LIMITS.aiMessages).map((turn) => {
    const images = turn.files.filter((file) => file.kind === "image" && file.data).map((file) => file.data);
    const pdfs = turn.files.filter((file) => file.kind === "pdf" && file.data).map((file) => ({ name: pdfName(file.name), data: file.data }));
    const text = cleanString([turn.text, filesNote(turn.files)].filter(Boolean).join("\n"), LIMITS.text + LIMITS.files * LIMITS.excerpt);
    return {
      role: turn.role === "user" ? "user" : "assistant",
      text: text || (images.length || pdfs.length ? "Клиент прислал файл." : ""),
      images,
      files: pdfs
    };
  });

  const lastUser = [...turns].reverse().find((turn) => turn.role === "user");
  return {
    history,
    conversation: conversation.filter((turn) => turn.text || turn.images.length || turn.files.length),
    lastUserText: lastUser ? lastUser.text : "",
    onlyFiles: Boolean(lastUser && !lastUser.text && lastUser.files.length)
  };
}

export function normalizeRequest(body) {
  return buildRequest(cleanTurns(body));
}
