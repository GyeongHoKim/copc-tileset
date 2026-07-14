import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
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
