import { useEffect, useState } from "react";
import Dialog from "../components/Dialog.jsx";
import { clampQty, formatPrice } from "../lib/catalog.js";
import { sendOrder } from "../lib/order.js";
import ClientFields, { useClientForm } from "./ClientFields.jsx";
import { useShop } from "./ShopContext.jsx";

export default function OrderDialog({ open, order, onClose, onAdded, onSent }) {
  const { addToBag } = useShop();
  const client = useClientForm();
  const [size, setSize] = useState("");
  const [qty, setQty] = useState("1");
  const [seenKey, setSeenKey] = useState(null);

  const product = order?.product;
  const sizes = product?.sizes || [];

  if (order && order.key !== seenKey) {
    setSeenKey(order.key);
    setSize(sizes.includes(order.size) ? order.size : sizes[0] || "");
    setQty(String(order.qty));
    client.fill();
  }

  useEffect(() => {
    if (open) client.focusFirst();
  }, [open, order?.key]);

  const currentItem = () => ({ id: product.id, size: sizes.length ? size : "", qty: clampQty(qty) });

  const submit = (event) => {
    event.preventDefault();
    const data = client.validate();
    if (!data) return;
    const saved = sendOrder([currentItem()], data);
    onClose();
    onSent(saved);
  };

  const add = () => {
    addToBag(currentItem());
    onAdded();
  };

  return (
    <Dialog id="order" open={open} onClose={onClose} className="order" labelledBy="order-name">
      {product && (
        <form className="order-box" noValidate onSubmit={submit}>
          <button className="order-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
          <p className="item-tag">Заявка</p>
          <h3 id="order-name">{product.name}</h3>
          <p className="order-price">{formatPrice(product.price, product)} за штуку</p>
          <div className="order-pair">
            <label hidden={!sizes.length}>
              Размер
              <select value={size} onChange={(event) => setSize(event.target.value)}>
                {sizes.map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Количество
              <input type="number" min="1" max="20" inputMode="numeric" value={qty} onChange={(event) => setQty(event.target.value)} />
            </label>
          </div>
          <ClientFields form={client} idPrefix="order-client" />
          <p className="order-total">Сумма: <strong>{formatPrice(product.price * clampQty(qty), product)}</strong></p>
          <button className="btn btn-wa" type="submit">Отправить заказ в WhatsApp</button>
          <button className="btn btn-ghost" type="button" onClick={add}>Добавить в корзину и выбрать ещё</button>
        </form>
      )}
    </Dialog>
  );
}
