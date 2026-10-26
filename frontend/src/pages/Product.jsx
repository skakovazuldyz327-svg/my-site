import { useEffect, useRef, useState } from "react";
import { ProductBadge } from "../components/ProductCard.jsx";
import ShopHelp from "../components/ShopHelp.jsx";
import { catalogLoaded, clampQty, formatPrice, productById, productImages, sizeInStock } from "../lib/catalog.js";
import { useShop } from "../shop/ShopContext.jsx";

const product = productById(new URLSearchParams(location.search).get("id") || "");

function SpecRow({ line }) {
  const split = line.indexOf(":");
  if (split <= 0) return <dd className="item-spec-wide">{line}</dd>;
  return (
    <>
      <dt>{line.slice(0, split).trim()}</dt>
      <dd>{line.slice(split + 1).trim()}</dd>
    </>
  );
}

function Gallery() {
  const images = productImages(product);
  const many = images.length > 1;
  const [current, setCurrent] = useState(0);
  const touchX = useRef(null);
  const show = (index) => setCurrent((index + images.length) % images.length);

  return (
    <div className="item-gallery">
      <div
        className={images.length ? "item-photo" : "item-photo product-media-empty"}
        onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }}
        onTouchEnd={(event) => {
          if (touchX.current == null || !many) return;
          const dx = event.changedTouches[0].clientX - touchX.current;
          touchX.current = null;
          if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1));
        }}
      >
        {images.length ? <img src={images[current]} alt={product.name} /> : <span>{product.category || "Товар"}</span>}
        {many && (
          <>
            <button className="item-arrow item-arrow-prev" type="button" aria-label="Предыдущее фото" onClick={() => show(current - 1)}>‹</button>
            <button className="item-arrow item-arrow-next" type="button" aria-label="Следующее фото" onClick={() => show(current + 1)}>›</button>
          </>
        )}
        <ProductBadge product={product} />
      </div>
      {many && (
        <div className="item-thumbs" role="group" aria-label="Фото товара">
          {images.map((src, index) => (
            <button
              key={index}
              className="item-thumb"
              type="button"
              aria-label={`Фото ${index + 1}`}
              aria-pressed={index === current}
              onClick={() => show(index)}
            >
              <img src={src} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductInfo() {
  const { addToBag, openBag, openOrder } = useShop();
  const sizes = product.sizes || [];
  const [size, setSize] = useState(() => (product.stock && sizes.find((value) => sizeInStock(product, value))) || sizes[0] || "");
  const [qty, setQty] = useState("1");
  const specs = (product.specs || []).filter(Boolean);
  const onHand = sizeInStock(product, size);

  return (
    <div className="item-info">
      {product.category && <p className="item-tag">{product.category}</p>}
      <h1>{product.name}</h1>
      <p className={onHand ? "item-stock" : "item-stock is-order"} aria-live="polite">
        {onHand ? "В наличии" : "Под заказ — сроки уточнит Жулдыз"}
        {product.stock && sizes.length > 0 ? ` (${size})` : ""}
      </p>
      <p className="item-price">
        <strong>{formatPrice(product.price, product)}</strong>
        {product.oldPrice ? <s>{formatPrice(product.oldPrice, product)}</s> : null}
      </p>

      <div className="item-choose">
        {sizes.length > 0 && (
          <div className="item-sizes">
            <p className="item-label">Размер</p>
            <div className="item-size-list" role="group" aria-label="Размер">
              {sizes.map((value) => (
                <button
                  key={value}
                  className={["chip", value === size && "active", product.stock && !sizeInStock(product, value) && "is-order"].filter(Boolean).join(" ")}
                  type="button"
                  aria-pressed={value === size}
                  title={product.stock ? (sizeInStock(product, value) ? "В наличии" : "Под заказ") : undefined}
                  onClick={() => setSize(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="item-qty">
          <span className="item-label">Количество</span>
          <input
            type="number"
            min="1"
            max="20"
            inputMode="numeric"
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            onBlur={() => setQty(String(clampQty(qty)))}
          />
        </label>
      </div>
      <p className="item-total">Сумма: <strong>{formatPrice(product.price * clampQty(qty), product)}</strong></p>

      <div className="item-actions">
        <button
          className="btn btn-solid"
          type="button"
          onClick={() => {
            addToBag({ id: product.id, size, qty: clampQty(qty) });
            openBag();
          }}
        >
          Добавить в заказ
        </button>
        <button className="btn btn-wa" type="button" onClick={() => openOrder(product, size, clampQty(qty))}>
          Заказать в WhatsApp
        </button>
      </div>
      <p className="item-note">Перед заказом Жулдыз сама уточнит размер, сроки и доставку.</p>

      {product.description && (
        <div className="item-section">
          <h2>Описание</h2>
          <p>{product.description}</p>
        </div>
      )}
      {specs.length > 0 && (
        <div className="item-section">
          <h2>Характеристики</h2>
          <dl className="item-specs">
            {specs.map((line, index) => <SpecRow key={index} line={line} />)}
          </dl>
        </div>
      )}
    </div>
  );
}

export default function Product() {
  useEffect(() => {
    if (!product) {
      document.title = "Товар не найден — Жулдыз";
      return;
    }
    document.title = `${product.name} — Жулдыз, ортопедические матрасы и кровати`;
    if (product.description) document.querySelector('meta[name="description"]').content = product.description.slice(0, 160);
  }, []);

  return (
    <main>
      <section className="shop shop-page item-page">
        <a className="back-link" href="products.html">← Все товары</a>
        {product ? (
          <article className="item-layout">
            <Gallery />
            <ProductInfo />
          </article>
        ) : catalogLoaded ? (
          <div className="item-missing">
            <h1>Такого товара нет</h1>
            <p>Возможно, его уже убрали из каталога. Посмотрите другие модели или напишите мне — подберу похожую.</p>
            <a className="btn btn-solid" href="products.html">Смотреть все товары</a>
          </div>
        ) : (
          <div className="item-missing">
            <h1>Товар не загрузился</h1>
            <p>Не удалось получить данные о товарах. Обновите страницу через минуту или напишите мне — отвечу лично.</p>
            <button className="btn btn-solid" type="button" onClick={() => location.reload()}>Обновить страницу</button>
          </div>
        )}
      </section>

      <ShopHelp title="Остались вопросы?">
        Напишите, как спите и какой размер кровати — подскажу, подойдёт ли эта модель.
      </ShopHelp>
    </main>
  );
}
