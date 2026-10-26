import { formatPrice, productImages, productUrl } from "../lib/catalog.js";
import { useShop } from "../shop/ShopContext.jsx";

export function ProductBadge({ product }) {
  if (!product.inStock) return <span className="product-badge">Под заказ</span>;
  if (product.oldPrice) return <span className="product-badge product-badge-sale">Скидка</span>;
  return null;
}

export default function ProductCard({ product }) {
  const { openOrder } = useShop();
  const images = productImages(product);
  const url = productUrl(product);

  return (
    <article className="product" id={`product-${product.id}`}>
      <a className={images.length ? "product-media" : "product-media product-media-empty"} href={url} aria-label={product.name}>
        {images.length ? (
          <>
            <img src={images[0]} alt={product.name} loading="lazy" />
            {images.length > 1 && <span className="product-photos">{images.length} фото</span>}
          </>
        ) : (
          <span>{product.category || "Товар"}</span>
        )}
        <ProductBadge product={product} />
      </a>
      <div className="product-body">
        {product.category && <p className="item-tag">{product.category}</p>}
        <h3>
          <a className="product-link" href={url}>{product.name}</a>
        </h3>
        {product.description && <p className="product-desc">{product.description}</p>}
        {product.sizes?.length > 0 && <p className="product-sizes">{product.sizes.join(" · ")}</p>}
        <div className="product-foot">
          <p className="product-price">
            <strong>{formatPrice(product.price, product)}</strong>
            {product.oldPrice ? <s>{formatPrice(product.oldPrice, product)}</s> : null}
          </p>
          <button className="btn btn-solid" type="button" onClick={() => openOrder(product)}>В заказ</button>
        </div>
      </div>
    </article>
  );
}
