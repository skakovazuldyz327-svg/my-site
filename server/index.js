import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createAi } from "./ai/index.js";
import { createApp } from "./app.js";
import { DEFAULT_ADMIN_PASSWORD, loadConfig } from "./config.js";
import { holdFolder } from "./instance.js";
import { createLogger } from "./log.js";
import { DatabaseUnreachableError, NewDatabaseRefusedError } from "./store/db.js";
import { createStore } from "./store/index.js";
import { listBackups } from "./store/restore.js";

// After this long a crash is a rare accident, not a crash loop, so start-site.bat forgets the earlier ones.
const HEALTHY_RUN_SECONDS = 10 * 60;

const config = loadConfig();
const logger = createLogger(config.paths.log);

if (!(await holdFolder(config.root))) {
  logger.error("the site is already running from this folder in another window - close that window or run stop-site.bat");
  await logger.flush();
  process.exit(2);
}

// An empty database would start order numbers from 1, giving out numbers clients already have. With earlier data around
// that is an accident (a lost Docker volume, a wrong POSTGRES_DB), so the site waits for the owner instead.
let earlier = [];
function mayCreate() {
  if (process.argv.includes("--new-database") || existsSync(config.paths.sqlite)) return true;
  try {
    earlier = [
      ...readdirSync(config.paths.db).filter((name) => /^before-restore-.+\.(json|sqlite)$|^zhuldyz-before-postgres.*\.sqlite$/.test(name)),
      ...listBackups(config.paths).map((backup) => `backups/${backup.day}`)
    ];
  } catch (error) {
    if (error.code !== "ENOENT") earlier = [`earlier data could not be checked: ${error.message}`];
  }
  return !earlier.length;
}

let store;
try {
  store = await createStore(config, logger, { mayCreate });
} catch (error) {
  if (error instanceof NewDatabaseRefusedError) {
    logger.error(`${error.message} but earlier data exists - the site was not started so order numbers are not given out again; run restore-backup.bat, or start with --new-database to begin an empty one`, { found: earlier.slice(0, 10) });
  } else if (error instanceof DatabaseUnreachableError) {
    logger.error(error.message);
  } else {
    logger.error("the database could not be opened or the old data could not be moved into it - nothing was changed; run restore-backup.bat or fix the file named here", { message: String(error?.stack || error) });
  }
  await logger.flush();
  process.exit(2);
}
const ai = createAi({ config, store, logger });
const server = createApp({ config, store, logger, ai });

process.on("unhandledRejection", (error) => logger.error("unhandled rejection", { message: String(error?.stack || error) }));
process.on("uncaughtException", async (error) => {
  logger.error("uncaught exception", { message: String(error?.stack || error) });
  await logger.flush();
  process.exit(process.uptime() > HEALTHY_RUN_SECONDS ? 4 : 1);
});

const backupDone = store.backups.daily().catch((error) => logger.error("backup failed", { message: error.message }));

const cleanChatFiles = () => store.chatFiles.cleanup().catch((error) => logger.error("chat files cleanup failed", { message: error.message }));
const cleanPhotos = () =>
  store.photos.cleanup().then(
    (removed) => removed.length && logger.info("removed photos no product or backup uses", { files: removed }),
    (error) => logger.error("photo cleanup skipped", { message: error.message })
  );
const copyOffsite = () =>
  store.backups.offsite().then(
    (copy) => copy && logger.info("database copied outside the site folder", { file: copy.file, newPhotos: copy.photos }),
    (error) => logger.error("copy outside the site folder failed - check BACKUP_COPY_DIR in .env", { message: error.message })
  );
cleanChatFiles();
backupDone.then(cleanPhotos).then(copyOffsite);
setInterval(() => {
  cleanChatFiles();
  cleanPhotos();
  copyOffsite();
}, 6 * 60 * 60 * 1000).unref();

server.on("error", async (error) => {
  logger.error(error.code === "EADDRINUSE" ? `port ${config.port} is busy - is the site already running?` : "server error", { message: error.message });
  await logger.flush();
  process.exit(2);
});

server.listen(config.port, config.host, () => {
  const url = `http://${config.host}:${config.port}/`;
  const active = ai.providers.filter((provider) => provider.available()).map((provider) => provider.id);
  console.log("");
  console.log(`  Site:  ${url}`);
  console.log(`  Admin: ${url}admin.html`);
  console.log(active.length ? `  AI:    ${active.join(" -> ")} (${config.ai.openai.model}), rules as backup` : "  AI:    rules only (no OPENAI_API_KEY in .env)");
  console.log("  Close this window to stop the site.");
  console.log("");
  logger.info("server started", { url, ai: active });
  if (config.adminPassword === DEFAULT_ADMIN_PASSWORD) {
    logger.warn("admin password is the default one, so the admin page works only on this computer - set ADMIN_PASSWORD in .env to use it from elsewhere");
  }
  if (!process.argv.includes("--no-browser")) {
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  }
});
