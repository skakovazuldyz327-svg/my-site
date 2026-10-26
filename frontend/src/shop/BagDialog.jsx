import Dialog from "../components/Dialog.jsx";
import { formatPrice, productById, productImages } from "../lib/catalog.js";
import { orderTotals } from "../lib/order.js";
import { useShop } from "./ShopContext.jsx";

export default function BagDialog({ open, onClose, onCheckout }) {
  const { bag, setBag, note } = useShop();
  const filled = bag.length > 0;

  const changeQty = (target, delta) => {
    setBag(bag.map((item) => (item === target ? { ...item, qty: Math.min(20, Math.max(1, item.qty + delta)) } : item)));
  };

  return (
    <Dialog id="bag" open={open} onClose={onClose} className="order order-bag" labelledBy="bag-title">
      <div className="order-box">
        <button className="order-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        <p className="item-tag">Ваш заказ</p>
        <h3 id="bag-title">Что вы выбрали</h3>
        {note && <p className="form-error" role="status">{note}</p>}
        {!filled && <p className="order-note">Пока пусто. Добавьте матрас, кровать или аксессуар — список останется здесь.</p>}
        <ul className="bag-list">
          {bag.map((item) => {
            const product = productById(item.id);
            const image = productImages(product)[0];
            return (
              <li className="bag-item" key={`${item.id}|${item.size}`}>
                {image ? (
                  <img className="bag-thumb" src={image} alt="" />
                ) : (
                  <div className="bag-thumb bag-thumb-empty">{product.category || "Товар"}</div>
                )}
                <div>
                  <h4>{product.name}</h4>
                  {item.size && <p className="bag-meta">{item.size}</p>}
                  <div className="bag-row">
                    <p className="bag-price">{formatPrice(product.price * item.qty, product)}</p>
                    <div className="bag-actions">
                      <div className="qty">
                        <button type="button" aria-label="Меньше" onClick={() => changeQty(item, -1)}>−</button>
                        <span>{item.qty}</span>
                        <button type="button" aria-label="Больше" onClick={() => changeQty(item, 1)}>+</button>
                      </div>
                      <button className="bag-remove" type="button" onClick={() => setBag(bag.filter((entry) => entry !== item))}>
                        Убрать
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {filled && (
          <>
            <p className="order-total">Сумма: <strong>{orderTotals(bag)}</strong></p>
            <button className="btn btn-solid" type="button" onClick={onCheckout}>Оформить заказ</button>
            <p className="order-note">Дальше — имя и телефон, чтобы Жулдыз могла с вами связаться.</p>
          </>
        )}
      </div>
    </Dialog>
  );
}
