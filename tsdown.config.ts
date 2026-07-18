import { defineConfig } from "tsdown";

export default defineConfig({
  // Two entries: the library API (index) and the Service Worker (copc-sw). The
  // worker must ship in the package so consumers can register it via the
  // `@gyeonghokim/copc-tileset/copc-sw` export (see registerCopcServiceWorker).
  entry: ["src/index.ts", "src/sw/copc-sw.ts"],
  format: ["esm"],
  platform: "neutral",
  dts: true,
  clean: true,
  treeshake: true,
  // Keep laz-perf (and its `?url` WASM asset import) as an external import so the
  // consumer's bundler resolves the module and emits the WASM. Bundling it here
  // would inline the Emscripten glue and drop the asset.
  deps: { neverBundle: [/^laz-perf(\/|$)/] },
});
