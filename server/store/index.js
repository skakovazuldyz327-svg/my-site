import { silentLogger } from "../log.js";
import { createBackups } from "./backup.js";
import { createCatalog } from "./catalog.js";
import { createChatFiles } from "./chatFiles.js";
import { createClients } from "./clients.js";
import { openDatabase } from "./db.js";
import { createLock } from "./files.js";
import { importLegacy, importRescued } from "./legacy.js";
import { createOrders } from "./orders.js";
import { createPhotos } from "./photos.js";

export function createStore(config, logger = silentLogger) {
  const db = openDatabase(config.paths.database);
  try {
    importLegacy(db, config.paths, logger);
    importRescued(db, config.paths, logger);
  } catch (error) {
    db.close();
    throw error;
  }
  const catalog = createCatalog(db);
  const clients = createClients(db);
  const orders = createOrders(db, { catalog, paths: config.paths, logger });
  const backups = createBackups(config, db, { catalog, orders, clients });
  const chatFiles = createChatFiles(db, config.paths, config.chatFiles, createLock());
  const photos = createPhotos(db, config.paths);
  return { db, catalog, clients, orders, backups, chatFiles, photos, close: () => db.close() };
}
