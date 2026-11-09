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
export async function insertClient(db, client) {
  await db.run("INSERT INTO clients (id, phone, name, created_at, last_order_at, hidden, extra) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
    String(client.id || shortId()),
    String(client.phone),
    String(client.name ?? ""),
    String(client.createdAt ?? ""),
    String(client.lastOrderAt ?? client.createdAt ?? ""),
    Boolean(client.hidden),
    extraOf(client, FIELDS)
  ]);
}

// One client per phone: a newer order updates the name and brings a hidden client back into the list.
export async function mergeClient(db, name, phone, when) {
  const key = phoneKey(phone);
  if (!key) return;
  const client = await db.one("SELECT id, last_order_at FROM clients WHERE phone = $1", [key]);
  if (!client) {
    await db.run("INSERT INTO clients (id, phone, name, created_at, last_order_at) VALUES ($1, $2, $3, $4, $5)", [shortId(), key, name, when, when]);
    return;
  }
  if (when > client.last_order_at) {
    await db.run("UPDATE clients SET name = CASE WHEN $1::text = '' THEN name ELSE $1::text END, last_order_at = $2, hidden = FALSE WHERE id = $3", [name, when, client.id]);
  }
}

export function createClients(db) {
  return {
    read: async () => (await db.query("SELECT * FROM clients ORDER BY seq")).map(fromRow),

    async setHidden(payload) {
      return (await db.run("UPDATE clients SET hidden = $1 WHERE id = $2", [Boolean(payload?.hidden), String(payload?.id ?? "")])) > 0;
    },

    // Only the card goes: the client's orders keep their name and phone, and a new order brings the card back.
    async remove(payload) {
      return (await db.run("DELETE FROM clients WHERE id = $1", [String(payload?.id ?? "")])) > 0;
    }
  };
}
