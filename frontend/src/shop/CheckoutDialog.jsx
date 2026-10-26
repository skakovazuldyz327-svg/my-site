import { useEffect, useState } from "react";
import Dialog from "../components/Dialog.jsx";
import { checkBag, droppedNote, orderTotals, SEND_FAILED, sendOrder } from "../lib/order.js";
import ClientFields, { useClientForm } from "./ClientFields.jsx";
import { useShop } from "./ShopContext.jsx";

export default function CheckoutDialog({ open, onClose, onBag, onSent }) {
  const { bag, setBag } = useShop();
  const client = useClientForm();
  const [wasOpen, setWasOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      client.fill();
      setFailed(false);
    }
  }

  useEffect(() => {
    if (open) client.focusFirst();
  }, [open]);

  // The bag is emptied and the window closed only after the order went out, so a failure costs the buyer nothing typed.
  const submit = (event) => {
    event.preventDefault();
    setFailed(false);
    let saved;
    try {
      const { bag: current, dropped } = checkBag();
      setBag(current);
      if (dropped.length || !current.length) {
        onBag(dropped.length ? droppedNote(dropped) : "");
        return;
      }
      const data = client.validate();
      if (!data) return;
      saved = sendOrder(current, data);
    } catch (error) {
      console.error("checkout failed", error);
      setFailed(true);
      return;
    }
    onClose();
    setBag([]);
    onSent(saved);
  };

  return (
    <Dialog id="checkout" open={open} onClose={onClose} className="order" labelledBy="checkout-title">
      <form className="order-box" noValidate onSubmit={submit}>
        <button className="order-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        <p className="item-tag">Заявка</p>
        <h3 id="checkout-title">Оформление заказа</h3>
        <p className="order-note">Оставьте имя и телефон — Жулдыз перезвонит или ответит в WhatsApp.</p>
        <ClientFields form={client} idPrefix="checkout" />
        <p className="order-total">Сумма: <strong>{orderTotals(bag)}</strong></p>
        {failed && <p className="form-error" role="alert">{SEND_FAILED}</p>}
        <button className="btn btn-wa" type="submit">Отправить заказ в WhatsApp</button>
      </form>
    </Dialog>
  );
}
