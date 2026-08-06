# copc-tileset

Stream [COPC](https://copc.io/) (Cloud Optimized Point Cloud) files directly into [CesiumJS](https://cesium.com/platform/cesiumjs/) — no pre-tiling, no conversion, no backend. Point a URL at a `.copc.laz` file on any static HTTP host and it streams into the globe.

## How it works

A COPC file is already an octree with level-of-detail built in. `copc-tileset` reads it over HTTP **range requests** (via [`copc.js`](https://github.com/connormanning/copc.js)) and turns each octree node into a [3D Tiles](https://cesium.com/why-cesium/3d-tiles/) tile **on the fly**, inside a Service Worker. Those tiles feed a `Cesium3DTileset`, so Cesium's engine drives view-dependent LOD, frustum culling, request scheduling and GPU memory — while attenuation, Eye Dome Lighting, custom shaders and picking come for free from Cesium's native point-cloud pipeline.

Only the nodes the camera actually needs are fetched and decoded, one at a time — the streaming is genuinely incremental, never a whole-file download.

## Installation

```bash
npm install @gyeonghokim/copc-tileset   # or: yarn add / pnpm add
```

`cesium` is a peer dependency.

## Quick Start

```ts
import { Viewer } from "cesium";
import {
  CopcProvider,
  CopcPointCloudPrimitive,
  registerCopcServiceWorker,
} from "@gyeonghokim/copc-tileset";

// 1. Register the Service Worker that serves tiles. Do this once, at startup.
//    Get it served first: `copcServiceWorker()` Vite plugin, or `copc-tileset
//    init public` for any bundler (see "Service Worker setup" below).
await registerCopcServiceWorker("/copc-sw.js");

const viewer = new Viewer("cesiumContainer");

// 2. Open a COPC file (reads header, VLRs, octree info over range requests).
const provider = await CopcProvider.fromUrl(
  "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz",
);

// 3. Create the point cloud and add it to the scene.
const pointCloud = await CopcPointCloudPrimitive.fromProvider(provider, {
  pointCloudShading: { attenuation: true, eyeDomeLighting: true },
});
viewer.scene.primitives.add(pointCloud);

// `Cesium3DTileset`-backed, so frame it via its bounding sphere.
viewer.camera.flyToBoundingSphere(pointCloud.boundingSphere);
```

## Requirements

Your `.copc.laz` file just needs to be served over HTTP(S) with:

- [Range request](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests) support (most static hosts and object storage, e.g. S3, support this by default)
- [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) enabled, if served from a different origin than your app

Your app must be built with a bundler that supports **`?url` asset imports** — Vite, webpack 5, Parcel, or Rspack. Point decoding runs [`laz-perf`](https://github.com/hobuinc/laz-perf) (WebAssembly) inside the Service Worker, and the library resolves its `.wasm` via a `?url` import so your bundler emits it and serves it at the right path. With a bundler that ignores `?url`, the `.wasm` is not emitted and every tile fails to decode.

## API

| | |
|---|---|
| `CopcProvider.fromUrl(url, options?)` | Reads the COPC header, VLRs and octree hierarchy via [`copc.js`](https://github.com/connormanning/copc.js). `options.headers` are sent with each range request (e.g. for auth). Returns `Promise<CopcProvider>`. |
| `CopcPointCloudPrimitive.fromProvider(provider, options?)` | Builds a `Cesium3DTileset`-backed point cloud fed by the Service Worker. Add it to `viewer.scene.primitives`; exposes `boundingSphere` and the underlying `.tileset`. Returns `Promise<CopcPointCloudPrimitive>`. |
| `registerCopcServiceWorker(scriptUrl, options?)` | Registers the tile-serving Service Worker. Call once before creating a primitive. |

`CopcPointCloudPrimitive` options (all also settable at runtime as properties):

- `pointSize` — fixed point size in pixels
- `maximumScreenSpaceError` — screen-space error that drives octree LOD refinement (default `16`)
- `dynamicScreenSpaceError` — reduce detail for far tiles in dense scenes (default `true`)
- `cacheBytes` — GPU memory budget for loaded tiles
- `pointCloudShading` — attenuation and Eye Dome Lighting, mirroring Cesium's native [`PointCloudShading`](https://cesium.com/learn/cesiumjs/ref-doc/PointCloudShading.html) (`attenuation`, `maximumAttenuation`, `eyeDomeLighting`, `eyeDomeLightingStrength`, …). Use this — not a custom shader — for distance-based point sizing and EDL.
- `customShader` — a Cesium [`CustomShader`](https://cesium.com/learn/cesiumjs/ref-doc/CustomShader.html) for attribute-driven colouring / filtering (classification, intensity, …)

## Examples

### Classification-based colouring (custom shader)

```ts
import { CustomShader } from "cesium";

pointCloud.customShader = new CustomShader({
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      float c = fsInput.metadata.Classification;
      if (c == 2.0) material.diffuse = vec3(0.55, 0.4, 0.25);  // ground
      else if (c == 5.0) material.diffuse = vec3(0.1, 0.6, 0.1); // high vegetation
    }`,
});
```

### Point picking

Each point is a `Cesium3DTileFeature` with its per-point attributes:

```ts
import { Cesium3DTileFeature, ScreenSpaceEventHandler, ScreenSpaceEventType } from "cesium";

const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
handler.setInputAction((movement) => {
  const feature = viewer.scene.pick(movement.position);
  if (feature instanceof Cesium3DTileFeature) {
    console.log("Classification:", feature.getProperty("Classification"));
    console.log("Intensity:", feature.getProperty("Intensity"));
    console.log("GpsTime:", feature.getProperty("GpsTime"));
  }
}, ScreenSpaceEventType.LEFT_CLICK);
```

### Alongside other 3D Tiles

It's a regular `Cesium3DTileset`, so it composes with buildings, terrain and photogrammetry with correct depth ordering; just add both to `scene.primitives`.

A full interactive demo (dataset switcher, EDL/attenuation toggles, point size, picking) lives in [`examples/`](./examples) — run it with `npm run dev`.

## Guides

- [Bundler & Service Worker setup](./docs/bundler-setup.md) — the Vite plugin, the `copc-tileset init` CLI, and GitHub Pages sub-path deploys
- [Authentication & protected sources](./docs/authentication.md) — custom headers, HTTP 206, signed URLs, CORS
- [Custom shaders](./docs/custom-shaders.md) — colour and filter by `Classification`, `Intensity`, `GpsTime`
- [Picking & shading](./docs/picking-and-shading.md) — point picking and runtime attenuation / EDL / LOD tuning

## Service Worker setup

Tiles are generated on the fly by a Service Worker so there is no backend. The worker shipped in the package (`dist/copc-sw.js`) is **fully self-contained** — copc, proj4 and the laz-perf glue are bundled in and the WASM is inlined — so it needs no bundler processing. You just serve it from your app's origin and register it. Two ways:

**Vite** — add the plugin; it serves the worker in dev and emits it in the build:

```ts
// vite.config.ts
import { copcServiceWorker } from "@gyeonghokim/copc-tileset/vite";

export default defineConfig({ plugins: [copcServiceWorker()] });
```

**Any bundler** — copy the worker into your static directory (like `msw init`):

```bash
npx copc-tileset init public
```

Then register it once at startup (before creating a primitive):

```ts
await registerCopcServiceWorker(`${import.meta.env.BASE_URL}copc-sw.js`);
```

Virtual tile URLs are relative to your app base, so the worker's default scope covers them — no special scope or `Service-Worker-Allowed` header is needed, even on sub-path hosts like GitHub Pages. `registerCopcServiceWorker` resolves only once the worker controls the page (otherwise the first `tileset.json` request would fall through to your static host); on a visitor's first load the freshly activated worker takes control via `clients.claim()`, and in the rare case it activates without claiming, the helper performs a single guarded page reload. See the [bundler setup guide](./docs/bundler-setup.md) for details.

## Sample Data

All three are served from a public S3 bucket with HTTP Range and CORS enabled, so they work in the browser out of the box.

| Dataset | Size | URL |
|---|---|---|
| Autzen Stadium | 77 MB | `https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz` |
| Millsite Reservoir | 1.35 GB | `https://s3.amazonaws.com/hobu-lidar/millsite.copc.laz` |
| SoFi Stadium | 1.9 GB | `https://s3.amazonaws.com/hobu-lidar/sofi.copc.laz` |

## Supply Chain

A Software Bill of Materials is generated on every release in both CycloneDX 1.5 ([`sbom/bom.cdx.json`](./sbom/bom.cdx.json)) and SPDX 2.3 ([`sbom/bom.spdx.json`](./sbom/bom.spdx.json)), and scanned for known vulnerabilities in CI. The runtime closure is 10 packages, all permissively licensed.

See [SBOM.md](./SBOM.md) for how it's produced, how to verify it yourself, and what gets bundled into which published file.

## Built On

[copc.js](https://github.com/connormanning/copc.js) · [CesiumJS](https://github.com/CesiumGS/cesium) · [3D Tiles](https://github.com/CesiumGS/3d-tiles) · [COPC Specification](https://copc.io/)

Inspired by [TIFFImageryProvider](https://github.com/hongfaqiu/TIFFImageryProvider), developed for the 2026 Open Source Developer Contest ([Gaia3D](https://gaia3d.com/) designated task).

## License

[AGPL-3.0-or-later](LICENSE)
