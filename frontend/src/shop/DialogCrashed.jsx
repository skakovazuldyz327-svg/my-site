import Dialog from "../components/Dialog.jsx";
import { waLink } from "../lib/catalog.js";

// Takes the place of a shop window that failed to draw, so the buyer can still close it and reach Zhuldyz.
export default function DialogCrashed({ id, open, onClose }) {
  return (
    <Dialog id={`${id}-crashed`} open={open} onClose={onClose} className="order" labelledBy={`${id}-crashed-title`}>
      <div className="order-box">
        <button className="order-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        <h3 id={`${id}-crashed-title`}>Окно не открылось</h3>
        <p className="order-note">Что-то пошло не так. Товары в корзине и ваши данные сохранены — обновите страницу или напишите Жулдыз в WhatsApp.</p>
        <a className="btn btn-wa" href={waLink} target="_blank" rel="noopener">Написать в WhatsApp</a>
        <button className="btn btn-ghost" type="button" onClick={() => location.reload()}>Обновить страницу</button>
      </div>
    </Dialog>
  );
}
