import { useState } from "react";
import { contactLinks, formatDate, formatPrice, phoneDigits, plural } from "./utils.js";

function clientStats(client, orders) {
  const stats = { orders: 0, totals: {} };
  orders.forEach((order) => {
    if (order.status === "cancel" || phoneDigits(order.phone) !== client.phone) return;
    stats.orders += 1;
    Object.entries(order.totals || {}).forEach(([currency, sum]) => {
      stats.totals[currency] = (stats.totals[currency] || 0) + Number(sum);
    });
  });
  return stats;
}

function ClientCard({ client, orders, onHide, onDelete }) {
  const [saving, setSaving] = useState(false);
  const stats = clientStats(client, orders);
  const links = contactLinks(`+${client.phone}`, `${client.name ? `Здравствуйте, ${client.name}!` : "Здравствуйте!"} Это Жулдыз, ортопедические матрасы и кровати.`);
  const total = Object.entries(stats.totals).map(([currency, sum]) => formatPrice(sum, currency)).join(" · ");

  const toggle = async () => {
    setSaving(true);
    await onHide(client, !client.hidden);
    setSaving(false);
  };
  const remove = async () => {
    setSaving(true);
    if (!(await onDelete(client))) setSaving(false);
  };

  return (
    <li className="card">
      <div className="order-head client-head">
        <div>
          <p className="list-name">{client.name || "Без имени"}</p>
          <p className="list-meta">клиент с {formatDate(client.createdAt)}</p>
        </div>
        <span className="card-badge">{stats.orders} {plural(stats.orders, "заказ", "заказа", "заказов")}</span>
      </div>
      <p className="order-client">{links && <a href={links.call}>+{client.phone}</a>}</p>
      <ul className="order-lines">
        <li>Сумма покупок: {total || "—"}</li>
        <li>Последний заказ: {formatDate(client.lastOrderAt)}</li>
      </ul>
      <div className="order-actions">
        {links && <a className="order-btn order-btn-wa" href={links.wa} target="_blank" rel="noopener">Написать клиенту</a>}
        <button className="order-btn order-btn-end" type="button" disabled={saving} onClick={toggle}>
          {client.hidden ? "Вернуть" : "Скрыть"}
        </button>
        <button className="order-btn order-btn-danger" type="button" disabled={saving} onClick={remove}>Удалить</button>
      </div>
    </li>
  );
}

export default function ClientsPanel({ hidden, clients, orders, onHide, onDelete }) {
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);

  const sorted = [...clients].sort((a, b) => String(b.lastOrderAt).localeCompare(String(a.lastOrderAt)));
  const hiddenCount = sorted.filter((client) => client.hidden).length;
  if (showHidden && !hiddenCount) setShowHidden(false);
  const viewingHidden = showHidden && hiddenCount > 0;
  const all = sorted.filter((client) => Boolean(client.hidden) === viewingHidden);
  const visibleCount = sorted.length - hiddenCount;

  const text = query.trim().toLowerCase();
  const digits = text.replace(/\D/g, "");
  const found = all.filter((client) => {
    const phone = String(client.phone);
    return (
      !text ||
      String(client.name || "").toLowerCase().includes(text) ||
      (digits && phone.includes(digits)) ||
      (digits.startsWith("8") && phone.startsWith(`7${digits.slice(1)}`))
    );
  });

  let empty = "";
  if (!sorted.length) empty = "Клиенты появятся после первых заказов.";
  else if (!all.length) empty = "Все клиенты скрыты.";
  else if (!found.length) empty = "Никого не нашлось.";

  return (
    <section className="panel" hidden={hidden}>
      <div className="panel-head">
        <h1>Клиенты <span className="count">{viewingHidden ? `· скрытые ${hiddenCount}` : `· ${visibleCount}`}</span></h1>
        <input
          className="clients-search"
          type="search"
          placeholder="Поиск по имени или телефону"
          aria-label="Поиск клиента"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ul className="cards">
        {empty ? (
          <li className="empty">{empty}</li>
        ) : (
          found.map((client) => <ClientCard key={client.id} client={client} orders={orders} onHide={onHide} onDelete={onDelete} />)
        )}
      </ul>
      {hiddenCount > 0 && (
        <button className="btn btn-ghost hidden-toggle" type="button" onClick={() => setShowHidden(!viewingHidden)}>
          {viewingHidden ? "← Назад к клиентам" : `Показать скрытых (${hiddenCount})`}
        </button>
      )}
    </section>
  );
}
