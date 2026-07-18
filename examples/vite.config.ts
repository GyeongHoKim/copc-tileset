import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import cesium from "vite-plugin-cesium";
// The built plugin (dist/vite.js) — it serves/emits the self-contained
// dist/copc-sw.js, so `npm run build` must run before the demo (see the
// `dev` / `build:demo` scripts). This exercises the shipped worker + plugin
// end-to-end, exactly as a consumer would use them.
import { copcServiceWorker } from "../dist/vite.js";

const lib = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const html = fileURLToPath(new URL("./index.html", import.meta.url));
// The build runs with cwd = examples/, so Cesium's assets are copied next to the
// output. Point the plugin at the repo-root Cesium build (node_modules is hoisted).
const cesiumBuildRootPath = fileURLToPath(new URL("../node_modules/cesium/Build", import.meta.url));
const cesiumBuildPath = fileURLToPath(
  new URL("../node_modules/cesium/Build/Cesium", import.meta.url),
);

// Set DEMO_BASE="./" (the Pages workflow does) for a relative base so the built
// demo works under any path — including a GitHub Pages project sub-path — without
// rewriting asset URLs. Defaults to "/" for local dev.
export default defineConfig({
  base: process.env.DEMO_BASE ?? "/",
  plugins: [cesium({ cesiumBuildRootPath, cesiumBuildPath }), copcServiceWorker()],
  resolve: {
    alias: { "@gyeonghokim/copc-tileset": lib },
  },
  // Fixed port so the Playwright E2E (playwright.config.ts) can target it.
  preview: { port: 4173, strictPort: true },
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: { main: html },
    },
  },
});
