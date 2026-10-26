import { availability } from "../../../shared/consultant/index.js";

export default {
  id: "schedule",
  // No phone number here: the model would dictate it instead of pointing to the WhatsApp and call buttons under the answer.
  prompt: (context) => [
    "Жулдыз работает пн–сб 10:00–19:00, вс — по договорённости.",
    `Сейчас: ${availability(context.now)}`
  ].join("\n")
};
