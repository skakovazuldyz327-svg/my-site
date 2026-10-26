import { useState } from "react";
import { waLink } from "../lib/catalog.js";
import { useShop } from "../shop/ShopContext.jsx";

export default function Header({ page, onContacts }) {
  const { bag, openBag } = useShop();
  const [menuOpen, setMenuOpen] = useState(false);
  const home = page === "home";
  const base = home ? "" : "index.html";
  const count = bag.reduce((sum, item) => sum + item.qty, 0);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <a className="mark" href={home ? "#top" : "index.html"}>
        <span className="mark-star" aria-hidden="true">✦</span>
        Жулдыз
      </a>
      <nav className={menuOpen ? "nav open" : "nav"} id="nav" onClick={(event) => event.target.closest("a") && closeMenu()}>
        <a href={`${base}#about`}>Обо мне</a>
        <a href={`${base}#catalog`}>Каталог</a>
        <a
          href="products.html"
          className={home ? undefined : "active"}
          aria-current={page === "products" ? "page" : undefined}
        >
          Товары
        </a>
        <a href={`${base}#why`}>Почему я</a>
        <a href={`${base}#visit`}>Консультация</a>
        <a
          href={`${base}#visit`}
          aria-haspopup="dialog"
          aria-controls="contacts"
          onClick={(event) => {
            event.preventDefault();
            onContacts();
          }}
        >
          Контакты
        </a>
      </nav>
      <div className="header-end">
        <button className="bag" type="button" aria-haspopup="dialog" aria-controls="bag" onClick={openBag}>
          Заказ
          {count > 0 && <span className="bag-count">{count}</span>}
        </button>
        {home ? (
          <a className="header-cta" href="#visit">Записаться</a>
        ) : (
          <a className="header-cta" href={waLink} target="_blank" rel="noopener">Написать</a>
        )}
        <button
          className="menu-btn"
          type="button"
          aria-label="Меню"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span></span><span></span>
        </button>
      </div>
    </header>
  );
}
