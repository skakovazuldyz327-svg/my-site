import { useCallback, useEffect, useRef, useState } from "react";
import ClientsPanel from "./ClientsPanel.jsx";
import CompanyPanel from "./CompanyPanel.jsx";
import FilesPanel from "./FilesPanel.jsx";
import OrdersPanel from "./OrdersPanel.jsx";
import ProductEditor from "./ProductEditor.jsx";
import ProductsPanel from "./ProductsPanel.jsx";
import { storageGet, storageRemove, storageSet } from "../lib/storage.js";
import { companyDetails } from "../pdf/company.js";
import { downloadCatalogPdf, downloadInvoicePdf, downloadOrderPdf } from "../pdf/index.js";
import { DEFAULT_CATEGORIES, normalizePhone } from "./utils.js";

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const ORDERS_REFRESH_MS = 30 * 1000;

function useToast() {
  const [state, setState] = useState({ text: "", bad: false, visible: false });
  const timer = useRef(0);
  const ref = useRef(null);
  const toast = useCallback((text, bad = false) => {
    setState({ text, bad, visible: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState((current) => ({ ...current, visible: false })), bad ? 6000 : 2600);
  }, []);
  // An open editor is a modal dialog in the top layer and covers everything else; as a popover reopened for every
  // message, the toast joins the top layer above it.
  useEffect(() => {
    const element = ref.current;
    if (!element?.showPopover) return;
    if (element.matches(":popover-open")) element.hidePopover();
    if (state.visible) element.showPopover();
  }, [state]);
  const node = (
    <div ref={ref} popover="manual" className={state.bad ? "toast bad" : "toast"} role="status" hidden={!state.visible}>{state.text}</div>
  );
  return [toast, node];
}

const LOGIN_ERRORS = {
  wrong: "Неверный пароль",
  local: "Пароль админки стандартный, поэтому админка открывается только на компьютере, где запущен сайт. Чтобы входить с других устройств, задайте свой пароль ADMIN_PASSWORD в файле .env и перезапустите сайт.",
  locked: "Слишком много неверных попыток. Попробуйте через 15 минут.",
  offline: "Сайт не отвечает. Он запущен?",
};

async function checkPassword(password) {
  try {
    const response = await fetch("/api/login", { method: "POST", headers: { "X-Admin-Password": password } });
    if (response.ok) return "ok";
    return response.status === 403 ? "local" : response.status === 429 ? "locked" : "wrong";
  } catch {
    return "offline";
  }
}

function LoginForm({ onLogin }) {
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState("");

  return (
    <section className="panel login">
      <h1>Вход</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await onLogin(password);
          setFailed(result === "ok" ? "" : result);
        }}
      >
        <label>
          Пароль
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="btn btn-solid" type="submit">Войти</button>
        {failed && <p className="error">{LOGIN_ERRORS[failed]}</p>}
      </form>
    </section>
  );
}

