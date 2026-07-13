// `Bounds` is both a type and a namespace of helpers in copc, so import it as a value.
import { Bounds, Key } from "copc";
import type { Reprojector, Vec3 } from "./reproject";

// COPC data is a full octree: a node's key is `depth-x-y-z`, and its cubic bounds
// are a subdivision of the file's root cube. These helpers turn that octree into
// the geometry a 3D Tiles tile needs — bounding volume and geometric error. Kept
// Cesium-free (plain math) so it runs inside the Service Worker that builds tiles.

/** An ECEF bounding sphere: centre `[x, y, z]` and `radius`, in metres. */
export interface Sphere {
  center: Vec3;
  radius: number;
}

/** World-space (source-CRS) bounds of the octree node `key` within `cube`. */
export function nodeBounds(cube: Bounds, key: string): Bounds {
  // Copy: Bounds.stepTo returns `cube` itself for the root key, and callers must
  // not be able to mutate the provider's shared info.cube through the result.
  return [...Bounds.stepTo(cube, Key.parse(key))] as Bounds;
}

/**
 * The 3D Tiles geometric error for a node: the point spacing at its depth. COPC
 * point spacing halves each octree level, so depth `d` resolves to
 * `rootSpacingMetres / 2^d`. `rootSpacingMetres` must be `copc.info.spacing`
 * converted to **metres** (see {@link horizontalMetresPerUnit}) because Cesium
 * geometric error is metric. This drives screen-space-error LOD refinement.
 */
export function geometricError(rootSpacingMetres: number, key: string): number {
  const depth = Key.parse(key)[0];
  return rootSpacingMetres / 2 ** depth;
}

const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Metres per horizontal CRS unit, measured empirically at the dataset centre by
 * reprojecting a small step and taking the ECEF distance. Works for projected
 * (feet/metres) and geographic (degrees) CRSs alike. Multiply `copc.info.spacing`
 * by this to get a metric geometric error.
 */
export function horizontalMetresPerUnit(reprojector: Reprojector, cube: Bounds): number {
  const [minX, minY, minZ, maxX, maxY, maxZ] = cube;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = maxX - minX;
  const step = span > 0 ? span * 1e-3 : 1;
  const a = reprojector.toEcef(cx, cy, cz);
  const b = reprojector.toEcef(cx + step, cy, cz);
  return distance(a, b) / step;
}

const isFinite3 = (c: Vec3): boolean =>
  Number.isFinite(c[0]) && Number.isFinite(c[1]) && Number.isFinite(c[2]);

/**
 * A 3×3×3 grid of ECEF sample points across `bounds` (corners, edge midpoints,
 * face centres, centre). Sampling more than the 8 corners keeps the bounding
 * sphere from under-enclosing a large box whose faces bulge outward with Earth
 * curvature. Non-finite reprojections (out-of-domain) are dropped.
 */
function ecefSamples(reprojector: Reprojector, bounds: Bounds): Vec3[] {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  const xs = [minX, (minX + maxX) / 2, maxX];
  const ys = [minY, (minY + maxY) / 2, maxY];
  const zs = [minZ, (minZ + maxZ) / 2, maxZ];
  const samples: Vec3[] = [];
  for (const x of xs) {
    for (const y of ys) {
      for (const z of zs) {
        const p = reprojector.toEcef(x, y, z);
        if (isFinite3(p)) samples.push(p);
      }
    }
  }
  return samples;
}

/**
 * ECEF bounding sphere enclosing `bounds` (a source-CRS AABB): centroid of the
 * samples, radius = farthest sample. Always encloses the samples.
 */
export function boundsBoundingSphere(reprojector: Reprojector, bounds: Bounds): Sphere {
  const samples = ecefSamples(reprojector, bounds);
  if (samples.length === 0) {
    throw new Error("copc-tileset: could not reproject bounds to ECEF (CRS domain?)");
  }
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const [x, y, z] of samples) {
    cx += x;
    cy += y;
    cz += z;
  }
  const center: Vec3 = [cx / samples.length, cy / samples.length, cz / samples.length];
  let radius = 0;
  for (const sample of samples) radius = Math.max(radius, distance(center, sample));
  return { center, radius };
}

/** ECEF bounding sphere of the whole dataset (the root cube). */
export function datasetBoundingSphere(reprojector: Reprojector, cube: Bounds): Sphere {
  return boundsBoundingSphere(reprojector, cube);
}

/** ECEF bounding sphere of a single octree node. */
export function nodeBoundingSphere(reprojector: Reprojector, cube: Bounds, key: string): Sphere {
  return boundsBoundingSphere(reprojector, nodeBounds(cube, key));
}
