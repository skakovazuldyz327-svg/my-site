import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const page = (name) => fileURLToPath(new URL(name, import.meta.url));
const backend = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page("index.html"),
        products: page("products.html"),
        product: page("product.html"),
        admin: page("admin.html"),
      },
    },
  },
  server: {
    fs: {
      allow: [page("."), page("../shared")],
    },
    proxy: {
      "/api": backend,
      "/images": backend,
      "/data": backend,
    },
  },
});
