import { describe, expect, it } from "vitest";
import { CopcProvider } from "./CopcProvider";

const AUTZEN = "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz";

describe("CopcProvider against real autzen COPC", () => {
  it("loads header, hierarchy, points, and a valid dataset bounding sphere", async () => {
    const provider = await CopcProvider.fromUrl(AUTZEN);

    expect(provider.copc.header.pointCount).toBeGreaterThan(0);
    expect(provider.copc.info.spacing).toBeGreaterThan(0);

    // Root hierarchy page contains the root node.
    const { nodes } = await provider.loadHierarchyPage();
    const root = nodes["0-0-0-0"];
    expect(root).toBeDefined();
    if (!root) return;

    // Dataset bounding sphere sits on the globe near Autzen.
    const bs = provider.boundingSphere;
    const centerMagnitude = Math.hypot(...bs.center);
    expect(centerMagnitude).toBeGreaterThan(6.2e6);
    expect(centerMagnitude).toBeLessThan(6.6e6);
    expect(bs.radius).toBeGreaterThan(0);

    // Node points decode and match the declared count.
    const view = await provider.loadPointDataView(root, ["X", "Y", "Z"]);
    expect(view.pointCount).toBe(root.pointCount);
  });
});
