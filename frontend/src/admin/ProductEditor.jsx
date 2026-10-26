import { useEffect, useRef, useState } from "react";
import Dialog from "../components/Dialog.jsx";
import { CURRENCY_SYMBOL, MAX_PHOTOS, normalizeSize, productImages, resizeImage, splitSizes } from "./utils.js";

function initialFields(product) {
  return {
    name: product ? product.name : "",
    category: product ? product.category || "" : "",
    price: product ? String(product.price) : "",
    oldPrice: product && product.oldPrice ? String(product.oldPrice) : "",
    currency: product && CURRENCY_SYMBOL[product.currency] ? product.currency : "KZT",
    sizes: product ? (product.sizes || []).join(", ") : "",
    description: product ? product.description || "" : "",
    specs: product && Array.isArray(product.specs) ? product.specs.join("\n") : "",
    inStock: product ? product.inStock !== false : true,
    trackStock: Boolean(product?.stock),
    stock: Object.fromEntries(Object.entries(product?.stock || {}).map(([size, qty]) => [size, String(qty)])),
  };
}

const sizeList = (text) => [...new Set(splitSizes(text).map(normalizeSize).filter(Boolean))];

export default function ProductEditor({ product, categories, api, toast, onSave, onClose }) {
  const [fields, setFields] = useState(() => initialFields(product));
  const [images, setImages] = useState(() => productImages(product));
  const [pending, setPending] = useState(0);
  const formRef = useRef(null);
  const alive = useRef(true);
  const saving = useRef(false);

  useEffect(() => {
    alive.current = true;
    formRef.current.elements.name.focus();
    return () => {
      alive.current = false;
    };
  }, []);

  const set = (name) => (event) => {
    const { value, checked, type } = event.target;
    setFields((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  };
  const setStock = (size) => (event) => {
    const { value } = event.target;
    setFields((current) => ({ ...current, stock: { ...current.stock, [size]: value } }));
  };
  const sizes = sizeList(fields.sizes);
  const stockKeys = sizes.length ? sizes : [""];
  const stockTotal = stockKeys.reduce((sum, size) => sum + (Number.parseInt(fields.stock[size], 10) || 0), 0);

  const upload = async (event) => {
    const room = MAX_PHOTOS - images.length - pending;
    const picked = [...event.target.files];
    const files = picked.slice(0, Math.max(0, room));
    event.target.value = "";
    if (picked.length > files.length) toast(`Можно не больше ${MAX_PHOTOS} фото — лишние не добавлены`, true);
    if (!files.length) return;
    let failed = 0;
    let left = files.length;
    setPending((count) => count + left);
    try {
      for (const file of files) {
        try {
          const blob = await resizeImage(file);
          const { url } = await api("/api/upload", { method: "POST", body: blob });
          if (!alive.current) return;
          setImages((current) => [...current, url]);
        } catch (error) {
          if (error.message === "auth") return;
          failed += 1;
        }
        left -= 1;
        setPending((count) => count - 1);
      }
    } finally {
      if (left) setPending((count) => count - left);
    }
    if (failed) toast(`Не получилось загрузить фото: ${failed} шт.`, true);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (pending) {
      toast("Подождите, фото ещё загружается", true);
      return;
    }
    const f = formRef.current.elements;
    const next = {
      id: product ? product.id : `p${Date.now().toString(36)}`,
      name: fields.name.trim(),
      category: fields.category.trim(),
      price: Number(fields.price),
      oldPrice: fields.oldPrice ? Number(fields.oldPrice) : null,
      currency: CURRENCY_SYMBOL[fields.currency] ? fields.currency : "KZT",
      description: fields.description.trim(),
      sizes,
      specs: fields.specs.split("\n").map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean),
      image: images[0] || "",
      images: [...images],
      inStock: fields.trackStock ? stockTotal > 0 : fields.inStock,
      stock: null,
    };

    if (fields.trackStock) {
      const counts = stockKeys.map((size) => [size, String(fields.stock[size] ?? "").trim()]);
      const bad = counts.find(([, text]) => text !== "" && !/^\d{1,6}$/.test(text));
      if (bad) {
        toast(`Остаток${bad[0] ? ` для ${bad[0]}` : ""} — целое число штук, 0 или больше`, true);
        return;
      }
      next.stock = Object.fromEntries(counts.map(([size, text]) => [size, Number(text || 0)]));
    }

    if (!next.name) {
      toast("Напишите название товара", true);
      f.name.focus();
      return;
    }
    if (!(next.price > 0)) {
      toast("Укажите цену больше нуля", true);
      f.price.focus();
      return;
    }
    if (next.oldPrice != null && next.oldPrice <= next.price) {
      toast("Старая цена должна быть больше текущей — или оставьте поле пустым", true);
      f.oldPrice.focus();
      return;
    }
    // A second click while the first save is on its way would be refused as a change "from another window".
    if (saving.current) return;
    saving.current = true;
    try {
      if (await onSave(next, product)) onClose();
    } finally {
      saving.current = false;
    }
  };

  const photos = images.map((url, index) => (
    <li key={`${index}:${url}`} className={index === 0 ? "photo-item photo-main" : "photo-item"}>
      <img src={url} alt="" />
      {index === 0 ? (
        <span className="photo-label">Главное</span>
      ) : (
        <button
          className="photo-btn"
          type="button"
          onClick={() => setImages([url, ...images.filter((_, i) => i !== index)])}
        >
          Сделать главным
        </button>
      )}
      <button
        className="photo-remove"
        type="button"
        aria-label="Убрать фото"
        onClick={() => setImages(images.filter((_, i) => i !== index))}
      >
        ×
      </button>
    </li>
  ));

  return (
    <Dialog id="editor" open onClose={onClose} className="editor-dialog" labelledBy="editor-title">
      <section className="panel">
        <button className="editor-close" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
        <h2 id="editor-title">{product ? "Изменить товар" : "Новый товар"}</h2>
        <form ref={formRef} onSubmit={submit}>
          <label>
            Название *
            <input name="name" required placeholder="Матрас «Баланс»" value={fields.name} onChange={set("name")} />
          </label>
          <label>
            Категория
            <input name="category" list="categories" placeholder="Матрасы" value={fields.category} onChange={set("category")} />
            <datalist id="categories">
              {categories.map((category) => <option key={category} value={category} />)}
            </datalist>
          </label>
          <div className="row">
            <label>
              Цена *
              <input name="price" type="number" min="0" step="any" required value={fields.price} onChange={set("price")} />
            </label>
            <label>
              Старая цена
              <input name="oldPrice" type="number" min="0" step="any" placeholder="если скидка" value={fields.oldPrice} onChange={set("oldPrice")} />
            </label>
          </div>
          <label>
            Валюта
            <select name="currency" value={fields.currency} onChange={set("currency")}>
              <option value="KZT">Тенге</option>
              <option value="USD">Доллар</option>
              <option value="RUB">Рубль</option>
            </select>
          </label>
          <label>
            Размеры (через запятую)
            <input name="sizes" placeholder="90×200, 160×200" value={fields.sizes} onChange={set("sizes")} />
          </label>
          <label>
            Описание
            <textarea name="description" rows={3} value={fields.description} onChange={set("description")}></textarea>
          </label>
          <label>
            Характеристики (каждая с новой строки)
            <textarea
              name="specs"
              rows={4}
              placeholder={"Жёсткость: средняя\nВысота: 22 см\nНаполнитель: латекс, кокос\nГарантия: 5 лет"}
              value={fields.specs}
              onChange={set("specs")}
            ></textarea>
          </label>
          <div className="photo">
            <span>Фото <small className="photo-hint">первое — главное, до 8 штук</small></span>
            <ul className="photo-gallery">
              {photos}
              {Array.from({ length: pending }, (_, i) => <li key={`loading-${i}`} className="photo-item photo-loading">Загружаю…</li>)}
              {!images.length && !pending && <li className="photo-empty">Нет фото</li>}
            </ul>
            <div className="photo-actions">
              <label className="btn btn-ghost file-btn" hidden={images.length + pending >= MAX_PHOTOS}>
                Добавить фото
                <input type="file" accept="image/*" multiple onChange={upload} />
              </label>
            </div>
          </div>
          <fieldset className="stock">
            <legend>Наличие</legend>
            <label className="check">
              <input name="trackStock" type="checkbox" checked={fields.trackStock} onChange={set("trackStock")} />
              Считать остатки в штуках
            </label>
            {fields.trackStock ? (
              <>
                <div className="stock-list">
                  {stockKeys.map((size) => (
                    <label key={size || "all"}>
                      {size || "Количество"}
                      <input
                        name={`stock-${size || "all"}`}
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        placeholder="0"
                        value={fields.stock[size] ?? ""}
                        onChange={setStock(size)}
                      />
                    </label>
                  ))}
                </div>
                <p className="stock-hint">
                  Штуки списываются, когда вы переводите заказ в «В работе» или «Выполнен»; отмена или возврат в «Новый» возвращает их. Новый заказ остатки не трогает. Размер с остатком 0 показывается на сайте «Под заказ» — заказы на него всё равно принимаются.
                </p>
              </>
            ) : (
              <label className="check">
                <input name="inStock" type="checkbox" checked={fields.inStock} onChange={set("inStock")} />
                В наличии (если снять — «Под заказ»)
              </label>
            )}
          </fieldset>
          <div className="form-actions">
            <button className="btn btn-solid" type="submit">Сохранить</button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Отмена</button>
          </div>
        </form>
      </section>
    </Dialog>
  );
}
