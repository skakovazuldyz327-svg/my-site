import { useCallback, useState } from "react";
import ProductGrid from "../components/ProductGrid.jsx";
import ShopHelp from "../components/ShopHelp.jsx";
import { catalogLoaded, products, whatsapp } from "../lib/catalog.js";
import { downloadCatalogPdf } from "../pdf/index.js";

const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
const filters = [["Все", ""], ...categories.map((category) => [category, category])];

function CatalogPdfButton({ category }) {
  const [state, setState] = useState({ busy: false, label: "", failed: false, partial: false });
  const download = async () => {
    setState({ busy: true, label: "Готовлю PDF…", failed: false, partial: false });
    try {
      const result = await downloadCatalogPdf(products, {
        whatsapp,
        category,
        onProgress: (done, total) => setState({ busy: true, label: `Фото ${done} из ${total}…`, failed: false, partial: false })
      });
      setState({ busy: false, label: "", failed: false, partial: Boolean(result?.missing?.length) });
    } catch (error) {
      console.error("catalog PDF failed", error);
      setState({ busy: false, label: "", failed: true, partial: false });
    }
  };

  return (
    <div className="shop-pdf">
      <button className="chip" type="button" disabled={state.busy} onClick={download}>
        {state.busy ? state.label : category ? `Скачать PDF: ${category}` : "Скачать каталог PDF"}
      </button>
      {state.failed && <span className="shop-pdf-error">Не получилось, попробуйте ещё раз</span>}
      {state.partial && <span className="shop-pdf-error">PDF скачан, но часть фото не загрузилась — попробуйте скачать ещё раз</span>}
    </div>
  );
}

export default function Products() {
  const [category, setCategory] = useState("");
  const showAll = useCallback(() => setCategory(""), []);
  const items = category ? products.filter((product) => product.category === category) : products;

  return (
    <main>
      <section className="shop shop-page">
        <a className="back-link" href="index.html">← На главную</a>
        <header className="shop-head">
          <div>
            <p className="num">Все товары · {products.length}</p>
            <h1>Матрасы, кровати<br />и всё для сна</h1>
            <p>Добавьте в заказ и отправьте всё одним сообщением в WhatsApp.</p>
          </div>
          <div className="shop-filters" id="shop-filters" role="group" aria-label="Категории">
            {categories.length >= 2 &&
              filters.map(([label, value]) => (
                <button
                  key={label}
                  className={value === category ? "chip active" : "chip"}
                  type="button"
                  onClick={() => setCategory(value)}
                >
                  {label}
                </button>
              ))}
          </div>
          {products.length > 0 && <CatalogPdfButton category={category} />}
        </header>
        <ProductGrid items={items} onShowAll={showAll} />
        {!items.length && (
          <p className="shop-empty">
            {catalogLoaded ? "В этой категории пока пусто. Напишите мне — подберу под заказ." : "Не удалось загрузить товары. Обновите страницу или напишите мне — подберу под заказ."}
          </p>
        )}
      </section>

      <ShopHelp title="Не нашли нужный размер?">
        Многие модели делаю под заказ. Напишите, какой нужен размер и жёсткость — отвечу сама.
      </ShopHelp>
    </main>
  );
}
