import { formatPrice } from "./utils.js";

function stockLabel(product) {
  if (!product.stock) return product.inStock ? "в наличии" : "под заказ";
  const sizes = Object.entries(product.stock);
  const total = sizes.reduce((sum, [, qty]) => sum + qty, 0);
  if (!total) return "под заказ · 0 шт.";
  const detail = sizes.length > 1 ? ` (${sizes.map(([size, qty]) => `${size}: ${qty}`).join(", ")})` : "";
  return `в наличии · ${total} шт.${detail}`;
}

export default function ProductsPanel({ hidden, products, editingId, onAdd, onEdit, onRemove, pdfJob, onCatalogPdf }) {
  return (
    <section className="panel" hidden={hidden}>
      <div className="panel-head">
        <h1>Товары <span className="count">· {products.length}</span></h1>
        <div className="panel-head-actions">
          {products.length > 0 && (
            <button className="btn btn-ghost" type="button" disabled={Boolean(pdfJob)} onClick={onCatalogPdf}>
              {pdfJob?.key === "catalog" ? pdfJob.label : "Каталог PDF"}
            </button>
          )}
          <button className="btn btn-solid" type="button" onClick={onAdd}>+ Добавить товар</button>
        </div>
      </div>
      <ul className="list">
        {products.length ? (
          products.map((product) => (
            <li key={product.id} className={product.id === editingId ? "editing" : undefined}>
              <div className="thumb">{product.image && <img src={product.image} alt="" />}</div>
              <div>
                <p className="list-name">{product.name}</p>
                <p className="list-meta">
                  {[product.category, formatPrice(product.price, product.currency), stockLabel(product)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="list-actions">
                <button type="button" onClick={() => onEdit(product)}>Изменить</button>
                <button className="danger" type="button" onClick={() => onRemove(product)}>Удалить</button>
              </div>
            </li>
          ))
        ) : (
          <li className="empty">Пока пусто. Нажмите «Добавить товар».</li>
        )}
      </ul>
    </section>
  );
}
