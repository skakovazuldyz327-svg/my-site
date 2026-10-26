export const MAX_STOCK = 1e6;

export function stockOf(db, productId) {
  const rows = db.prepare("SELECT size, qty FROM stock WHERE product_id = ? ORDER BY rowid").all(productId);
  return rows.length ? Object.fromEntries(rows.map((row) => [row.size, row.qty])) : null;
}

export function allStock(db) {
  const stock = new Map();
  for (const row of db.prepare("SELECT product_id, size, qty FROM stock ORDER BY rowid").all()) {
    if (!stock.has(row.product_id)) stock.set(row.product_id, {});
    stock.get(row.product_id)[row.size] = row.qty;
  }
  return stock;
}

export function writeStock(db, productId, stock) {
  db.prepare("DELETE FROM stock WHERE product_id = ?").run(productId);
  if (!stock) return;
  const insert = db.prepare("INSERT INTO stock (product_id, size, qty) VALUES (?, ?, ?)");
  for (const [size, qty] of Object.entries(stock)) insert.run(productId, size, qty);
}

// A counted product shows "in stock" while any of its sizes has a piece left.
export function withStock(product, stock) {
  if (!stock) return product;
  return { ...product, stock, inStock: Object.values(stock).some((qty) => qty > 0) };
}

// Order lines take what is on hand; the rest of the quantity is made to order. fromStock remembers how many pieces a line took,
// so cancelling gives back exactly that. A line whose size is unknown, or whose product is not counted, takes nothing.
export function takeStock(db, items) {
  const row = db.prepare("SELECT qty FROM stock WHERE product_id = ? AND size = ?");
  const update = db.prepare("UPDATE stock SET qty = qty - ? WHERE product_id = ? AND size = ?");
  return items.map((item) => {
    if (item.removed || item.fromStock > 0) return item;
    const stock = row.get(String(item.id), String(item.size ?? ""));
    if (!stock) {
      // Counting was switched off since the line gave its pieces back: it no longer reads as "was not on hand".
      const { fromStock, ...line } = item;
      return line;
    }
    const taken = Math.min(Number(item.qty) || 0, stock.qty);
    if (taken) update.run(taken, String(item.id), String(item.size ?? ""));
    return { ...item, fromStock: taken };
  });
}

export function returnStock(db, items) {
  const update = db.prepare("UPDATE stock SET qty = MIN(qty + ?, ?) WHERE product_id = ? AND size = ?");
  return items.map((item) => {
    if (!(item.fromStock > 0)) return item;
    update.run(item.fromStock, MAX_STOCK, String(item.id), String(item.size ?? ""));
    return { ...item, fromStock: 0 };
  });
}
