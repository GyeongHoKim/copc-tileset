# Bundler & Service Worker setup

`copc-tileset` generates tiles on the fly in a **Service Worker**, so there is no backend — but the worker file has to be served from your app's own origin. The worker shipped in the package (`dist/copc-sw.js`) is **fully self-contained**: copc, proj4 and the laz-perf glue are bundled in and the laz-perf WASM is inlined, so it needs no bundler processing of its own. You just have to get it served and register it.

Related: [Authentication](./authentication.md) · [Custom shaders](./custom-shaders.md) · [Picking & shading](./picking-and-shading.md)

## Vite: the `copcServiceWorker()` plugin (recommended)

Add the plugin to your Vite config. It serves the worker at `${BASE_URL}copc-sw.js` in dev and emits it into the build output — no manual asset wiring.

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { copcServiceWorker } from "@gyeonghokim/copc-tileset/vite";

export default defineConfig({
  plugins: [copcServiceWorker()],
});
```

Optionally rename the served file:

```ts
copcServiceWorker({ fileName: "copc-sw.js" }); // default
```

## Any bundler: the `copc-tileset init` CLI

For webpack, Parcel, Rspack, or no bundler at all, copy the self-contained worker into your static/public directory (the same idea as `msw init`). Because the worker needs no bundler processing, serving the copied file is all it takes.

```bash
npx copc-tileset init public
# copc-tileset: wrote copc-sw.js to /abs/path/public/copc-sw.js
```

Re-run it after upgrading the package to refresh the copied worker. To keep it in sync automatically, add it to a `postinstall`/`prepare` script:

```jsonc
// package.json
{
  "scripts": {
    "postinstall": "copc-tileset init public"
  }
}
```

## Register the worker

Register it once at startup, **before** creating any primitive. `registerCopcServiceWorker` resolves only once the worker controls the page, so the first `tileset.json` request cannot fall through to your static host.

```ts
import { registerCopcServiceWorker } from "@gyeonghokim/copc-tileset";

// The URL must match where the worker is served (plugin or CLI put it at the app base).
await registerCopcServiceWorker(`${import.meta.env.BASE_URL}copc-sw.js`);
```

With a non-Vite bundler use the equivalent base-relative URL, e.g. `registerCopcServiceWorker("/copc-sw.js")`.

## GitHub Pages & other sub-path hosts

Virtual tile URLs are **relative** to your app base, so the worker's default scope (its own directory) covers them — no special `scope` or `Service-Worker-Allowed` header, even under a project sub-path like `https://user.github.io/repo/`.

Two things make sub-path deploys work:

- Build with a **relative or sub-path base** so asset URLs resolve under the sub-path. With Vite, set `base` (the demo uses `DEMO_BASE="./"` in its Pages workflow).
- Register with a **base-relative** URL (`${import.meta.env.BASE_URL}copc-sw.js`), never a hard-coded `/copc-sw.js`.

## What your app bundler still needs

The worker is self-contained, but your **app** imports the library's main entry (`@gyeonghokim/copc-tileset`), which reaches laz-perf via a `?url` WASM asset import. So your app must be built with a bundler that supports `?url` asset imports — Vite, webpack 5, Parcel, or Rspack. (The worker itself does not depend on this; only the main-thread bundle does.)
