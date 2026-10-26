import { useState } from "react";
import { invoiceReady } from "../pdf/invoiceDoc.js";
import { contactLinks, formatDate, formatPrice, ORDER_STATUS } from "./utils.js";

// The buyer's organisation, BIN/IIN and delivery address for the invoice; the buyer may have typed them when ordering.
function BuyerForm({ order, onSave }) {
  const [form, setForm] = useState({ company: order.company || "", bin: order.bin || "", address: order.address || "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    const bin = form.bin.replace(/\s/g, "");
    if (bin && !/^\d{12}$/.test(bin)) {
      setError("БИН / ИИН — ровно 12 цифр");
      return;
    }
    setError("");
    setSaving(true);
    await onSave(order, { ...form, bin });
    setSaving(false);
  };

  return (
    <details className="order-buyer" open={Boolean(order.company || order.bin || order.address) || undefined}>
      <summary>Данные покупателя для счёта</summary>
      <form onSubmit={submit} noValidate>
        <label>
          Организация (если счёт на ТОО или ИП)
          <input value={form.company} maxLength={160} onChange={set("company")} />
        </label>
        <label>
          БИН / ИИН покупателя
          <input value={form.bin} inputMode="numeric" maxLength={14} onChange={set("bin")} />
        </label>
        <label>
          Адрес доставки
          <input value={form.address} maxLength={200} onChange={set("address")} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="order-btn" type="submit" disabled={saving}>Сохранить данные</button>
      </form>
    </details>
  );
}

function OrderCard({ order, onStatus, onDelete, pdfJob, onPdf, onInvoice, onBuyer }) {
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    await onDelete(order);
    setDeleting(false);
  };
  const goods = (order.items || [])
    .map((line) => `${line.name}${line.size ? ` ${line.size}` : ""}${line.qty > 1 ? `, ${line.qty} шт.` : ""}`)
    .join("; ");
  const greeting = order.name ? `Здравствуйте, ${order.name}!` : "Здравствуйте!";
  const links = contactLinks(order.phone, `${greeting} Вы хотели заказать у нас ${goods.replace(/\.$/, "")}. Подскажите, пожалуйста, удобно ли сейчас обсудить заказ?`);
  const total = Object.entries(order.totals || {}).map(([currency, sum]) => formatPrice(sum, currency)).join(" · ");

  return (
    <li className={order.status === "new" ? "card is-new" : "card"}>
      <div className="order-head">
        <div>
          <p className="list-name">Заказ № {order.number}</p>
          <p className="list-meta">{formatDate(order.createdAt)}</p>
        </div>
        <select
          className="order-status"
          aria-label={`Статус заказа № ${order.number}`}
          value={ORDER_STATUS[order.status] ? order.status : "new"}
          onChange={(event) => onStatus(order, event.target.value)}
        >
          {Object.entries(ORDER_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <p className="order-client">
        <strong>{order.name || "Без имени"}</strong>
        {links && <> · <a href={links.call}>{order.phone}</a></>}
      </p>
      {order.damaged && (
        <p className="error">Часть данных этого заказа повреждена: имя и телефон на месте, товары и сумму проверьте по резервной копии.</p>
      )}
      <ul className="order-lines">
        {(order.items || []).map((line, index) => (
          <li key={index}>
            {`${line.name}${line.size ? ` ${line.size}` : ""} × ${line.qty} — ${formatPrice(line.price * line.qty, line.currency)}${line.removed ? " (товар уже убран с сайта)" : ""}`}
            {line.sizeRemoved && <span className="order-short"> — этого размера уже нет на сайте</span>}
            {line.seenPrice > 0 && (
              <span className="order-short">{` — клиент видел цену ${formatPrice(line.seenPrice, line.seenCurrency || line.currency)} за штуку`}</span>
            )}
            {order.status !== "cancel" && typeof line.fromStock === "number" && line.fromStock < line.qty && (
              <span className="order-short">{` — не было в наличии: ${line.qty - line.fromStock} шт., под заказ`}</span>
            )}
          </li>
        ))}
      </ul>
      <p className="order-sum">Сумма: {total}</p>
      {order.status !== "cancel" && <BuyerForm key={`${order.company}|${order.bin}|${order.address}`} order={order} onSave={onBuyer} />}
      <div className="order-actions">
        {links && <a className="order-btn order-btn-wa" href={links.wa} target="_blank" rel="noopener">Написать клиенту</a>}
        {order.status !== "cancel" && invoiceReady(order) && (
          <button className="order-btn" type="button" disabled={Boolean(pdfJob)} onClick={() => onInvoice(order)}>
            {pdfJob?.key === `invoice-${order.id}` ? pdfJob.label : "Счёт на оплату PDF"}
          </button>
        )}
        {order.status !== "cancel" && (
          <button className="order-btn" type="button" disabled={Boolean(pdfJob)} onClick={() => onPdf(order)}>
            {pdfJob?.key === `order-${order.id}` ? pdfJob.label : "Заказ PDF"}
          </button>
        )}
        <button className="order-btn order-btn-danger" type="button" disabled={deleting} onClick={remove}>Удалить</button>
      </div>
    </li>
  );
}

export default function OrdersPanel({ hidden, orders, freshLabel, onRefresh, onStatus, onDelete, pdfJob, onPdf, onInvoice, onBuyer }) {
  const sorted = [...orders].sort((a, b) => b.number - a.number);

  return (
    <section className="panel" hidden={hidden}>
      <div className="panel-head">
        <h1>Заказы <span className="count">{freshLabel ? `· ${freshLabel}` : `· ${orders.length}`}</span></h1>
        <button className="btn btn-ghost" type="button" onClick={onRefresh}>Обновить</button>
      </div>
      <ul className="cards">
        {sorted.length ? (
          sorted.map((order) => <OrderCard key={order.id} order={order} onStatus={onStatus} onDelete={onDelete} pdfJob={pdfJob} onPdf={onPdf} onInvoice={onInvoice} onBuyer={onBuyer} />)
        ) : (
          <li className="empty">Заказов пока нет. Они появятся здесь, когда клиент нажмёт «Отправить заказ в WhatsApp».</li>
        )}
      </ul>
    </section>
  );
}
