// Vite plugin for zero-config Service Worker delivery. It serves the bundled,
// self-contained worker in dev and emits it into the build output at a stable,
// unhashed URL — so Vite users never touch their bundler config or run the
// `copc-tileset init` CLI. Register the served file with
// `registerCopcServiceWorker(`${import.meta.env.BASE_URL}copc-sw.js`)`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export interface CopcServiceWorkerOptions {
  /**
   * Filename the worker is served/emitted as (default `"copc-sw.js"`). Register
   * the matching URL, e.g. `registerCopcServiceWorker("/copc-sw.js")`.
   */
  fileName?: string;
}

/**
 * Serves `copc-sw.js` from the app's base in dev and emits it into the build
 * output, so the Service Worker is available at `${BASE_URL}copc-sw.js` with no
 * manual bundler wiring. Add it to your Vite `plugins` array.
 */
export function copcServiceWorker(options: CopcServiceWorkerOptions = {}): Plugin {
  const fileName = options.fileName ?? "copc-sw.js";
  // dist/vite.js and dist/copc-sw.js sit side by side; read the worker relative
  // to this module so it works regardless of the consumer's install layout.
  const workerPath = fileURLToPath(new URL("./copc-sw.js", import.meta.url));
  let base = "/";

  return {
    name: "copc-tileset:service-worker",

    configResolved(config) {
      base = config.base;
    },

    configureServer(server) {
      const basePath = base.endsWith("/") ? base : `${base}/`;
      const served = new Set([`/${fileName}`, `${basePath}${fileName}`]);
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0];
        if (!path || !served.has(path)) return next();
        res.setHeader("Content-Type", "text/javascript");
        // The worker lives at the app root, so its default scope already covers
        // the virtual tile URLs; this header just future-proofs sub-path serving.
        res.setHeader("Service-Worker-Allowed", "/");
        res.end(readFileSync(workerPath));
      });
    },

    generateBundle() {
      this.emitFile({ type: "asset", fileName, source: readFileSync(workerPath) });
    },
  };
}
