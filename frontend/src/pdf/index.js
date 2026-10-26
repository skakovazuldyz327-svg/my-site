import { catalogDoc, catalogFileName, catalogLayout, COVER_PHOTO } from "./catalogDoc.js";
import { firstPhoto } from "./format.js";
import { invoiceDoc, invoiceFileName } from "./invoiceDoc.js";
import { orderDoc, orderFileName } from "./orderDoc.js";
import { FONT } from "./parts.js";
import boldUrl from "./fonts/NotoSans-Bold.ttf?url";
import regularUrl from "./fonts/NotoSans-Regular.ttf?url";

// pdfmake and the fonts (about 2 MB together) are loaded only when someone asks for a PDF.
let loading = null;

function loadPdfMake() {
  loading ||= import("pdfmake")
    .then((module) => {
      const pdfMake = [module.default, module.default?.default, module].find((candidate) => typeof candidate?.createPdf === "function");
      if (!pdfMake) throw new Error("pdfmake did not load");
      const absolute = (url) => new URL(url, location.href).href;
      pdfMake.setFonts({ [FONT]: { normal: absolute(regularUrl), bold: absolute(boldUrl), italics: absolute(regularUrl), bolditalics: absolute(boldUrl) } });
      // Fonts are the only files pdfmake fetches itself, and only from this site; photos arrive ready as data URLs.
      pdfMake.setUrlAccessPolicy((url) => new URL(url).origin === location.origin);
      return pdfMake;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}

// Starts loading while the photos are prepared; a failure is reported where the result is awaited.
function startLoading() {
  const promise = loadPdfMake();
  promise.catch(() => {});
  return promise;
}

// A photo that does not load (deleted file, link to another site) is left out instead of failing the whole document.
function photoData(src, maxSide) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Catalog photos are drawn into a frame of one size (points times PIXELS_PER_POINT), so the cards line up:
// "contain" fits the whole photo on white, "cover" fills the frame and trims the edges evenly. Nothing is stretched.
const PIXELS_PER_POINT = 2.5;
const COVER_IMAGE = "images/bed.jpg";

function framedPhoto(src, frame, mode = "contain") {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        resolve(null);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(frame.width * PIXELS_PER_POINT);
        canvas.height = Math.round(frame.height * PIXELS_PER_POINT);
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingQuality = "high";
        const fit = mode === "cover" ? Math.max : Math.min;
        const scale = fit(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
        const width = img.naturalWidth * scale;
        const height = img.naturalHeight * scale;
        context.drawImage(img, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
        const data = canvas.toDataURL("image/jpeg", 0.8);
        canvas.width = 0;
        canvas.height = 0;
        resolve(data);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// One photo at a time keeps memory low on a phone; onProgress(done, total) lets the button show how far it got.
async function loadPhotos(sources, load, onProgress) {
  const photos = {};
  const entries = [...sources].filter(([, src]) => src);
  let done = 0;
  for (const [id, src] of entries) {
    photos[id] = await load(src);
    done += 1;
    onProgress?.(done, entries.length);
  }
  return photos;
}

export async function downloadOrderPdf(order, { whatsapp, products = [], onProgress } = {}) {
  const pdfMake = startLoading();
  const byId = new Map(products.map((product) => [product.id, product]));
  const sources = new Map((order.items || []).map((line) => [line.id, firstPhoto(byId.get(line.id))]));
  const photos = await loadPhotos(sources, (src) => photoData(src, 240), onProgress);
  await (await pdfMake).createPdf(orderDoc(order, { whatsapp, photos })).download(orderFileName(order));
}

// company: the seller's details as saved in the admin (settings.company).
export async function downloadInvoicePdf(order, { company, whatsapp } = {}) {
  const pdfMake = await loadPdfMake();
  await pdfMake.createPdf(invoiceDoc(order, { company, whatsapp })).download(invoiceFileName(order));
}

// layout: "grid" (2 columns, the default) or "compact" (3 columns).
export async function downloadCatalogPdf(products, { whatsapp, category = "", layout = "grid", onProgress } = {}) {
  const pdfMake = startLoading();
  const list = products.filter((product) => !category || product.category === category);
  const frame = catalogLayout(layout).photo;
  const sources = new Map(list.map((product) => [product.id, firstPhoto(product)]));
  const [hero, photos] = await Promise.all([
    framedPhoto(COVER_IMAGE, COVER_PHOTO, "cover"),
    loadPhotos(sources, (src) => framedPhoto(src, frame), onProgress)
  ]);
  const doc = catalogDoc(list, { whatsapp, photos, hero, category, layout });
  await (await pdfMake).createPdf(doc).download(catalogFileName());
}
