import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "../components/Dialog.jsx";
import ErrorBoundary from "../components/ErrorBoundary.jsx";
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
  expired: "Сайт больше не принимает сохранённый пароль — возможно, его сменили в .env. Войдите заново.",
  server: "Сайт ответил ошибкой — пароль тут ни при чём. Попробуйте ещё раз через минуту; если не поможет, перезапустите сайт.",
  timeout: "Сайт долго не отвечает. Проверьте, что он запущен, и попробуйте ещё раз.",
  offline: "Сайт не отвечает. Он запущен?",
};

const LOAD_ERRORS = {
  server: "Сайт ответил ошибкой и не отдал данные. Попробуйте ещё раз через минуту; если не поможет, перезапустите сайт.",
  timeout: "Сайт долго не отвечает. Проверьте, что он запущен, и попробуйте ещё раз.",
  offline: "Нет связи с сайтом. Проверьте, что он запущен и компьютер в сети.",
};

// Only the login and the loads that fill the page wait this long; uploads and saves may legitimately take longer.
const REQUEST_TIMEOUT_MS = 15 * 1000;

// kind: "auth" (the password is wrong or was changed), "server" (the site answered with an error), "timeout" or "offline".
function requestError(kind, status = 0) {
  const error = new Error(kind === "server" ? `HTTP ${status}` : kind);
  error.kind = kind;
  error.status = status;
  return error;
}

const failureKind = (error) => (error?.name === "TimeoutError" ? "timeout" : "offline");

async function checkPassword(password) {
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "X-Admin-Password": password },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return "ok";
    if (response.status === 401) return "wrong";
    if (response.status === 403) return "local";
    if (response.status === 429) return "locked";
    return "server";
  } catch (error) {
    return failureKind(error);
  }
}

function LoginForm({ initialError = "", onLogin }) {
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(initialError);
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel login">
      <h1>Вход</h1>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setFailed("");
          try {
            const result = await onLogin(password);
            setFailed(result === "ok" ? "" : result);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Пароль
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="btn btn-solid" type="submit" disabled={busy}>{busy ? "Проверяем…" : "Войти"}</button>
        {failed && <p className="error" role="alert">{LOGIN_ERRORS[failed] || LOAD_ERRORS[failed]}</p>}
      </form>
    </section>
  );
}

// Shown while the saved password is checked and the page data loads, and in place of the page when that failed.
function LoadState({ error, onRetry }) {
  return (
    <section className="panel login load-state" aria-live="polite">
      {error ? (
        <>
          <h1>Админка не загрузилась</h1>
          <p className="error" role="alert">{LOAD_ERRORS[error] || LOGIN_ERRORS[error]}</p>
          <button className="btn btn-solid" type="button" onClick={onRetry}>Повторить</button>
        </>
      ) : (
        <p className="load-wait"><span className="spinner" aria-hidden="true"></span>Загружаем админку…</p>
      )}
    </section>
  );
}

const CRASH_NOTE = "Обновите страницу; если повторится, скачайте полную копию внизу страницы и пришлите её вместе с файлом server-log.txt из папки сайта.";

// Takes the place of one section that failed to draw (e.g. an unexpected old record); the other sections keep working.
// hidden is passed on, so a crashed section on another tab does not show over the open one.
function PanelCrashed({ title, hidden = false }) {
  return (
    <section className="panel" hidden={hidden}>
      <h1>{title}</h1>
      <p className="error" role="alert">Этот раздел не открылся, остальные работают. {CRASH_NOTE}</p>
      <button className="btn btn-ghost" type="button" onClick={() => location.reload()}>Обновить страницу</button>
    </section>
  );
}

function EditorCrashed({ onClose }) {
  return (
    <Dialog id="editor-crashed" open onClose={onClose} className="editor-dialog" labelledBy="editor-crashed-title">
      <h2 id="editor-crashed-title">Редактор товара не открылся</h2>
      <p className="error" role="alert">Изменения не сохранены. {CRASH_NOTE}</p>
      <button className="btn btn-ghost" type="button" onClick={onClose}>Закрыть</button>
    </Dialog>
  );
}

const DAMAGED_SETTINGS = { whatsapp: "номер WhatsApp", email: "почта", company: "реквизиты для счёта" };

// Damaged rows are left out by the server: without this the owner would not know a product or a setting is missing.
function DamagedAlert({ rows }) {
  const names = rows.map((row) => (row.kind === "product" ? `товар с кодом ${row.id}` : `настройка «${DAMAGED_SETTINGS[row.id] || row.id}»`));
  return (
    <div className="sync-alert" role="alert">
      <p>
        В базе повреждены записи, поэтому их нет ни на сайте, ни здесь: {names.join(", ")}. Восстановите базу из ежедневной копии:
        закройте сайт и запустите restore-backup.bat. Текущая база при этом не удаляется, а сохраняется отдельным файлом — заказы, принятые после копии, останутся в нём.
      </p>
    </div>
  );
}

