import { useEffect, useState } from "react";
import Dialog from "../components/Dialog.jsx";
import { settings, whatsapp } from "../lib/catalog.js";
import { invoiceReady } from "../pdf/invoiceDoc.js";

// A slow answer stops the "getting the number" note, but a late one still brings the number and the invoice.
// No hard timeout: a phone freezes the page while the buyer is in WhatsApp, and the answer may be read only on return.
const SLOW_MS = 20 * 1000;

// sent.saved resolves to the order as the server saved it, or to null when the server did not confirm it.
export default function SentDialog({ open, sent, onClose }) {
  const [answer, setAnswer] = useState({ key: null, invoice: null });
  const [slowKey, setSlowKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!sent) return undefined;
    let current = true;
    setFailed(false);
    sent.saved.then((invoice) => {
      if (current) setAnswer({ key: sent.key, invoice });
    });
    const timer = setTimeout(() => setSlowKey(sent.key), SLOW_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [sent]);

  const waiting = Boolean(sent) && answer.key !== sent.key && slowKey !== sent.key;
  const invoice = sent && answer.key === sent.key ? answer.invoice : null;
  const ready = Boolean(invoice) && invoiceReady(invoice);

  // pdfmake (about 2 MB with the fonts) loads only when the buyer asks for the invoice.
  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const { downloadInvoicePdf } = await import("../pdf/index.js");
      await downloadInvoicePdf(invoice, { company: settings.company, whatsapp });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog id="sent" open={open} onClose={onClose} className="order" labelledBy="sent-title">
      <div className="order-box">
        <button className="order-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        <p className="item-tag">Заявка</p>
        <h3 id="sent-title">{invoice ? `Заказ № ${invoice.number} принят` : "Заказ отправлен"}</h3>
        {waiting && <p className="order-note">Получаем номер заказа…</p>}
        {ready && (
          <p className="order-note">Жулдыз ответит в WhatsApp. Если нужен счёт на оплату для бухгалтерии, скачайте его здесь.</p>
        )}
        {invoice && !ready && (
          <p className="order-note">Жулдыз ответит в WhatsApp. Если нужен счёт на оплату, она пришлёт его там.</p>
        )}
        {!waiting && !invoice && (
          <p className="order-note">Номер заказа пока не пришёл. Если нужен счёт на оплату, Жулдыз пришлёт его в WhatsApp.</p>
        )}
        {ready && (
          <button className="btn btn-solid" type="button" disabled={busy} onClick={download}>
            {busy ? "Готовлю счёт…" : "Скачать счёт на оплату (PDF)"}
          </button>
        )}
        {failed && <p className="form-error">Не получилось сделать PDF. Попробуйте ещё раз.</p>}
        <button className="btn btn-ghost" type="button" onClick={onClose}>Готово</button>
      </div>
    </Dialog>
  );
}
