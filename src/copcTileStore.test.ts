import type { Bounds, Hierarchy, View } from "copc";
import { describe, expect, it } from "vitest";
import type { CopcProvider } from "./CopcProvider";
import { CopcTileStore } from "./copcTileStore";
import { createReprojector } from "./reproject";

const CUBE: Bounds = [-123.1, 44.0, 0, -123.0, 44.1, 100];
const magic = (p: Uint8Array) =>
  String.fromCharCode(p[0] as number, p[1] as number, p[2] as number, p[3] as number);

// A branching octree:  root -> A(1-0-0-0) -> A2(2-0-0-0)
//                       root -> B(1-1-1-1)
// One page per node, so visiting the two branches needs distinct page loads —
// enough to exercise LRU eviction. Counts hierarchy-page loads.
function branchingProvider() {
  let calls = 0;
  const node = (): Hierarchy.Node => ({ pointCount: 2, pointDataOffset: 0, pointDataLength: 1 });
  const page = (offset: number): Hierarchy.Page => ({ pageOffset: offset, pageLength: 1 });
  const root = page(0);
  const a = page(1);
  const a2 = page(2);
  const b = page(3);
  const subtrees = new Map<Hierarchy.Page, Hierarchy.Subtree>([
    [root, { nodes: { "0-0-0-0": node() }, pages: { "1-0-0-0": a, "1-1-1-1": b } }],
    [a, { nodes: { "1-0-0-0": node() }, pages: { "2-0-0-0": a2 } }],
    [a2, { nodes: { "2-0-0-0": node() }, pages: {} }],
    [b, { nodes: { "1-1-1-1": node() }, pages: {} }],
  ]);
  const columns: Record<string, number[]> = { X: [-123, -123.001], Y: [44, 44.001], Z: [0, 1] };
  const view = {
    pointCount: 2,
    dimensions: { X: {}, Y: {}, Z: {} },
    getter: (name: string) => (i: number) => columns[name]?.[i] ?? 0,
  } as unknown as View;

  const provider = {
    url: "fake://copc",
    copc: { info: { cube: CUBE, spacing: 1, rootHierarchyPage: root } },
    reprojector: createReprojector(),
    loadHierarchyPage: async (p: Hierarchy.Page) => {
      calls++;
      const subtree = subtrees.get(p);
      if (!subtree) throw new Error("unknown page");
      return subtree;
    },
    loadPointDataView: async () => view,
  } as unknown as CopcProvider;

  return { provider, calls: () => calls };
}

describe("CopcTileStore hierarchy walking", () => {
  it("walks pages from the root to reach a deep node", async () => {
    const { provider, calls } = branchingProvider();
    const store = new CopcTileStore(provider);
    const pnts = await store.pnts("2-0-0-0");
    expect(magic(pnts)).toBe("pnts");
    expect(calls()).toBe(3); // root + A + A2
  });

  it("re-loads an evicted page when the cache is full (LRU)", async () => {
    const { provider, calls } = branchingProvider();
    const store = new CopcTileStore(provider, { maxCachedPages: 2 });

    await store.pnts("2-0-0-0"); // root + A + A2
    await store.pnts("1-1-1-1"); // root + B; evicts A/A2 (not on this path)
    const before = calls();

    const pnts = await store.pnts("2-0-0-0"); // A/A2 evicted -> must re-load
    expect(magic(pnts)).toBe("pnts");
    expect(calls()).toBeGreaterThan(before);
  });

  it("keeps pages cached when the cap is generous (no re-load)", async () => {
    const { provider, calls } = branchingProvider();
    const store = new CopcTileStore(provider, { maxCachedPages: 100 });

    await store.pnts("2-0-0-0");
    await store.pnts("1-1-1-1");
    const before = calls();
    await store.pnts("2-0-0-0"); // still cached
    expect(calls()).toBe(before);
  });

  it("never evicts the root page", async () => {
    const { provider, calls } = branchingProvider();
    const store = new CopcTileStore(provider, { maxCachedPages: 2 });
    await store.pnts("2-0-0-0");
    await store.pnts("1-1-1-1");
    const before = calls();
    // Root tileset must not trigger a reload — the root page is never evicted.
    await store.tileset("0-0-0-0");
    expect(calls()).toBe(before);
  });
});