export default function Admin() {
  const [view, setView] = useState("");
  const password = useRef(storageGet("adminPassword", "sessionStorage") || "");
  const [data, setData] = useState(null);
  const [orders, setOrders] = useState([]);
  const [clients, setClients] = useState([]);
  const [chatFiles, setChatFiles] = useState({ files: [], usage: null });
  const [tab, setTabState] = useState(() => storageGet("adminTab", "sessionStorage") || "orders");
  const [editing, setEditing] = useState(null);
  const [whatsapp, setWhatsapp] = useState("");
  const [backingUp, setBackingUp] = useState(false);
  const [pdfJob, setPdfJob] = useState(null);
  const [toast, toastNode] = useToast();

  const logout = useCallback(() => {
    password.current = "";
    storageRemove("adminPassword", "sessionStorage");
    setView("login");
  }, []);

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(path, {
      ...options,
      headers: { "X-Admin-Password": password.current, ...(options.headers || {}) },
    });
    if (response.status === 401) {
      logout();
      throw new Error("auth");
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, [logout]);

  // A list fetched while a status change or deletion was on its way may predate it and would undo it on screen;
  // so may an older load that answers after a newer one.
  const edits = useRef({ running: 0, count: 0, loads: 0 });
  const trackEdit = useCallback(async (task) => {
    edits.current.running += 1;
    edits.current.count += 1;
    try {
      return await task();
    } finally {
      edits.current.running -= 1;
    }
  }, []);

  const loadOrders = useCallback(async ({ quiet = false } = {}) => {
    if (quiet && edits.current.running) return;
    const before = edits.current.count;
    const load = ++edits.current.loads;
    try {
      const [nextOrders, nextClients] = await Promise.all([api("/api/orders"), api("/api/clients")]);
      if (edits.current.running || edits.current.count !== before || edits.current.loads !== load) return;
      setOrders(Array.isArray(nextOrders) ? nextOrders : []);
      setClients(Array.isArray(nextClients) ? nextClients : []);
    } catch (error) {
      if (!quiet && error.message !== "auth") toast("Не удалось загрузить заказы", true);
    }
  }, [api, toast]);

  // Stock moves with every order, so the product list is reloaded too, but never under an open editor: its "base" must stay
  // the product as the editor first showed it. A load that started before a save answers with the older catalog and is dropped.
  const editingRef = useRef(null);
  const catalogVersion = useRef(0);
  const loadCatalog = useCallback(async () => {
    const version = catalogVersion.current;
    try {
      const catalog = await api("/api/admin/products");
      if (editingRef.current || catalogVersion.current !== version) return null;
      const next = { ...catalog, settings: catalog.settings || {}, products: catalog.products || [] };
      setData(next);
      return next;
    } catch {
      return null;
    }
  }, [api]);

  const loadChatFiles = useCallback(async () => {
    try {
      const result = await api("/api/chat/files");
      setChatFiles({
        files: Array.isArray(result.files) ? result.files : [],
        usage: { usedBytes: Number(result.usedBytes) || 0, totalBytes: Number(result.totalBytes) || 0, days: Number(result.days) || 0 }
      });
    } catch (error) {
      if (error.message !== "auth") toast("Не удалось загрузить файлы из чата", true);
    }
  }, [api, toast]);

  const openPanel = useCallback(async () => {
    let catalog;
    try {
      catalog = await api("/api/admin/products");
    } catch (error) {
      if (error.message !== "auth") toast("Не удалось загрузить товары", true);
      return;
    }
    catalog.settings = catalog.settings || {};
    catalog.products = catalog.products || [];
    setData(catalog);
    setWhatsapp(catalog.settings.whatsapp || "");
    setView("panel");
    await Promise.all([loadOrders(), loadChatFiles()]);
  }, [api, loadOrders, loadChatFiles, toast]);

  useEffect(() => {
    (async () => {
      if (password.current && (await checkPassword(password.current)) === "ok") await openPanel();
      else setView("login");
    })();
  }, [openPanel]);

  // New orders appear without pressing «Обновить»; a hidden tab does not poll and catches up once it is shown again.
  useEffect(() => {
    if (view !== "panel") return undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      loadOrders({ quiet: true });
      loadCatalog();
    };
    const timer = setInterval(refresh, ORDERS_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [view, loadOrders, loadCatalog]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const login = async (value) => {
    const result = await checkPassword(value);
    if (result !== "ok") return result;
    password.current = value;
    storageSet("adminPassword", value, "sessionStorage");
    await openPanel();
    return "ok";
  };

  // The server answers with the whole current catalog, so changes made in another admin window show up here too.
  const changeCatalog = async (path, body, message) => {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { ...JSON_HEADERS, "X-Admin-Password": password.current },
        body: JSON.stringify(body),
      });
      if (response.status === 401) {
        logout();
        return false;
      }
      const result = await response.json().catch(() => null);
      catalogVersion.current += 1;
      if (result?.catalog) setData(result.catalog);
      if (response.ok) {
        toast(message);
        return true;
      }
      toast(
        response.status === 409
          ? "Этот товар только что изменили в другом окне. Нажмите «Сохранить» ещё раз, чтобы записать ваш вариант, или «Отмена»."
          : response.status === 400
            ? "Сайт не принял эти данные — проверьте заполненные поля"
            : "Не удалось сохранить. Сайт запущен?",
        true
      );
      return false;
    } catch {
      toast("Не удалось сохранить. Сайт запущен?", true);
      return false;
    }
  };

  const setTab = (name) => {
    setTabState(name);
    storageSet("adminTab", name, "sessionStorage");
  };

  const setOrderStatus = async (order, status) => {
    const apply = (value) => setOrders((current) => current.map((entry) => (entry.id === order.id ? { ...entry, status: value } : entry)));
    apply(status);
    try {
      await trackEdit(() => api("/api/orders/status", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: order.id, status }) }));
      toast("Статус сохранён");
      loadOrders({ quiet: true });
      loadCatalog();
    } catch (error) {
      apply(order.status);
      if (error.message !== "auth") toast("Не удалось сохранить статус", true);
    }
  };

  const deleteOrder = async (order) => {
    const who = order.name ? ` (${order.name})` : "";
    if (!confirm(`Удалить заказ № ${order.number}${who}? Вернуть его будет нельзя.`)) return false;
    try {
      await trackEdit(() => api("/api/orders/delete", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: order.id }) }));
      setOrders((current) => current.filter((entry) => entry.id !== order.id));
      toast("Заказ удалён");
      loadCatalog();
      return true;
    } catch (error) {
      if (error.message !== "auth") toast("Не удалось удалить заказ", true);
      return false;
    }
  };

  const setClientHidden = async (client, hidden) => {
    try {
      await trackEdit(() => api("/api/clients/hide", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: client.id, hidden }) }));
      setClients((current) => current.map((entry) => (entry.id === client.id ? { ...entry, hidden } : entry)));
      toast(hidden ? "Клиент скрыт" : "Клиент снова в списке");
      return true;
    } catch (error) {
      if (error.message !== "auth") toast("Не удалось сохранить", true);
      return false;
    }
  };

  const deleteClient = async (client) => {
    if (!confirm(`Удалить клиента «${client.name || `+${client.phone}`}» из списка? Его заказы останутся, а новый заказ с этого номера снова добавит клиента.`)) return false;
    try {
      await trackEdit(() => api("/api/clients/delete", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: client.id }) }));
      setClients((current) => current.filter((entry) => entry.id !== client.id));
      toast("Клиент удалён");
      return true;
    } catch (error) {
      if (error.message !== "auth") toast("Не удалось удалить клиента", true);
      return false;
    }
  };

  const downloadChatFile = async (file) => {
    try {
      const response = await fetch(`/api/chat/files/download?id=${encodeURIComponent(file.id)}`, { headers: { "X-Admin-Password": password.current } });
      if (response.status === 401) {
        logout();
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch {
      toast("Не удалось скачать файл", true);
    }
  };

  const deleteChatFile = async (file) => {
    if (!confirm(`Удалить файл «${file.name}»? Вернуть его будет нельзя.`)) return;
    try {
      await api("/api/chat/files/delete", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: file.id }) });
      setChatFiles((current) => ({
        files: current.files.filter((entry) => entry.id !== file.id),
        usage: current.usage && { ...current.usage, usedBytes: Math.max(0, current.usage.usedBytes - (Number(file.size) || 0)) }
      }));
      toast("Файл удалён");
    } catch (error) {
      if (error.message !== "auth") toast("Не удалось удалить файл", true);
    }
  };

  // base is the product as this window last saw it: the server refuses the save if another window changed it since.
  // stockBase is the counts the editor opened with: the server adds the admin's change to what is on hand now.
  const saveProduct = (product, original) => {
    const base = data.products.find((entry) => entry.id === product.id) || null;
    const stockBase = original?.stock ?? null;
    return changeCatalog("/api/products/save", { product, base, stockBase }, original ? "Изменения сохранены" : "Товар добавлен на сайт");
  };

  // The editor opens on fresh counts: orders may have taken pieces since the list was loaded.
  const editProduct = async (product) => {
    const catalog = await loadCatalog();
    const fresh = catalog ? catalog.products.find((entry) => entry.id === product.id) : product;
    if (!fresh) {
      toast("Этот товар только что удалили в другом окне", true);
      return;
    }
    const next = { product: fresh, key: Date.now() };
    editingRef.current = next;
    setEditing(next);
  };

  const removeProduct = async (product) => {
    if (!confirm(`Удалить «${product.name}» с сайта?`)) return;
    if (!(await changeCatalog("/api/products/delete", { id: product.id }, "Товар удалён"))) return;
    if (editing?.product?.id === product.id) setEditing(null);
  };

  const saveWhatsapp = async (event) => {
    event.preventDefault();
    const phone = normalizePhone(whatsapp);
    if (phone.length < 10) {
      toast("Проверьте номер", true);
      return;
    }
    setWhatsapp(phone);
    await changeCatalog("/api/settings", { whatsapp: phone }, "Номер сохранён");
  };

  const downloadBackup = async () => {
    setBackingUp(true);
    try {
      const response = await fetch("/api/backup", { headers: { "X-Admin-Password": password.current } });
      if (response.status === 401) {
        logout();
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      const now = new Date();
      const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
      link.download = `zhuldyz-backup-${day}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("Копия скачана — сохраните её на флешку или в облако");
    } catch {
      toast("Не получилось сделать копию. Сайт запущен?", true);
    } finally {
      setBackingUp(false);
    }
  };

  const saveBuyer = async (order, buyer) => {
    try {
      await trackEdit(() => api("/api/orders/buyer", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ id: order.id, ...buyer }) }));
      const saved = Object.fromEntries(Object.entries(buyer).map(([field, value]) => [field, value.trim().replace(/\s+/g, " ") || undefined]));
      setOrders((current) => current.map((entry) => (entry.id === order.id ? { ...entry, ...saved } : entry)));
      toast("Данные покупателя сохранены");
    } catch (error) {
      if (error.message !== "auth") toast("Не удалось сохранить данные покупателя", true);
    }
  };

  const saveCompany = (company) => changeCatalog("/api/settings/company", { company }, "Реквизиты сохранены");

  // One PDF at a time; the button that started it shows the progress.
  const makePdf = async (key, task, message = "PDF скачан") => {
    if (pdfJob) return;
    setPdfJob({ key, label: "Готовлю PDF…" });
    try {
      await task((done, total) => setPdfJob({ key, label: `Фото ${done} из ${total}…` }));
      toast(message);
    } catch {
      toast("Не удалось сделать PDF. Попробуйте ещё раз.", true);
    } finally {
      setPdfJob(null);
    }
  };

  const orderPdf = (order) =>
    makePdf(`order-${order.id}`, (onProgress) => downloadOrderPdf(order, { whatsapp: data?.settings?.whatsapp, products: data?.products || [], onProgress }));

  const invoicePdf = (order) => {
    const company = data?.settings?.company;
    const sample = companyDetails(company).sample;
    return makePdf(
      `invoice-${order.id}`,
      () => downloadInvoicePdf(order, { company, whatsapp: data?.settings?.whatsapp }),
      sample ? "Скачан образец счёта: заполните реквизиты ниже, в разделе «Реквизиты для счёта»" : "Счёт скачан"
    );
  };

  const catalogPdf = () =>
    makePdf("catalog", (onProgress) => downloadCatalogPdf(data?.products || [], { whatsapp: data?.settings?.whatsapp, onProgress }));

  const fresh = orders.filter((order) => order.status === "new").length;
  const freshLabel = fresh ? `${fresh} ${fresh % 10 === 1 && fresh % 100 !== 11 ? "новый" : "новых"}` : "";
  const visibleClients = clients.filter((client) => !client.hidden).length;
  const products = data?.products || [];
  const categories = [...new Set([...DEFAULT_CATEGORIES, ...products.map((product) => product.category).filter(Boolean)])];
  const tabs = [
    ["orders", "Заказы", freshLabel || (orders.length ? String(orders.length) : "")],
    ["clients", "Клиенты", visibleClients ? String(visibleClients) : ""],
    ["products", "Товары", products.length ? String(products.length) : ""],
    ["files", "Файлы", chatFiles.files.length ? String(chatFiles.files.length) : ""],
  ];

  return (
    <>
      <header className="admin-top">
        <a className="mark" href="index.html" target="_blank">
          <span className="mark-star" aria-hidden="true">✦</span>
          Жулдыз · админка
        </a>
        <div className="admin-top-actions">
          <a className="btn btn-ghost" href="index.html" target="_blank">Открыть сайт</a>
          {view === "panel" && <button className="btn btn-ghost" type="button" onClick={logout}>Выйти</button>}
        </div>
      </header>

      <main className="admin-main">
        {view === "login" && <LoginForm onLogin={login} />}

        {view === "panel" && data && (
          <div className="admin-grid">
            <nav className="admin-tabs" aria-label="Разделы админки">
              {tabs.map(([name, label, count]) => (
                <button
                  key={name}
                  className={tab === name ? "admin-tab active" : "admin-tab"}
                  type="button"
                  aria-pressed={tab === name}
                  onClick={() => setTab(name)}
                >
                  {label} <span>{count}</span>
                </button>
              ))}
            </nav>

            <OrdersPanel
              hidden={tab !== "orders"}
              orders={orders}
              freshLabel={freshLabel}
              onRefresh={loadOrders}
              onStatus={setOrderStatus}
              onDelete={deleteOrder}
              pdfJob={pdfJob}
              onPdf={orderPdf}
              onInvoice={invoicePdf}
              onBuyer={saveBuyer}
            />
            <ClientsPanel hidden={tab !== "clients"} clients={clients} orders={orders} onHide={setClientHidden} onDelete={deleteClient} />
            <ProductsPanel
              hidden={tab !== "products"}
              products={products}
              editingId={editing?.product?.id}
              onAdd={() => setEditing({ product: null, key: Date.now() })}
              onEdit={editProduct}
              onRemove={removeProduct}
              pdfJob={pdfJob}
              onCatalogPdf={catalogPdf}
            />
            <FilesPanel
              hidden={tab !== "files"}
              files={chatFiles.files}
              usage={chatFiles.usage}
              onRefresh={loadChatFiles}
              onDownload={downloadChatFile}
              onDelete={deleteChatFile}
            />

            <section className="panel settings-panel">
              <h2>WhatsApp для заказов</h2>
              <form onSubmit={saveWhatsapp}>
                <label>
                  Номер
                  <input name="whatsapp" inputMode="tel" placeholder="87778492164" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
                </label>
                <button className="btn btn-ghost" type="submit">Сохранить номер</button>
              </form>
            </section>

            <CompanyPanel key={JSON.stringify(data.settings.company ?? null)} company={data.settings.company} onSave={saveCompany} />

            <section className="panel settings-panel">
              <h2>Резервная копия</h2>
              <p className="backup-note">Каждый день сайт сам сохраняет копию товаров, заказов и клиентов и хранит её 30 дней. Раз в неделю скачивайте полную копию с фото и сохраняйте на флешку или в облако — на случай, если с компьютером что-то случится. Файлы из чата в копию не входят — нужные скачайте во вкладке «Файлы».</p>
              <button className="btn btn-ghost" type="button" disabled={backingUp} onClick={downloadBackup}>Скачать полную копию</button>
            </section>
          </div>
        )}
      </main>

      {editing && (
        <ProductEditor
          key={editing.key}
          product={editing.product}
          categories={categories}
          api={api}
          toast={toast}
          onSave={saveProduct}
          onClose={() => setEditing(null)}
        />
      )}

      {toastNode}
    </>
  );
}
