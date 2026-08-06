# AGENTS.md

This file provides guidance to AI agents when working with code in this repository.

## What this is

A library that streams [COPC](https://copc.io/) (Cloud Optimized Point Cloud, `.copc.laz`) files directly into CesiumJS with no pre-tiling and no backend. A COPC file is already a LOD octree; this library reads it over HTTP range requests and synthesises [3D Tiles](https://cesium.com/why-cesium/3d-tiles/) (`tileset.json` + `.pnts`) **on the fly inside a Service Worker**, feeding a `Cesium3DTileset` that drives view-dependent streaming, LOD, culling and GPU memory. `cesium` is a peer dependency; `copc` (copc.js) and `proj4` are the only runtime deps.

## Commands

```bash
npm run build            # bundle to dist/ with tsdown (ESM + .d.ts)
npm run typecheck        # tsc --noEmit
npm run check            # biome lint + format check (read-only)
npm run check:fix        # biome autofix + format write
npm test                 # vitest run — unit tests only (offline, deterministic)
npm run test:integration # vitest against real COPC data over the network (60s timeouts)
npm run sbom             # regenerate the SBOMs in sbom/ (npm sbom, SPDX + CycloneDX)
npm run sbom:check       # fail if the committed SBOMs are stale — runs in CI
npm run dev              # run the interactive demo in examples/ (vite)
```

Run a single test: `npx vitest run src/pnts.test.ts` (add `-t "name"` to filter by test name). Watch mode: `npm run test:watch`.

- Unit tests are `src/**/*.test.ts` and must stay offline; anything that hits the network goes in `*.integration.test.ts` and is **excluded** from `npm test` (see `vitest.config.ts` vs `vitest.integration.config.ts`).
- Commits must be [Conventional Commits](https://www.conventionalcommits.org/) — a husky `commit-msg` hook runs commitlint, and `semantic-release` derives the version and changelog from commit messages on `trunk`. A `pre-commit` hook runs `biome check` on staged files.

## Architecture

The single most important constraint: **the tile-generation code runs in a Service Worker, which has no DOM and no Cesium.** The codebase is split into two runtime contexts by the virtual URL scheme in `src/sw/scheme.ts`.

### Main thread (imports Cesium)

- `CopcPointCloudPrimitive.ts` — the only module that imports `cesium`. Wraps a `Cesium3DTileset` whose URL is a *virtual* tileset URL (`__copc-tileset__/<encodedCopcUrl>/tileset.json`). Forwards Cesium's per-frame primitive lifecycle methods (`update`, `prePassesUpdate`, …) to the tileset so it can be added to `scene.primitives` directly. Exposes runtime-settable `pointSize`, `maximumScreenSpaceError`, `pointCloudShading`, `customShader`.
- `registerServiceWorker.ts` — registers the worker and waits until it *controls* the page (otherwise tile requests 404 on the static host).

### Service Worker (must be Cesium-free)

- `sw/copc-sw.ts` — the worker entry point (browser-only, not covered by tests). Intercepts `fetch` for virtual paths, maintains one `CopcTileStore` per COPC source URL (cached as a promise so concurrent requests share one load).
- `sw/handler.ts` — transport-agnostic request handler (testable in Node): parses the virtual path, resolves the store, returns tileset JSON or `.pnts`.
- `sw/scheme.ts` — the virtual URL scheme that couples the two contexts. Encodes the source URL into one path segment so the stateless worker can reconstruct everything from the request alone. URLs are **relative** (no leading slash) so they stay inside the worker's scope on sub-path hosts like GitHub Pages.
- `CopcProvider.ts` — reads header/VLRs/hierarchy/points via copc.js range requests; builds a `Getter` (custom fetch getter when auth headers are supplied, requiring HTTP 206). Runs in both contexts, so it stays Cesium-free.
- `copcTileStore.ts` — the core engine. Turns a provider into 3D Tiles content on demand. Requests are **self-healing**: any octree key resolves by walking hierarchy pages down from the root, so a deep-tile request works even on a fresh store (e.g. after a worker restart) without the root having been fetched first. Caches expanded pages (as promises, to de-dup) with LRU eviction that runs only *after* a request completes.
- `tileset.ts` — synthesises `tileset.json` for one hierarchy page: each octree node → a tile with `.pnts` content; each unloaded child page → a leaf tile pointing at an external tileset (lazily fetched to expand that subtree).
- `pnts.ts` — encodes a decoded node into the binary `.pnts` format. Positions are float32 offsets from an `RTC_CENTER` (ECEF centroid) to avoid precision loss; per-point `Classification`/`Intensity`/`GpsTime` go in the batch table for picking and shaders. Colour bit-depth (`detectColorShift`) is a per-**file** property — detect once, reuse for every node.
- `octree.ts` — plain-math (Cesium-free) octree geometry: node bounds, geometric error (`rootSpacing / 2^depth`), and ECEF bounding spheres sampled on a 3×3×3 grid (not just corners, so curved-Earth face bulge doesn't under-enclose).
- `reproject.ts` / `wkt.ts` — reproject source-CRS points to ECEF via proj4. `wkt.ts` string-scans compound CRS WKT (`COMPD_CS`) to split the horizontal CRS (for proj4) from the vertical unit (to scale Z into metres), because proj4 can't parse compound CRSs. ECEF math uses the WGS84 ellipsoid constants directly so output matches `Cesium.Cartesian3.fromDegrees` without depending on Cesium.

### Data flow

`CopcPointCloudPrimitive.fromProvider` → `Cesium3DTileset.fromUrl(virtualTilesetUrl)` → Cesium fetches virtual URLs → Service Worker intercepts → `CopcTileStore` walks the COPC hierarchy over range requests, decodes points (laz-perf, off the main thread), and returns `tileset.json` / `.pnts` → Cesium renders and drives further LOD requests.

## Code Quality Gate

> UNNEGOTIABLE

All AI agents should run these commands for code quality after modifying code (except for just documents):

```bash
npm run check
npm run typecheck
npm run test
```

## Conventions

- Formatting/linting is Biome (2-space indent, double quotes, semicolons, 100-col). Run `npm run check:fix` before committing.
- TypeScript is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` — use `import type` for type-only imports.
- When adding tile-generation logic, **do not import from `cesium`** in any module reachable from `sw/copc-sw.ts` (that is everything except `CopcPointCloudPrimitive.ts`); it will break the Service Worker build. Keep geometry/encoding as plain math.
- Error messages are prefixed `copc-tileset:`.
- **Changing any dependency means regenerating the SBOM** — run `npm run sbom` and commit `sbom/bom.cdx.json` + `sbom/bom.spdx.json`, or CI's `sbom:check` step fails. `semantic-release` regenerates them automatically at release time. `sbom/` is excluded from Biome (`biome.json` `files.includes`) because reformatting canonical `npm sbom` output would break the "re-run the command and compare" verification story — do not undo that exclusion. See [SBOM.md](./SBOM.md).
