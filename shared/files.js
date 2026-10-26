// One list for the server's file readers and the chat's "консультант прочитает" hint, so they never disagree.
export const READ_LIMITS = {
  image: 10 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  office: 25 * 1024 * 1024,
  text: 2 * 1024 * 1024
};

const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif)$/;
const IMAGE_NAME = /\.(jpe?g|png|webp|gif)$/i;
const OFFICE_NAME = /\.(docx|xlsx|pptx|odt|ods|odp)$/i;
const TEXT_NAME = /\.(txt|csv|tsv|json|md|xml|log|ini|ya?ml|html?|rtf|svg)$/i;

export function fileKind({ name = "", type = "" } = {}) {
  if (IMAGE_TYPE.test(type) || IMAGE_NAME.test(name)) return "image";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (OFFICE_NAME.test(name)) return "office";
  if (/^text\//.test(type) || /[/+](json|xml)$/.test(type) || TEXT_NAME.test(name)) return "text";
  return "";
}

export function canBeRead(file) {
  const kind = fileKind(file);
  return Boolean(kind) && (Number(file?.size) || 0) <= READ_LIMITS[kind];
}
