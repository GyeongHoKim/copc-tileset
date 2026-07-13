import { describe, expect, it } from "vitest";
import { createReprojector } from "./reproject";

describe("createReprojector", () => {
  it("round-trips a WGS84 point through Web Mercator (EPSG:3857)", () => {
    // Autzen Stadium, Oregon.
    const lon = -123.0744;
    const lat = 44.043;
    // Forward to Web Mercator using the same library, then reproject back.
    const mercator = createReprojectorFixture3857ToWgs84();
    const [x, y] = mercator.wgs84ToMercator(lon, lat);
    const [gotLon, gotLat] = mercator.reprojector.toLonLatHeight(x, y, 0);
    expect(gotLon).toBeCloseTo(lon, 6);
    expect(gotLat).toBeCloseTo(lat, 6);
  });

  it("treats empty wkt as already-WGS84 (identity horizontal transform)", () => {
    const r = createReprojector();
    const [lon, lat, h] = r.toLonLatHeight(-123.0744, 44.043, 137);
    expect(lon).toBeCloseTo(-123.0744, 9);
    expect(lat).toBeCloseTo(44.043, 9);
    expect(h).toBe(137);
  });

  it("produces an ECEF position on the WGS84 ellipsoid surface", () => {
    const r = createReprojector();
    const ecef = r.toEcef(0, 0, 0); // lon0/lat0 -> equator/prime meridian
    // WGS84 equatorial radius ~6378137 m.
    expect(ecef[0]).toBeCloseTo(6378137, 0);
    expect(ecef[1] ?? 0).toBeCloseTo(0, 3);
    expect(ecef[2] ?? 0).toBeCloseTo(0, 3);
  });
});

// Helper that builds an EPSG:3857 -> WGS84 reprojector plus a forward transform
// for the test fixture, using proj4's built-in definitions.
function createReprojectorFixture3857ToWgs84() {
  // proj4 ships EPSG:4326 and EPSG:3857 definitions out of the box.
  const reprojector = createReprojector("EPSG:3857");
  return {
    reprojector,
    wgs84ToMercator(lon: number, lat: number): [number, number] {
      // Standard spherical Web Mercator forward projection (radius 6378137).
      const R = 6378137;
      const x = (lon * Math.PI * R) / 180;
      const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      return [x, y];
    },
  };
}
