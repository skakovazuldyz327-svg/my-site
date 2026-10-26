import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";

// The write queue works inside one process only: a second server on the same folder could hand out duplicate order
// numbers and overwrite records. Windows frees a named pipe the moment its process dies, so a crash leaves no stale lock.
export function holdFolder(root) {
  if (process.platform !== "win32") return Promise.resolve(true);
  const id = createHash("sha256").update(resolve(root).toLowerCase()).digest("hex").slice(0, 24);
  return new Promise((done) => {
    const pipe = createServer((socket) => socket.destroy());
    pipe.once("error", (error) => done(error.code !== "EADDRINUSE"));
    pipe.listen(`\\\\.\\pipe\\zhuldyz-site-${id}`, () => {
      pipe.unref();
      done(true);
    });
  });
}
