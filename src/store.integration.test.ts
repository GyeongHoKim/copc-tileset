import { describe, expect, it } from "vitest";
import { CopcProvider } from "./CopcProvider";
import { CopcTileStore } from "./copcTileStore";

const AUTZEN = "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz";

describe("CopcTileStore against real autzen COPC", () => {
  it("builds a root tileset and decodes its root node into a pnts tile", async () => {
    const provider = await CopcProvider.fromUrl(AUTZEN);
    const store = new CopcTileStore(provider);

    const tileset = await store.tileset("0-0-0-0");
    expect(tileset.asset.version).toBe("1.1");
    expect(tileset.root.content.uri).toBe("0-0-0-0.pnts");
    expect(tileset.root.geometricError).toBeGreaterThan(0);
    const [cx, cy, cz, radius] = tileset.root.boundingVolume.sphere;
    expect(Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz)).toBe(true);
    expect(radius).toBeGreaterThan(0);

    // The root node's page is now cached, so its pnts can be built.
    const pnts = await store.pnts("0-0-0-0");
    const magic = String.fromCharCode(
      pnts[0] as number,
      pnts[1] as number,
      pnts[2] as number,
      pnts[3] as number,
    );
    expect(magic).toBe("pnts");

    const dv = new DataView(pnts.buffer, pnts.byteOffset, pnts.byteLength);
    const featureTableJsonLength = dv.getUint32(12, true);
    const featureTable = JSON.parse(
      new TextDecoder().decode(pnts.subarray(28, 28 + featureTableJsonLength)),
    );
    expect(featureTable.POINTS_LENGTH).toBeGreaterThan(0);
    expect(featureTable.RTC_CENTER).toHaveLength(3);
    // RTC centre is a real ECEF location near Autzen.
    expect(Math.hypot(...(featureTable.RTC_CENTER as number[]))).toBeGreaterThan(6.2e6);
  });

  it("serves a non-root node on a fresh store (self-heals from the root)", async () => {
    const provider = await CopcProvider.fromUrl(AUTZEN);
    const { nodes } = await provider.loadHierarchyPage();
    const deepKey = Object.keys(nodes).find((k) => !k.startsWith("0-"));
    expect(deepKey).toBeDefined();

    // A brand-new store with no prior tileset() call must still resolve the node
    // by walking hierarchy pages from the root.
    const store = new CopcTileStore(provider);
    const pnts = await store.pnts(deepKey as string);
    const magic = String.fromCharCode(
      pnts[0] as number,
      pnts[1] as number,
      pnts[2] as number,
      pnts[3] as number,
    );
    expect(magic).toBe("pnts");
  });
});
