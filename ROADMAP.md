# Vision & Roadmap

## Vision

**Any COPC file on any static HTTP host should render in CesiumJS by pasting its
URL — no conversion step, no tiling pipeline, no backend.**

A COPC file is already a level-of-detail octree. The pre-tiling step that most
point-cloud workflows still require exists only because renderers cannot read
that octree directly. `copc-tileset` removes that step: it reads the octree over
HTTP range requests and synthesises 3D Tiles on the fly inside a Service Worker,
so CesiumJS's own engine drives LOD, culling, request scheduling and GPU memory.

Everything below follows from that one goal. When a proposal is judged, the
question is whether it moves "URL in, points on the globe" forward.

## In scope

- Reading COPC over HTTP range requests, including authenticated and signed
  sources.
- Synthesising `tileset.json` and `.pnts` faithfully enough that Cesium's native
  point-cloud pipeline — attenuation, Eye Dome Lighting, custom shaders,
  picking — works unmodified.
- Correctness of the geometry: octree bounds, geometric error, ECEF bounding
  volumes, CRS reprojection including compound (`COMPD_CS`) vertical units.
- Exposing per-point attributes for shading and picking.
- Making the Service Worker easy to ship from any bundler and any host,
  including sub-path deployments.
- Streaming behaviour: fetching only what the camera needs, and staying
  responsive on multi-gigabyte files.

## Non-goals

These are deliberate exclusions, not missing features. Pull requests
implementing them will be closed with a link here.

- **Other point-cloud formats.** No EPT, Potree, plain LAS/LAZ, e57 or PLY
  ingest. If a file is not a COPC, convert it with
  [PDAL](https://pdal.io/) first — that is a solved problem and not this
  project's job.
- **Server-side or offline tiling.** No CLI that converts a file into a 3D Tiles
  directory. The entire point is that no such step exists.
- **Renderers other than CesiumJS.** No three.js, deck.gl or MapLibre adapters.
  The Cesium-free core (`src/octree.ts`, `src/pnts.ts`, `src/reproject.ts`) makes
  a separate adapter possible for someone else to build, but it will not live
  here.
- **Writing or editing COPC.** Read-only, by design.
- **Point-cloud analysis** — classification, segmentation, meshing, measurement
  tooling. Shading and picking hooks are provided so that an application can
  build these on top.
- **Whole-file download fallbacks.** If a host does not support range requests,
  that is a host problem; downloading a 2 GB file into the browser is not a
  supported mode.

## Near-term

Roughly in priority order. Nothing here is a dated commitment.

- **Broader CRS coverage.** More real-world compound and projected CRSs
  exercised against real data, with regression tests for each WKT shape that has
  broken before.
- **More per-point attributes** in the batch table — `ReturnNumber`,
  `NumberOfReturns`, `ScanAngleRank`, `PointSourceId` — so custom shaders and
  picking can use them alongside `Classification` / `Intensity` / `GpsTime`.
- **Memory and request tuning knobs** with documented defaults: cache budget,
  concurrent range requests, and how they interact with Cesium's
  `maximumScreenSpaceError`.
- **Error surface.** Actionable, `copc-tileset:`-prefixed diagnostics for the
  failure modes users actually hit — missing CORS, no range support, a bundler
  that dropped the laz-perf `.wasm`, a Service Worker that never took control.
- **Bundler coverage beyond Vite.** Verified webpack, Rspack and Parcel recipes
  in `docs/bundler-setup.md`, ideally with a smoke test each.
- **A published API reference** built from the TypeScript types, alongside the
  existing hand-written guides.

## Later

- Multiple COPC sources in one scene with shared memory accounting.
- A no-bundler build (script tag / CDN) for quick experiments.
- Performance work on the decode path: reusing laz-perf instances, transferring
  buffers instead of copying.
- Optional client-side filtering by classification or return before encoding, to
  cut GPU memory on dense urban scans.

## How this document is used

Issues labelled [`good first issue`](https://github.com/GyeongHoKim/copc-tileset/labels/good%20first%20issue)
are usually slices of the near-term list. If you want to work on something
larger, open a [Discussion](https://github.com/GyeongHoKim/copc-tileset/discussions)
before writing code — it is a cheaper conversation than a rejected pull request.

Scope arguments are welcome. The non-goals above are considered decisions, not
laws; changing one requires a case, not a pull request.
