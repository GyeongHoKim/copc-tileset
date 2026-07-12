import { Bounds, Copc, Key } from "copc";
import { describe, expect, it } from "vitest";
import { createReprojector } from "./reproject";

// Verifies the full browser-equivalent read path against real COPC data over
// HTTP range requests: header/info parse, hierarchy walk, laz-perf decode of a
// node's points, and reprojection landing in the right place on Earth.
//
// copc.js uses `cross-fetch`, so this runs headlessly in Node exactly as it
// would in a browser. laz-perf (WASM) is instantiated by loadPointDataView.
const AUTZEN = "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz";

describe("read real autzen COPC over HTTP range", () => {
  it("parses the header, decodes the root node, and reprojects into Oregon", async () => {
    const copc = await Copc.create(AUTZEN);

    // Header / info sanity.
    expect(copc.header.pointCount).toBeGreaterThan(0);
    expect(copc.info.spacing).toBeGreaterThan(0);
    expect(Bounds.width(copc.info.cube)).toBeGreaterThan(0);
    expect(typeof copc.wkt === "string" && copc.wkt.length > 0).toBe(true);

    // Hierarchy: the root page must contain the root node "0-0-0-0".
    const { nodes } = await Copc.loadHierarchyPage(AUTZEN, copc.info.rootHierarchyPage);
    const root = nodes["0-0-0-0"];
    expect(root).toBeDefined();
    if (!root) return;
    expect(root.pointCount).toBeGreaterThan(0);

    // Decode the root node's points (laz-perf) and read world-space XYZ.
    const view = await Copc.loadPointDataView(AUTZEN, copc, root, {
      include: ["X", "Y", "Z"],
    });
    expect(view.pointCount).toBe(root.pointCount);
    const getX = view.getter("X");
    const getY = view.getter("Y");
    const getZ = view.getter("Z");

    // First point must fall within the file's declared bounds.
    const [minX, minY, , maxX, maxY] = copc.info.cube;
    const x = getX(0);
    const y = getY(0);
    expect(x).toBeGreaterThanOrEqual(minX);
    expect(x).toBeLessThanOrEqual(maxX);
    expect(y).toBeGreaterThanOrEqual(minY);
    expect(y).toBeLessThanOrEqual(maxY);

    // Reproject that point and assert it lands near Autzen Stadium, Oregon.
    const reprojector = createReprojector(copc.wkt);
    const [lon, lat] = reprojector.toLonLatHeight(x, y, getZ(0));
    expect(lon).toBeGreaterThan(-124);
    expect(lon).toBeLessThan(-122);
    expect(lat).toBeGreaterThan(43);
    expect(lat).toBeLessThan(45);

    // Node key parsing helper works as documented.
    expect(Key.toString(Key.parse("0-0-0-0"))).toBe("0-0-0-0");
  });
});
