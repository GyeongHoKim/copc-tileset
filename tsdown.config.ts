import { readFileSync } from "node:fs";
import type { Plugin } from "rolldown";
import { defineConfig } from "tsdown";

// Rewrites `import url from "*.wasm?url"` to a self-contained module that exports
// an inlined `data:` URL of the WASM bytes. Used only for the standalone worker
// build so the shipped Service Worker needs no bundler asset processing at all —
// it can be copied verbatim into a consumer's public directory and served as-is.
function inlineWasmUrl(): Plugin {
  const URL_SUFFIX = ".wasm?url";
  const VIRTUAL = "\0inline-wasm-url:";
  return {
    name: "inline-wasm-url",
    async resolveId(id, importer) {
      if (!id.endsWith(URL_SUFFIX)) return null;
      const real = id.slice(0, -"?url".length);
      const resolved = await this.resolve(real, importer, { skipSelf: true });
      return VIRTUAL + (resolved?.id ?? real);
    },
    load(id) {
      if (!id.startsWith(VIRTUAL)) return null;
      const file = id.slice(VIRTUAL.length);
      const base64 = readFileSync(file).toString("base64");
      return `export default "data:application/wasm;base64,${base64}";`;
    },
  };
}

export default defineConfig([
  // Library API. Keep laz-perf (and its `?url` WASM asset import) external so the
  // consumer's bundler resolves the module and emits the WASM. Bundling it here
  // would inline the Emscripten glue and drop the asset.
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
    dts: true,
    clean: true,
    treeshake: true,
    deps: { neverBundle: [/^laz-perf(\/|$)/] },
  },
  // Standalone Service Worker. Bundle EVERYTHING — copc, proj4, laz-perf glue —
  // and inline the WASM as a data URL, so `dist/copc-sw.js` is fully self-contained
  // and runs with zero bundler processing (copied by the `copc-tileset init` CLI
  // and emitted by the Vite plugin).
  {
    entry: { "copc-sw": "src/sw/copc-sw.ts" },
    format: ["esm"],
    platform: "browser",
    dts: false,
    clean: false,
    treeshake: true,
    deps: { alwaysBundle: [/.*/] },
    plugins: [inlineWasmUrl()],
  },
  // Tooling shipped with the package: the `copc-tileset` CLI and the Vite plugin.
  // Both locate `./copc-sw.js` relative to themselves at runtime (same dist dir).
  {
    entry: { cli: "src/cli.ts", vite: "src/vite.ts" },
    format: ["esm"],
    platform: "node",
    dts: { entry: "src/vite.ts" },
    clean: false,
    treeshake: true,
    // Force `.js`/`.d.ts` (node platform otherwise emits `.mjs`/`.d.mts`) so the
    // package.json `bin` and `exports` paths resolve.
    outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  },
]);
