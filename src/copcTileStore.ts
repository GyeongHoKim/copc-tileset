import { type Hierarchy, Key } from "copc";
import type { CopcProvider } from "./CopcProvider";
import { horizontalMetresPerUnit } from "./octree";
import { buildNodePnts, detectColorShift } from "./pnts";
import { buildTileset, type Tileset, type TilesetUris } from "./tileset";

/** Dimensions read for rendering. Classification/Intensity/GpsTime are added for picking (M4). */
const RENDER_DIMENSIONS = ["X", "Y", "Z", "Red", "Green", "Blue"];
const ROOT_KEY = "0-0-0-0";

const uris: TilesetUris = {
  content: (key) => `${key}.pnts`,
  subtree: (key) => `${key}.json`,
};

const depthOf = (key: string): number => Key.parse(key)[0];

/** Whether `ancestor` is `descendant` or one of its octree ancestors. */
function isAncestorOrEqual(ancestor: string, descendant: string): boolean {
  const a = depthOf(ancestor);
  const d = depthOf(descendant);
  if (a > d) return false;
  return Key.toString(Key.up(Key.parse(descendant), d - a)) === ancestor;
}

/**
 * Turns a {@link CopcProvider} into 3D Tiles content on demand: builds tileset
 * JSON for a hierarchy page and `.pnts` for a node.
 *
 * Requests are self-healing: any key resolves by walking hierarchy pages down
 * from the root, so a request for a deep tile works even on a fresh store (e.g.
 * after a Service Worker restart) without the root having been fetched first.
 * Loaded pages are cached (promises, so concurrent requests de-duplicate).
 *
 * Note: caches grow for the store's lifetime; view-based eviction / a memory
 * budget is added in M3 (GYE-259). One store per COPC source.
 */
export class CopcTileStore {
  private readonly subtrees = new Map<string, Promise<Hierarchy.Subtree>>();
  private readonly nodes = new Map<string, Hierarchy.Node>();
  private readonly pages = new Map<string, Hierarchy.Page>();
  private readonly rootSpacingMetres: number;
  private colorShift?: number;

  constructor(private readonly provider: CopcProvider) {
    const { info } = provider.copc;
    this.rootSpacingMetres =
      info.spacing * horizontalMetresPerUnit(provider.reprojector, info.cube);
  }

  /** Builds the tileset JSON rooted at `key` (`"0-0-0-0"` for the whole dataset). */
  async tileset(key: string): Promise<Tileset> {
    await this.walkTo(key, () => this.subtrees.has(key));
    const pending = this.subtrees.get(key);
    if (!pending) {
      throw new Error(`copc-tileset: could not resolve a hierarchy page for key "${key}"`);
    }
    const subtree = await pending;
    return buildTileset({
      subtree,
      rootKey: key,
      cube: this.provider.copc.info.cube,
      rootSpacingMetres: this.rootSpacingMetres,
      reprojector: this.provider.reprojector,
      uris,
    });
  }

  /** Builds the `.pnts` content for node `key`. */
  async pnts(key: string): Promise<Uint8Array> {
    await this.walkTo(key, () => this.nodes.has(key));
    const node = this.nodes.get(key);
    if (!node) {
      throw new Error(`copc-tileset: node "${key}" not found in the COPC hierarchy`);
    }
    const view = await this.provider.loadPointDataView(node, RENDER_DIMENSIONS);
    // Colour bit depth is a per-file property: detect once, reuse for every node.
    if (
      this.colorShift === undefined &&
      view.dimensions.Red &&
      view.dimensions.Green &&
      view.dimensions.Blue
    ) {
      this.colorShift = detectColorShift(view);
    }
    return buildNodePnts(view, this.provider.reprojector, { colorShift: this.colorShift });
  }

  /** Expands a hierarchy page, caching its subtree, nodes and child-page refs. */
  private expand(pageKey: string, page: Hierarchy.Page): Promise<Hierarchy.Subtree> {
    let pending = this.subtrees.get(pageKey);
    if (!pending) {
      pending = this.provider.loadHierarchyPage(page).then((subtree) => {
        for (const [k, node] of Object.entries(subtree.nodes)) if (node) this.nodes.set(k, node);
        for (const [k, childPage] of Object.entries(subtree.pages)) {
          if (childPage) this.pages.set(k, childPage);
        }
        return subtree;
      });
      this.subtrees.set(pageKey, pending);
    }
    return pending;
  }

  /** Loads pages from the root toward `target` until `done()` holds (or no page remains). */
  private async walkTo(target: string, done: () => boolean): Promise<void> {
    if (!this.subtrees.has(ROOT_KEY)) {
      await this.expand(ROOT_KEY, this.provider.copc.info.rootHierarchyPage);
    }
    for (let guard = 0; !done() && guard <= 64; guard++) {
      const next = this.nextPageToward(target);
      if (!next) return;
      await this.expand(next.key, next.page);
    }
  }

  /** The deepest not-yet-expanded page that is an ancestor (or equal) of `target`. */
  private nextPageToward(target: string): { key: string; page: Hierarchy.Page } | undefined {
    let best: { key: string; page: Hierarchy.Page; depth: number } | undefined;
    for (const [key, page] of this.pages) {
      if (this.subtrees.has(key) || !isAncestorOrEqual(key, target)) continue;
      const depth = depthOf(key);
      if (!best || depth > best.depth) best = { key, page, depth };
    }
    return best && { key: best.key, page: best.page };
  }
}
