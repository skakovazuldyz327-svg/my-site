import { createConsultant } from "../../../shared/consultant/index.js";
import { products, whatsapp } from "./catalog.js";

// Offline copy of the server-side rules: answers when the site server or the network is unavailable.
const consultant = createConsultant({ products, phone: whatsapp });

export const askConsultant = consultant.ask;
export const consultantHandoff = consultant.handoff;
