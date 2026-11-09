export const MAX_STOCK = 1e6;

export async function stockOf(db, productId) {
  const rows = await db.query("SELECT size, qty FROM stock WHERE product_id = $1 ORDER BY seq", [productId]);
  return rows.length ? Object.fromEntries(rows.map((row) => [row.size, row.qty])) : null;
}

export async function allStock(db) {
  const stock = new Map();
  for (const row of await db.query("SELECT product_id, size, qty FROM stock ORDER BY seq")) {
    if (!stock.has(row.product_id)) stock.set(row.product_id, {});
    stock.get(row.product_id)[row.size] = row.qty;
  }
  return stock;
}

export async function writeStock(db, productId, stock) {
  await db.run("DELETE FROM stock WHERE product_id = $1", [productId]);
  if (!stock) return;
  for (const [size, qty] of Object.entries(stock)) await db.run("INSERT INTO stock (product_id, size, qty) VALUES ($1, $2, $3)", [productId, size, qty]);
}

// A counted product shows "in stock" while any of its sizes has a piece left.
export function withStock(product, stock) {
  if (!stock) return product;
  return { ...product, stock, inStock: Object.values(stock).some((qty) => qty > 0) };
}

// Order lines take what is on hand; the rest of the quantity is made to order. fromStock remembers how many pieces a line took,
// so cancelling gives back exactly that. A line whose size is unknown, or whose product is not counted, takes nothing.
export async function takeStock(db, items) {
  const taken = [];
  for (const item of items) {
    if (item.removed || item.fromStock > 0) {
      taken.push(item);
      continue;
    }
    const stock = await db.one("SELECT qty FROM stock WHERE product_id = $1 AND size = $2", [String(item.id), String(item.size ?? "")]);
    if (!stock) {
      // Counting was switched off since the line gave its pieces back: it no longer reads as "was not on hand".
      const { fromStock, ...line } = item;
      taken.push(line);
      continue;
    }
    const qty = Math.min(Number(item.qty) || 0, stock.qty);
    if (qty) await db.run("UPDATE stock SET qty = qty - $1 WHERE product_id = $2 AND size = $3", [qty, String(item.id), String(item.size ?? "")]);
    taken.push({ ...item, fromStock: qty });
  }
  return taken;
}

export async function returnStock(db, items) {
  const returned = [];
  for (const item of items) {
    if (!(item.fromStock > 0)) {
      returned.push(item);
      continue;
    }
    await db.run("UPDATE stock SET qty = LEAST(qty + $1, $2) WHERE product_id = $3 AND size = $4", [item.fromStock, MAX_STOCK, String(item.id), String(item.size ?? "")]);
    returned.push({ ...item, fromStock: 0 });
  }
  return returned;
}
