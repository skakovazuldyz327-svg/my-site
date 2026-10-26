import { useEffect, useRef, useState } from "react";
import { productById } from "../lib/catalog.js";
import ProductCard from "./ProductCard.jsx";

function hashProductId() {
  const match = location.hash.match(/^#product-(.+)$/);
  if (!match) return "";
  const id = decodeURIComponent(match[1]);
  return productById(id) ? id : "";
}

export default function ProductGrid({ items, onShowAll }) {
  const latest = useRef({ items, onShowAll });
  latest.current = { items, onShowAll };
  const [target, setTarget] = useState({ id: "", tick: 0 });

  useEffect(() => {
    const focus = () => {
      const id = hashProductId();
      if (!id) return;
      if (!latest.current.items.some((product) => product.id === id)) latest.current.onShowAll?.();
      setTarget((current) => ({ id, tick: current.tick + 1 }));
    };
    focus();
    window.addEventListener("hashchange", focus);
    return () => window.removeEventListener("hashchange", focus);
  }, []);

  useEffect(() => {
    if (!target.id) return;
    const card = document.getElementById(`product-${target.id}`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("is-target");
    void card.offsetWidth;
    card.classList.add("is-target");
  }, [target]);

  return (
    <div className="shop-grid" id="shop-grid">
      {items.map((product) => <ProductCard key={product.id} product={product} />)}
    </div>
  );
}
