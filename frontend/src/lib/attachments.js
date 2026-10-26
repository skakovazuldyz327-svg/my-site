import { canBeRead, READ_LIMITS } from "../../../shared/files.js";

export const CHAT_MAX_FILES = 5;
export const CHAT_MAX_SIZE = 25 * 1024 * 1024;
const CHAT_PREVIEW_SIDE = 640;
const CHAT_PHOTO_SIDE = 2560;
const MODEL_IMAGE = /^image\/(jpeg|png|webp|gif)$/;

export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

export const canRead = canBeRead;

function decode(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function draw(img, side) {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const jpegName = (name) => `${String(name || "фото").replace(/\.[^.]+$/, "") || "фото"}.jpg`;

/**
 * The preview is only for showing the photo in the chat; the consultant reads the uploaded file on the server.
 * A photo the consultant cannot see (HEIC, AVIF, BMP or a huge camera shot) is re-saved as a JPEG when the browser
 * can open it; otherwise the original goes as is and Zhuldyz looks at it herself.
 */
export async function readAttachment(file) {
  const item = { name: file.name || "файл", size: file.size, type: file.type || "", src: "", file };
  if (!/^image\//.test(item.type) || item.type === "image/svg+xml") return item;
  const img = await decode(file);
  if (!img) return item;
  item.src = draw(img, CHAT_PREVIEW_SIDE).toDataURL("image/jpeg", 0.8);
  if (MODEL_IMAGE.test(item.type) && item.size <= READ_LIMITS.image) return item;
  const blob = await new Promise((resolve) => draw(img, CHAT_PHOTO_SIDE).toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) return item;
  const photo = new File([blob], jpegName(item.name), { type: "image/jpeg" });
  return { ...item, name: photo.name, size: photo.size, type: photo.type, file: photo };
}

// Files travel as references to the uploads; the server reads them and decides what the model sees.
export function chatRequest(items) {
  return items.map((item) => ({
    role: item.role,
    text: item.text || "",
    products: item.products || [],
    files: (item.files || []).map(({ id, name, size, type }) => ({ ...(id ? { id } : {}), name, size, type }))
  }));
}
