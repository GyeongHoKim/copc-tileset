import type { Bounds, Hierarchy } from "copc";
import { describe, expect, it } from "vitest";
import { createReprojector } from "./reproject";
import { buildTileset, type Tile } from "./tileset";

const CUBE: Bounds = [-123.1, 44.0, 0, -123.0, 44.1, 100];

const node = (): Hierarchy.Node => ({ pointCount: 100, pointDataOffset: 0, pointDataLength: 10 });
const page = (): Hierarchy.Page => ({ pageOffset: 0, pageLength: 10 });

// Octree: root -> {1-0-0-0 -> 2-0-0-0, 1-1-0-0, and a child PAGE 1-1-1-1}.
const subtree: Hierarchy.Subtree = {
  nodes: {
    "0-0-0-0": node(),
    "1-0-0-0": node(),
    "1-1-0-0": node(),
    "2-0-0-0": node(),
  },
  pages: {
    "1-1-1-1": page(),
  },
};

function build() {
  return buildTileset({
    subtree,
    rootKey: "0-0-0-0",
    cube: CUBE,
    rootSpacingMetres: 4,
    reprojector: createReprojector(),
    uris: { content: (k) => `${k}.pnts`, subtree: (k) => `${k}.json` },
  });
}

const childUris = (tile: Tile) => (tile.children ?? []).map((c) => c.content.uri).sort();

describe("buildTileset", () => {
  it("builds a 3D Tiles root from the COPC hierarchy", () => {
    const ts = build();
    expect(ts.asset.version).toBe("1.1");
    expect(ts.root.refine).toBe("ADD");
    expect(ts.root.content.uri).toBe("0-0-0-0.pnts");
    expect(ts.root.geometricError).toBe(4);
  });

  it("gives the top-level tileset the dataset extent as its geometricError", () => {
    // The tileset's own error (error of rendering nothing) must exceed the root
    // tile's error (root spacing) so Cesium renders the cloud at fit-to-view distance
    // instead of culling it as sub-threshold. It equals the root's bounding radius.
    const ts = build();
    const rootRadius = ts.root.boundingVolume.sphere[3];
    expect(ts.geometricError).toBe(rootRadius);
    expect(ts.geometricError).toBeGreaterThan(ts.root.geometricError);
  });

  it("nests child nodes and links child pages as external tilesets", () => {
    const root = build().root;
    // Root's children: two child nodes (.pnts) + one child page (.json).
    expect(childUris(root)).toEqual(["1-0-0-0.pnts", "1-1-0-0.pnts", "1-1-1-1.json"]);

    const oneZero = root.children?.find((c) => c.content.uri === "1-0-0-0.pnts");
    expect(oneZero?.geometricError).toBe(2); // depth 1 -> spacing/2
    expect(childUris(oneZero as Tile)).toEqual(["2-0-0-0.pnts"]);

    // The child page is a leaf pointing at an external tileset.
    const pageTile = root.children?.find((c) => c.content.uri === "1-1-1-1.json");
    expect(pageTile?.children).toBeUndefined();
  });

  it("gives every tile a finite ECEF bounding sphere", () => {
    const check = (tile: Tile) => {
      const [x, y, z, r] = tile.boundingVolume.sphere;
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
      expect(r).toBeGreaterThan(0);
      for (const child of tile.children ?? []) check(child);
    };
    check(build().root);
  });
});
