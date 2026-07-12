# CopcTileset

Stream [COPC](https://copc.io/) (Cloud Optimized Point Cloud) files directly into [CesiumJS](https://cesium.com/platform/cesiumjs/) — no pre-tiling, no backend, just a `.copc.laz` file on any static HTTP host.

## Installation

```bash
npm install @gyeonghokim/copc-tileset
```

```bash
yarn add @gyeonghokim/copc-tileset
```

```bash
pnpm add @gyeonghokim/copc-tileset
```

## Quick Start

```ts
import { Viewer } from "cesium";
import { CopcProvider, CopcPointCloudPrimitive } from "@gyeonghokim/copc-tileset";

const viewer = new Viewer("cesiumContainer");

const provider = await CopcProvider.fromUrl(
  "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz"
);

const pointCloud = new CopcPointCloudPrimitive({ provider });

viewer.scene.primitives.add(pointCloud);

// `viewer.flyTo` only accepts Entity/DataSource/Cesium3DTileset/… — not a raw
// primitive — so frame the cloud via its bounding sphere (derived from the
// COPC header bounds).
viewer.camera.flyToBoundingSphere(pointCloud.boundingSphere);
```

## Requirements

Your `.copc.laz` file just needs to be served over HTTP(S) with:

- [Range request](https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests) support (most static hosts and object storage, e.g. S3, support this by default)
- [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS) enabled, if served from a different origin than your app

## API

| | |
|---|---|
| `CopcProvider.fromUrl(url, options?)` | Reads the COPC header, VLRs, and octree hierarchy via [`copc.js`](https://github.com/connormanning/copc.js). Returns a `Promise<CopcProvider>`. |
| `new CopcPointCloudPrimitive({ provider, ...options })` | A Cesium `Primitive` that streams and renders octree nodes based on camera view and level of detail. Add it to `viewer.scene.primitives`; exposes a `boundingSphere` for camera framing. |

Common `CopcPointCloudPrimitive` options:

- `pointSize`, `maximumScreenSpaceError` — point size and the screen-space error that drives octree LOD refinement (which nodes stream in for the current view)
- `pointCloudShading` — attenuation and Eye Dome Lighting, mirroring Cesium's native [`PointCloudShading`](https://cesium.com/learn/cesiumjs/ref-doc/PointCloudShading.html) (`attenuation`, `maximumAttenuation`, `eyeDomeLighting`, `eyeDomeLightingStrength`, ...). Use this — not a custom shader — for distance-based point sizing and EDL.
- `customShader` — a Cesium [`CustomShader`](https://cesium.com/learn/cesiumjs/ref-doc/CustomShader.html) (GLSL `vertexMain`/`fragmentMain`) for attribute-driven work like classification-based coloring or filtering. Per-point attributes (Classification, Intensity, RGB, GPS time, ...) are exposed to the shader as vertex attributes.
- `enablePicking` — makes the primitive respond to `scene.pick()`, which returns `{ primitive, ... }` with the per-point attributes of the point under the cursor

See [`examples/`](./examples) for custom shading, classification filtering, point picking, and combining with an existing `Cesium3DTileset`.

## Sample Data

All three are served from a public S3 bucket with HTTP Range and CORS enabled, so they work in the browser out of the box.

| Dataset | Size | URL |
|---|---|---|
| Autzen Stadium | 77 MB | `https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz` |
| Millsite Reservoir | 1.35 GB | `https://s3.amazonaws.com/hobu-lidar/millsite.copc.laz` |
| SoFi Stadium | 1.9 GB | `https://s3.amazonaws.com/hobu-lidar/sofi.copc.laz` |

## Built On

[copc.js](https://github.com/connormanning/copc.js) · [CesiumJS](https://github.com/CesiumGS/cesium) · [COPC Specification](https://copc.io/)

Inspired by [TIFFImageryProvider](https://github.com/hongfaqiu/TIFFImageryProvider), developed for the 2026 Open Source Developer Contest ([Gaia3D](https://gaia3d.com/) designated task).

## License

MIT