export default function Admin() {
  const password = useRef(storageGet("adminPassword", "sessionStorage") || "");
  // "loading": the saved password is checked and the data loads (or failed to: loadError); "login"; "panel".
  const [view, setView] = useState(() => (password.current ? "loading" : "login"));
  const [loadError, setLoadError] = useState("");
  const [loginNote, setLoginNote] = useState("");
  // A refresh of the orders or of the catalog failed: what is on screen may be behind the site. Kept apart, so one part
  // loading fine does not hide that the other did not.
  const [lost, setLost] = useState({ orders: false, catalog: false });
  const syncLost = lost.orders || lost.catalog;
  const markLost = useCallback((part, value) => setLost((current) => (current[part] === value ? current : { ...current, [part]: value })), []);
  const [email, setEmail] = useState("");
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

  // The site stopped taking the password (changed in .env and restarted): the login form says so instead of appearing silently.
  const expired = useCallback(() => {
    setLoginNote("expired");
    logout();
  }, [logout]);

  // options.timeout (ms) gives up on a request that hangs; the error says why the request failed (see requestError).
  const api = useCallback(async (path, { timeout, ...options } = {}) => {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        ...(timeout ? { signal: AbortSignal.timeout(timeout) } : {}),
        headers: { "X-Admin-Password": password.current, ...(options.headers || {}) },
      });
    } catch (error) {
      throw requestError(failureKind(error));
    }
    if (response.status === 401) {
      expired();
      throw requestError("auth", 401);
    }
    if (!response.ok) throw requestError("server", response.status);
    return response.json();
  }, [expired]);

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
      const [nextOrders, nextClients] = await Promise.all([
        api("/api/orders", { timeout: REQUEST_TIMEOUT_MS }),
        api("/api/clients", { timeout: REQUEST_TIMEOUT_MS }),
      ]);
      markLost("orders", false);
      if (edits.current.running || edits.current.count !== before || edits.current.loads !== load) return;
      setOrders(Array.isArray(nextOrders) ? nextOrders : []);
      setClients(Array.isArray(nextClients) ? nextClients : []);
    } catch (error) {
      if (error.kind === "auth") return;
      markLost("orders", true);
      if (!quiet) toast(`Не удалось загрузить заказы. ${LOAD_ERRORS[error.kind] || ""}`, true);
    }
  }, [api, toast, markLost]);

  // Stock moves with every order, so the product list is reloaded too, but never under an open editor: its "base" must stay
  // the product as the editor first showed it. A load that started before a save answers with the older catalog and is dropped.
  const editingRef = useRef(null);
  const catalogVersion = useRef(0);
  // Resolves to the catalog, null when the load was dropped as above, false when it failed.
  const loadCatalog = useCallback(async () => {
    const version = catalogVersion.current;
    try {
      const catalog = await api("/api/admin/products", { timeout: REQUEST_TIMEOUT_MS });
      markLost("catalog", false);
      if (editingRef.current || catalogVersion.current !== version) return null;
      const next = { ...catalog, settings: catalog.settings || {}, products: catalog.products || [] };
      setData(next);
      return next;
    } catch (error) {
      if (error.kind !== "auth") markLost("catalog", true);
      return false;
    }
  }, [api, markLost]);

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

  // A failed first load leaves the loading screen with the reason and «Повторить» instead of an empty page.
  const openPanel = useCallback(async () => {
    setLoadError("");
    setView("loading");
    let catalog;
    try {
      catalog = await api("/api/admin/products", { timeout: REQUEST_TIMEOUT_MS });
    } catch (error) {
      if (error.kind !== "auth") setLoadError(error.kind);
      return false;
    }
    catalog.settings = catalog.settings || {};
    catalog.products = catalog.products || [];
    setData(catalog);
    setWhatsapp(catalog.settings.whatsapp || "");
    setEmail(catalog.settings.email || "");
    setLost({ orders: false, catalog: false });
    setView("panel");
    await Promise.all([loadOrders(), loadChatFiles()]);
    return true;
  }, [api, loadOrders, loadChatFiles]);

  // A saved password the site no longer takes leads to the login form with the reason; a site that cannot answer does not.
  const start = useCallback(async () => {
    setLoadError("");
    setView("loading");
    const result = await checkPassword(password.current);
    if (result === "ok") await openPanel();
    else if (LOAD_ERRORS[result]) setLoadError(result);
    else if (result === "wrong") expired();
    else {
      setLoginNote(result);
      setView("login");
    }
  }, [openPanel, expired]);

  useEffect(() => {
    if (password.current) start();
  }, [start]);

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
    setLoginNote("");
    await openPanel();
    return "ok";
  };

  const refreshNow = () => {
    loadOrders();
    loadCatalog();
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
        expired();
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
        expired();
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
    if (catalog === false) toast("Нет связи с сайтом — в редакторе остатки на момент последней загрузки", true);
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

  const saveContacts = async (event) => {
    event.preventDefault();
    const phone = normalizePhone(whatsapp);
    if (phone.length < 10) {
      toast("Проверьте номер", true);
      return;
    }
    const address = email.trim();
    if (address && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address)) {
      toast("Проверьте почту — например, name@mail.kz. Если почты нет, оставьте поле пустым.", true);
      return;
    }
    setWhatsapp(phone);
    setEmail(address);
    await changeCatalog("/api/settings", { whatsapp: phone, email: address }, "Контакты сохранены");
  };

  const downloadBackup = async () => {
    setBackingUp(true);
    try {
      const response = await fetch("/api/backup", { headers: { "X-Admin-Password": password.current } });
      if (response.status === 401) {
        expired();
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

  // One PDF at a time; the button that started it shows the progress. A PDF that came out without some photos
  // (result.missing) is said so, or it would be sent to buyers with empty frames.
  const makePdf = async (key, task, message = "PDF скачан") => {
    if (pdfJob) return;
    setPdfJob({ key, label: "Готовлю PDF…" });
    try {
      const result = await task((done, total) => setPdfJob({ key, label: `Фото ${done} из ${total}…` }));
      const missing = Array.isArray(result?.missing) ? result.missing : [];
      if (missing.length) {
        const names = missing.slice(0, 3).join(", ") + (missing.length > 3 ? ` и ещё ${missing.length - 3}` : "");
        toast(`PDF скачан, но без фото: ${names}. Проверьте фото у этих товаров и скачайте PDF ещё раз.`, true);
      } else {
        toast(message);
      }
    } catch (error) {
      console.error("PDF failed", error);
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
        {view === "loading" && <LoadState error={loadError} onRetry={start} />}
        {view === "login" && <LoginForm key={loginNote} initialError={loginNote} onLogin={login} />}

        {view === "panel" && syncLost && (
          <div className="sync-alert" role="alert">
            <p>Связь с сервером потеряна. Данные могут быть устаревшими.</p>
            <button className="btn btn-ghost" type="button" onClick={refreshNow}>Повторить</button>
          </div>
        )}

        {view === "panel" && data?.damaged?.length > 0 && <DamagedAlert rows={data.damaged} />}

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

            <ErrorBoundary resetKey={orders} fallback={<PanelCrashed title="Заказы" hidden={tab !== "orders"} />}>
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
            </ErrorBoundary>
            <ErrorBoundary resetKey={clients} fallback={<PanelCrashed title="Клиенты" hidden={tab !== "clients"} />}>
              <ClientsPanel hidden={tab !== "clients"} clients={clients} orders={orders} onHide={setClientHidden} onDelete={deleteClient} />
            </ErrorBoundary>
            <ErrorBoundary resetKey={products} fallback={<PanelCrashed title="Товары" hidden={tab !== "products"} />}>
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
            </ErrorBoundary>
            <ErrorBoundary resetKey={chatFiles.files} fallback={<PanelCrashed title="Файлы из чата" hidden={tab !== "files"} />}>
              <FilesPanel
                hidden={tab !== "files"}
                files={chatFiles.files}
                usage={chatFiles.usage}
                onRefresh={loadChatFiles}
                onDownload={downloadChatFile}
                onDelete={deleteChatFile}
              />
            </ErrorBoundary>

            <section className="panel settings-panel">
              <h2>Контакты на сайте</h2>
              <form onSubmit={saveContacts} noValidate>
                <label>
                  WhatsApp и телефон для заказов
                  <input name="whatsapp" inputMode="tel" placeholder="87778492164" value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} />
                </label>
                <label>
                  Почта (необязательно — без неё на сайте её не будет)
                  <input name="email" type="email" inputMode="email" autoComplete="email" maxLength={120} placeholder="name@mail.kz" value={email} onChange={(event) => setEmail(event.target.value)} />
                </label>
                <button className="btn btn-ghost" type="submit">Сохранить контакты</button>
              </form>
            </section>

            <ErrorBoundary resetKey={data.settings.company} fallback={<PanelCrashed title="Реквизиты для счёта" />}>
              <CompanyPanel key={JSON.stringify(data.settings.company ?? null)} company={data.settings.company} onSave={saveCompany} />
            </ErrorBoundary>

            <section className="panel settings-panel">
              <h2>Резервная копия</h2>
              <p className="backup-note">Каждый день сайт сам сохраняет копию товаров, заказов и клиентов и хранит её 30 дней. Раз в неделю скачивайте полную копию с фото и сохраняйте на флешку или в облако — на случай, если с компьютером что-то случится. Файлы из чата в копию не входят — нужные скачайте во вкладке «Файлы».</p>
              <button className="btn btn-ghost" type="button" disabled={backingUp} onClick={downloadBackup}>Скачать полную копию</button>
            </section>
          </div>
        )}
      </main>

      {editing && (
        <ErrorBoundary resetKey={editing.key} fallback={<EditorCrashed onClose={() => setEditing(null)} />}>
          <ProductEditor
            key={editing.key}
            product={editing.product}
            categories={categories}
            api={api}
            toast={toast}
            onSave={saveProduct}
            onClose={() => setEditing(null)}
          />
        </ErrorBoundary>
      )}

      {toastNode}
    </>
  );
}
