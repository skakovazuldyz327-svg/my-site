import { waLink } from "../lib/catalog.js";
import Dialog from "./Dialog.jsx";

export default function ContactsDialog({ open, onClose, visitHref }) {
  return (
    <Dialog id="contacts" open={open} onClose={onClose} className="order contacts" labelledBy="contacts-title">
      <div className="order-box">
        <button className="order-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        <p className="item-tag">Контакты</p>
        <h3 id="contacts-title">Связаться с Жулдыз</h3>
        <p className="order-note">Отвечаю сама. Напишите, как спите и какой размер кровати.</p>
        <ul className="contacts-list">
          <li><span>Телефон</span><a href="tel:+77778492164">+7 (777) 849-21-64</a></li>
          <li><span>Почта</span><a href="mailto:zhuldyz.sleep@example.com">zhuldyz.sleep@example.com</a></li>
          <li><span>Часы</span><p>Пн–Сб · 10:00–19:00 · вс — по договорённости</p></li>
        </ul>
        <a className="btn btn-wa" href={waLink} target="_blank" rel="noopener">Написать в WhatsApp</a>
        <a className="btn btn-ghost" href={visitHref} onClick={onClose}>Оставить заявку</a>
      </div>
    </Dialog>
  );
}
