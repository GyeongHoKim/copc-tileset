import proj4 from "proj4";
import { horizontalWkt, verticalUnitToMetres } from "./wkt";

/** WGS84 geographic coordinates (EPSG:4326), the target of every reprojection. */
const WGS84 = "EPSG:4326";

// WGS84 ellipsoid constants (identical to Cesium's default ellipsoid), so ECEF
// output matches Cesium.Cartesian3.fromDegrees. Computed here rather than via
// Cesium so this module stays dependency-free and runs inside the Service Worker.
const A = 6378137.0; // semi-major axis (m)
const F = 1 / 298.257223563; // flattening
const E2 = F * (2 - F); // first eccentricity squared
const DEG2RAD = Math.PI / 180;

/** An ECEF (Earth-centred, Earth-fixed) position `[x, y, z]` in metres. */
export type Vec3 = [number, number, number];

export interface Reprojector {
  /**
   * Transforms a point from the source CRS to WGS84 `[lonDeg, latDeg, height]`.
   * Z is scaled into metres using the CRS's vertical unit (see {@link createReprojector}).
   * For points outside the projection's valid domain proj4 may return non-finite
   * lon/lat — batch callers should filter those before rendering.
   */
  toLonLatHeight(x: number, y: number, z: number): [number, number, number];
  /**
   * Transforms a source-CRS point to an ECEF position. Pass `out` (a length-3
   * array) to avoid allocation in hot loops. May be non-finite for out-of-domain
   * input; see {@link Reprojector.toLonLatHeight}.
   */
  toEcef(x: number, y: number, z: number, out?: Vec3): Vec3;
}

/**
 * Builds a reprojector from a COPC file's `wkt` (its CRS). COPC point coordinates
 * live in this CRS, but Cesium renders in Earth-centred ECEF, so every point must
 * be reprojected. Compound CRSs are split: proj4 handles the horizontal part and Z
 * is scaled from the vertical (or projected linear) unit into metres.
 *
 * When `wkt` is empty the data is **assumed to already be WGS84 lon/lat degrees**;
 * pass the file's `wkt` for any projected data or coordinates will be wrong.
 */
export function createReprojector(wkt?: string): Reprojector {
  const hasWkt = !!wkt && wkt.trim().length > 0;
  const source = hasWkt ? horizontalWkt(wkt as string) : WGS84;
  const zToMetres = hasWkt ? verticalUnitToMetres(wkt as string) : 1;

  let converter: proj4.Converter;
  try {
    converter = proj4(source, WGS84);
  } catch (cause) {
    throw new Error("copc-tileset: could not parse the COPC CRS (wkt) with proj4", { cause });
  }

  function toLonLatHeight(x: number, y: number, z: number): [number, number, number] {
    const [lon, lat] = converter.forward([x, y]);
    return [lon, lat, z * zToMetres];
  }

  function toEcef(x: number, y: number, z: number, out: Vec3 = [0, 0, 0]): Vec3 {
    const [lon, lat, height] = toLonLatHeight(x, y, z);
    const lonR = lon * DEG2RAD;
    const latR = lat * DEG2RAD;
    const sinLat = Math.sin(latR);
    const cosLat = Math.cos(latR);
    const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
    out[0] = (n + height) * cosLat * Math.cos(lonR);
    out[1] = (n + height) * cosLat * Math.sin(lonR);
    out[2] = (n * (1 - E2) + height) * sinLat;
    return out;
  }

  return { toLonLatHeight, toEcef };
}
