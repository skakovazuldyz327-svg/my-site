import { COLORS, SHOP_NAME, SHOP_TAGLINE, shopPhone } from "./format.js";

export const FONT = "NotoSans";

export function shopHeader(whatsapp) {
  const phone = shopPhone(whatsapp);
  return {
    columns: [
      {
        width: "*",
        stack: [
          { text: SHOP_NAME, fontSize: 22, bold: true, color: COLORS.ink },
          { text: SHOP_TAGLINE, fontSize: 10, color: COLORS.muted, margin: [0, 2, 0, 0] }
        ]
      },
      phone
        ? { width: "auto", alignment: "right", stack: [{ text: "WhatsApp", fontSize: 9, color: COLORS.muted }, { text: phone, fontSize: 11, bold: true }] }
        : { width: "auto", text: "" }
    ],
    margin: [0, 0, 0, 10]
  };
}

// pdfmake writes layout data into the nodes it prints, so every document gets fresh objects.
export const rule = () => ({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: COLORS.line }], margin: [0, 0, 0, 16] });

export function pageFooter(whatsapp) {
  const phone = shopPhone(whatsapp);
  return (current, count) => ({
    columns: [
      { text: phone ? `${SHOP_NAME} · WhatsApp ${phone}` : SHOP_NAME, color: COLORS.muted },
      { text: `стр. ${current} из ${count}`, alignment: "right", color: COLORS.muted }
    ],
    fontSize: 8,
    margin: [40, 18, 40, 0]
  });
}

export function baseDoc({ title, whatsapp, content }) {
  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 50],
    info: { title, author: SHOP_NAME, creator: SHOP_NAME },
    defaultStyle: { font: FONT, fontSize: 10, color: COLORS.ink, lineHeight: 1.2 },
    footer: pageFooter(whatsapp),
    content
  };
}
