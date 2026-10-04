import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Serve repository data/ for Level B media fetch during local/dev/e2e. */
function serveDataDir(): Plugin {
  return {
    name: "serve-data-dir",
    configureServer(server) {
      server.middlewares.use("/data", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        const filePath = path.join(process.cwd(), "data", rel.replace(/^\/+/, ""));
        if (!filePath.startsWith(path.join(process.cwd(), "data")) || !fs.existsSync(filePath)) {
          next();
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const type =
          ext === ".mp4"
            ? "video/mp4"
            : ext === ".json"
              ? "application/json"
              : "application/octet-stream";
        res.setHeader("Content-Type", type);
        fs.createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveDataDir()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
