import { waLink } from "../lib/catalog.js";

export default function ShopHelp({ title, children }) {
  return (
    <section className="shop-help">
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      <a className="btn btn-wa" href={waLink} target="_blank" rel="noopener">Написать в WhatsApp</a>
    </section>
  );
}
