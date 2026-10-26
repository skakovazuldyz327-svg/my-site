import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
import { preventNumberWheel } from "../lib/numberWheel.js";

const crashed = (
  <main>
    <section className="shop shop-page">
      <div className="item-missing">
        <h1>Страница не загрузилась</h1>
        <p>Что-то пошло не так. Обновите страницу — обычно этого достаточно.</p>
        <button className="btn btn-solid" type="button" onClick={() => location.reload()}>Обновить страницу</button>
      </div>
    </section>
  </main>
);

export function mount(element) {
  preventNumberWheel();
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <ErrorBoundary fallback={crashed}>{element}</ErrorBoundary>
    </StrictMode>
  );
}
