import { useState } from "react";
import { contacts, waLink } from "../lib/catalog.js";
import { ShopProvider } from "../shop/ShopContext.jsx";
import Chat from "../chat/Chat.jsx";
import ContactsDialog from "./ContactsDialog.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import Header from "./Header.jsx";

const pageCrashed = (
  <main>
    <section className="shop shop-page">
      <div className="item-missing">
        <h1>Страница не загрузилась</h1>
        <p>Обновите страницу. Если не поможет — напишите Жулдыз, она ответит лично.</p>
        <a className="btn btn-wa" href={waLink} target="_blank" rel="noopener">Написать в WhatsApp</a>
      </div>
    </section>
  </main>
);

export default function Layout({ page, children }) {
  const [contactsOpen, setContactsOpen] = useState(false);

  return (
    <ShopProvider>
      <div className="grain" aria-hidden="true"></div>
      <Header page={page} onContacts={() => setContactsOpen(true)} />
      <ErrorBoundary fallback={pageCrashed}>{children}</ErrorBoundary>
      <footer className="site-footer">
        <p>© {new Date().getFullYear()} Жулдыз · ортопедические матрасы, кровати, аксессуары</p>
        <p className="footer-contacts">
          <a href={contacts.phoneHref}>{contacts.phone}</a>
          <a href={waLink} target="_blank" rel="noopener">WhatsApp</a>
          {contacts.email && <a href={`mailto:${contacts.email}`}>{contacts.email}</a>}
        </p>
        <p>Жұлдыз — звезда. Пусть ночь будет тихой.</p>
      </footer>
      <ContactsDialog
        open={contactsOpen}
        onClose={() => setContactsOpen(false)}
        visitHref={page === "home" ? "#visit" : "index.html#visit"}
      />
      <ErrorBoundary>
        <Chat />
      </ErrorBoundary>
    </ShopProvider>
  );
}
