import { extraOf, parseExtra } from "./db.js";
import { shortId } from "./files.js";

const FIELDS = ["id", "phone", "name", "createdAt", "lastOrderAt", "hidden"];

export function phoneKey(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  else if (digits.length === 10) digits = `7${digits}`;
  return digits;
}

const fromRow = (row) => ({
  id: row.id,
  phone: row.phone,
  name: row.name,
  createdAt: row.created_at,
  lastOrderAt: row.last_order_at,
  hidden: Boolean(row.hidden),
  ...parseExtra(row.extra)
});

// Keeps a client exactly as it was saved before the database (id, dates, the "hidden" mark).
export function insertClient(db, client) {
  db.prepare("INSERT INTO clients (id, phone, name, created_at, last_order_at, hidden, extra) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    String(client.id || shortId()),
    String(client.phone),
    String(client.name ?? ""),
    String(client.createdAt ?? ""),
    String(client.lastOrderAt ?? client.createdAt ?? ""),
    client.hidden ? 1 : 0,
    extraOf(client, FIELDS)
  );
}

// One client per phone: a newer order updates the name and brings a hidden client back into the list.
export function mergeClient(db, name, phone, when) {
  const key = phoneKey(phone);
  if (!key) return;
  const client = db.prepare("SELECT id, last_order_at FROM clients WHERE phone = ?").get(key);
  if (!client) {
    db.prepare("INSERT INTO clients (id, phone, name, created_at, last_order_at) VALUES (?, ?, ?, ?, ?)").run(shortId(), key, name, when, when);
    return;
  }
  if (when > client.last_order_at) {
    db.prepare("UPDATE clients SET name = CASE WHEN ? = '' THEN name ELSE ? END, last_order_at = ?, hidden = 0 WHERE id = ?").run(name, name, when, client.id);
  }
}

export function createClients(db) {
  const rows = db.prepare("SELECT * FROM clients ORDER BY rowid");

  return {
    read: async () => rows.all().map(fromRow),

    async setHidden(payload) {
      const result = db.prepare("UPDATE clients SET hidden = ? WHERE id = ?").run(payload?.hidden ? 1 : 0, String(payload?.id ?? ""));
      return result.changes > 0;
    },

    // Only the card goes: the client's orders keep their name and phone, and a new order brings the card back.
    async remove(payload) {
      return db.prepare("DELETE FROM clients WHERE id = ?").run(String(payload?.id ?? "")).changes > 0;
    }
  };
}
