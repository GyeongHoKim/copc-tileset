import { BoundingSphere, Cartesian3 } from "cesium";
// `Bounds` is both a type and a namespace of helpers in copc, so import it as a value.
import { Bounds, Key } from "copc";
import type { Reprojector } from "./reproject";

// COPC data is a full octree: a node's key is `depth-x-y-z`, and its cubic bounds
// are a subdivision of the file's root cube. These helpers turn that octree into
// the geometry a 3D Tiles tile needs — bounding volume and geometric error.

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
  return Cartesian3.distance(a, b) / step;
}

function isFinite3(c: Cartesian3): boolean {
  return Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z);
}

/**
 * A 3×3×3 grid of ECEF sample points across `bounds` (corners, edge midpoints,
 * face centres, centre). Sampling more than the 8 corners keeps the bounding
 * sphere from under-enclosing a large box whose faces bulge outward with Earth
 * curvature. Non-finite reprojections (out-of-domain) are dropped.
 */
function ecefSamples(reprojector: Reprojector, bounds: Bounds): Cartesian3[] {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds;
  const xs = [minX, (minX + maxX) / 2, maxX];
  const ys = [minY, (minY + maxY) / 2, maxY];
  const zs = [minZ, (minZ + maxZ) / 2, maxZ];
  const samples: Cartesian3[] = [];
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

/** ECEF bounding sphere enclosing `bounds` (a source-CRS AABB), for Cesium. */
export function boundsBoundingSphere(
  reprojector: Reprojector,
  bounds: Bounds,
  result?: BoundingSphere,
): BoundingSphere {
  const samples = ecefSamples(reprojector, bounds);
  if (samples.length === 0) {
    throw new Error("copc-tileset: could not reproject bounds to ECEF (CRS domain?)");
  }
  return BoundingSphere.fromPoints(samples, result);
}

/** ECEF bounding sphere of the whole dataset (the root cube). */
export function datasetBoundingSphere(
  reprojector: Reprojector,
  cube: Bounds,
  result?: BoundingSphere,
): BoundingSphere {
  return boundsBoundingSphere(reprojector, cube, result);
}

/** ECEF bounding sphere of a single octree node. */
export function nodeBoundingSphere(
  reprojector: Reprojector,
  cube: Bounds,
  key: string,
  result?: BoundingSphere,
): BoundingSphere {
  return boundsBoundingSphere(reprojector, nodeBounds(cube, key), result);
}
