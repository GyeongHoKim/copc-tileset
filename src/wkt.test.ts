import proj4 from "proj4";
import { describe, expect, it } from "vitest";
import { createReprojector } from "./reproject";
import { horizontalWkt, verticalUnitToMetres } from "./wkt";

// Real autzen-classified.copc.laz WKT: a compound CRS (Oregon GIC Lambert in feet
// + NAVD88 height in US survey feet). This is the exact string proj4 cannot parse
// directly, which is why horizontalWkt/verticalUnitToMetres exist.
const AUTZEN_WKT =
  'COMPD_CS["NAD83 / Oregon GIC Lambert (ft) + NAVD88 height (ftUS)",' +
  'PROJCS["NAD83 / Oregon GIC Lambert (ft)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",' +
  'SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6269"]],' +
  'PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,' +
  'AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4269"]],PROJECTION["Lambert_Conformal_Conic_2SP"],' +
  'PARAMETER["latitude_of_origin",41.75],PARAMETER["central_meridian",-120.5],' +
  'PARAMETER["standard_parallel_1",43],PARAMETER["standard_parallel_2",45.5],' +
  'PARAMETER["false_easting",1312335.958],PARAMETER["false_northing",0],' +
  'UNIT["foot",0.3048,AUTHORITY["EPSG","9002"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],' +
  'AUTHORITY["EPSG","2992"]],VERT_CS["NAVD88 height (ftUS)",VERT_DATUM["North American Vertical ' +
  'Datum 1988",2005,AUTHORITY["EPSG","5103"]],UNIT["US survey foot",0.304800609601219,' +
  'AUTHORITY["EPSG","9003"]],AXIS["Gravity-related height",UP],AUTHORITY["EPSG","6360"]]]';

describe("horizontalWkt", () => {
  it("extracts the inner PROJCS from a compound CRS", () => {
    const h = horizontalWkt(AUTZEN_WKT);
    expect(h.startsWith("PROJCS[")).toBe(true);
    expect(h).toContain('AUTHORITY["EPSG","2992"]');
    // Must NOT contain the vertical CRS.
    expect(h).not.toContain("VERT_CS");
    // Brackets must be balanced.
    expect(count(h, "[")).toBe(count(h, "]"));
  });

  it("returns a non-compound WKT unchanged", () => {
    const plain = 'GEOGCS["WGS 84",AUTHORITY["EPSG","4326"]]';
    expect(horizontalWkt(plain)).toBe(plain);
  });

  it("does not miscount brackets inside a quoted CRS name", () => {
    const wkt =
      'COMPD_CS["x",PROJCS["State Plane [ftUS] zone",UNIT["foot",0.3048]],' +
      'VERT_CS["h",UNIT["metre",1]]]';
    const h = horizontalWkt(wkt);
    expect(h.startsWith('PROJCS["State Plane [ftUS] zone"')).toBe(true);
    expect(h.endsWith("]")).toBe(true);
    expect(h).not.toContain("VERT_CS");
  });
});

describe("verticalUnitToMetres", () => {
  it("reads the US-survey-foot vertical unit from the compound CRS", () => {
    expect(verticalUnitToMetres(AUTZEN_WKT)).toBeCloseTo(0.304800609601219, 12);
  });

  it("falls back to the projected linear unit when no VERT_CS is present", () => {
    const projOnly = horizontalWkt(AUTZEN_WKT); // PROJCS in international feet
    expect(verticalUnitToMetres(projOnly)).toBeCloseTo(0.3048, 6);
  });

  it("defaults to 1 (metres) for a geographic CRS", () => {
    expect(verticalUnitToMetres('GEOGCS["WGS 84",AUTHORITY["EPSG","4326"]]')).toBe(1);
  });

  it("ignores the nested GEOGCS angular unit when reading the projected linear unit", () => {
    // PROJCS whose only inner UNIT tokens are the angular degree unit (in GEOGCS)
    // and the projected metre unit. Must return the metre unit, never ~0.0174.
    const projcs =
      'PROJCS["p",GEOGCS["g",UNIT["degree",0.0174532925199433]],' +
      'PROJECTION["Transverse_Mercator"],UNIT["metre",1]]';
    expect(verticalUnitToMetres(projcs)).toBe(1);
  });

  it("defaults to 1 when a projected CRS omits an explicit linear unit", () => {
    // Only the nested angular unit exists — must NOT be treated as a linear factor.
    const projcs = 'PROJCS["p",GEOGCS["g",UNIT["degree",0.0174532925199433]],' + 'PROJECTION["x"]]';
    expect(verticalUnitToMetres(projcs)).toBe(1);
  });
});

describe("createReprojector with the autzen compound CRS", () => {
  it("parses via the horizontal CRS and scales Z feet->metres", () => {
    // Forward-project Autzen Stadium (lon/lat) into the file's horizontal CRS to
    // get realistic easting/northing (feet), then reproject back — a round-trip.
    const lon0 = -123.0744;
    const lat0 = 44.043;
    const [eastingFt, northingFt] = proj4("EPSG:4326", horizontalWkt(AUTZEN_WKT)).forward([
      lon0,
      lat0,
    ]);

    const r = createReprojector(AUTZEN_WKT);
    const [lon, lat, height] = r.toLonLatHeight(eastingFt, northingFt, 400);
    expect(lon).toBeCloseTo(lon0, 5);
    expect(lat).toBeCloseTo(lat0, 5);
    // 400 ftUS -> ~121.9 m, NOT left as 400.
    expect(height).toBeCloseTo(400 * 0.304800609601219, 6);
  });
});

function count(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}
