import { Cartesian3 } from "cesium";
import proj4 from "proj4";
import { horizontalWkt, verticalUnitToMetres } from "./wkt";

/** WGS84 geographic coordinates (EPSG:4326), the target of every reprojection. */
const WGS84 = "EPSG:4326";

export interface Reprojector {
  /**
   * Transforms a point from the source CRS to WGS84 `[lonDeg, latDeg, height]`.
   * Z is scaled into metres using the CRS's vertical unit (see {@link createReprojector}).
   * For points outside the projection's valid domain proj4 may return non-finite
   * lon/lat — batch callers should filter those before rendering.
   */
  toLonLatHeight(x: number, y: number, z: number): [number, number, number];
  /**
   * Transforms a source-CRS point to an ECEF {@link Cartesian3} (Cesium's render
   * frame). May be non-finite for out-of-domain input; see {@link Reprojector.toLonLatHeight}.
   */
  toEcef(x: number, y: number, z: number, result?: Cartesian3): Cartesian3;
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

  function toEcef(x: number, y: number, z: number, result?: Cartesian3): Cartesian3 {
    const [lon, lat, height] = toLonLatHeight(x, y, z);
    return Cartesian3.fromDegrees(lon, lat, height, undefined, result);
  }

  return { toLonLatHeight, toEcef };
}
