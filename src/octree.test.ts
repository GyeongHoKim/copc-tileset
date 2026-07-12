import { Cartesian3 } from "cesium";
import type { Bounds } from "copc";
import { describe, expect, it } from "vitest";
import {
  datasetBoundingSphere,
  geometricError,
  horizontalMetresPerUnit,
  nodeBoundingSphere,
  nodeBounds,
} from "./octree";
import { createReprojector } from "./reproject";

// A small cube expressed in WGS84 lon/lat/height so the identity reprojector maps
// it straight onto the globe near Autzen, Oregon.
const CUBE: Bounds = [-123.1, 44.0, 0, -123.0, 44.1, 100];
const identity = createReprojector();

describe("nodeBounds", () => {
  it("returns the whole cube for the root key", () => {
    expect(nodeBounds(CUBE, "0-0-0-0")).toEqual(CUBE);
  });

  it("returns a copy for the root key (never aliases the input cube)", () => {
    const result = nodeBounds(CUBE, "0-0-0-0");
    expect(result).not.toBe(CUBE);
    result[0] = 999;
    expect(CUBE[0]).toBe(-123.1); // input untouched
  });

  it("subdivides into octants at depth 1", () => {
    const lowerX = nodeBounds(CUBE, "1-0-0-0");
    const upperX = nodeBounds(CUBE, "1-1-0-0");
    // Each depth-1 node spans half the cube in every axis.
    expect(lowerX[3] - lowerX[0]).toBeCloseTo(0.05, 9); // half of 0.1 lon
    expect(lowerX[0]).toBeCloseTo(-123.1, 9);
    expect(upperX[0]).toBeCloseTo(-123.05, 9);
  });
});

describe("geometricError", () => {
  it("is the root spacing at depth 0 and halves each level", () => {
    expect(geometricError(2, "0-0-0-0")).toBe(2);
    expect(geometricError(2, "1-0-0-0")).toBe(1);
    expect(geometricError(2, "3-1-2-3")).toBe(0.25);
  });
});

describe("bounding spheres", () => {
  it("places the dataset sphere on the WGS84 ellipsoid", () => {
    const bs = datasetBoundingSphere(identity, CUBE);
    const centerMagnitude = Cartesian3.magnitude(bs.center);
    expect(centerMagnitude).toBeGreaterThan(6.2e6);
    expect(centerMagnitude).toBeLessThan(6.6e6);
    expect(bs.radius).toBeGreaterThan(0);
  });

  it("gives a child node a sphere no larger than the dataset", () => {
    const dataset = datasetBoundingSphere(identity, CUBE);
    const child = nodeBoundingSphere(identity, CUBE, "1-0-0-0");
    expect(child.radius).toBeLessThanOrEqual(dataset.radius + 1e-6);
  });
});

describe("horizontalMetresPerUnit", () => {
  it("converts degrees to metres near the given latitude", () => {
    // At lat ~44°, one degree of longitude is ~80 km. The identity reprojector
    // treats CUBE's X/Y as lon/lat degrees, so metres-per-unit ~= metres-per-degree.
    const mpu = horizontalMetresPerUnit(identity, CUBE);
    expect(mpu).toBeGreaterThan(70000);
    expect(mpu).toBeLessThan(90000);
  });
});
