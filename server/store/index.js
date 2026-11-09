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
import { importSqlite } from "./sqliteImport.js";

// mayCreate: see openDatabase.
export async function createStore(config, logger = silentLogger, { mayCreate } = {}) {
  const db = await openDatabase(config.database, { waitMs: config.databaseWaitMs, mayCreate, logger });
  try {
    await importSqlite(db, config.paths, logger);
    await importLegacy(db, config.paths, logger);
    await importRescued(db, config.paths, logger);
    const catalog = createCatalog(db, logger);
    const clients = createClients(db);
    const orders = await createOrders(db, { catalog, paths: config.paths, logger });
    const backups = createBackups(config, db, { catalog, orders, clients });
    const chatFiles = createChatFiles(db, config.paths, config.chatFiles, createLock(), logger);
    const photos = createPhotos(db, config.paths, logger);
    return { db, catalog, clients, orders, backups, chatFiles, photos, close: () => db.close() };
  } catch (error) {
    await db.close();
    throw error;
  }
}
