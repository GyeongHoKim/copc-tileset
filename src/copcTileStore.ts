import { type Hierarchy, Key } from "copc";
import type { CopcProvider } from "./CopcProvider";
import { horizontalMetresPerUnit } from "./octree";
import { buildNodePnts, detectColorShift } from "./pnts";
import { buildTileset, type Tileset, type TilesetUris } from "./tileset";

/** Dimensions read per node: position, colour, and per-point attributes for picking/shaders. */
const RENDER_DIMENSIONS = [
  "X",
  "Y",
  "Z",
  "Red",
  "Green",
  "Blue",
  "Classification",
  "Intensity",
  "GpsTime",
];
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

/** Octree keys on the path from `key` up to the root, `[key, ..., root]`. */
function ancestorPathKeys(key: string): string[] {
  const keys: string[] = [];
  let current = Key.parse(key);
  keys.push(Key.toString(current));
  while (current[0] > 0) {
    current = Key.up(current);
    keys.push(Key.toString(current));
  }
  return keys;
}

export interface CopcTileStoreOptions {
  /**
   * Target number of expanded hierarchy pages to keep cached. After each request
   * the least-recently-used pages beyond this (never the root or the pages on the
   * current request path) are evicted; because requests are self-healing an
   * evicted page is transparently re-loaded when next needed. Defaults to 256.
   */
  maxCachedPages?: number;
}

/**
 * Turns a {@link CopcProvider} into 3D Tiles content on demand: builds tileset
 * JSON for a hierarchy page and `.pnts` for a node.
 *
 * Requests are self-healing: any key resolves by walking hierarchy pages down
 * from the root, so a request for a deep tile works even on a fresh store (e.g.
 * after a Service Worker restart) without the root having been fetched first.
 * Loaded pages are cached (promises, so concurrent requests de-duplicate) with
 * LRU eviction — run only after a request completes, so it never disturbs an
 * in-progress walk or an in-flight load — that prunes cached subtrees, nodes and
 * child-page refs together. The heavy point data itself is streamed and its GPU
 * memory is managed by Cesium's 3D Tiles engine; laz-perf decoding runs in the
 * Service Worker thread, off the main UI thread. One store per COPC source.
 */
export class CopcTileStore {
  private readonly subtrees = new Map<string, Promise<Hierarchy.Subtree>>();
  private readonly resolved = new Set<string>();
  private readonly nodes = new Map<string, Hierarchy.Node>();
  private readonly pages = new Map<string, Hierarchy.Page>();
  private readonly contributed = new Map<string, { nodeKeys: string[]; pageKeys: string[] }>();
  private readonly rootSpacingMetres: number;
  private readonly maxCachedPages: number;
  private colorShift?: number;

  constructor(
    private readonly provider: CopcProvider,
    options: CopcTileStoreOptions = {},
  ) {
    const { info } = provider.copc;
    this.rootSpacingMetres =
      info.spacing * horizontalMetresPerUnit(provider.reprojector, info.cube);
    this.maxCachedPages = Math.max(2, options.maxCachedPages ?? 256);
  }

  /** Builds the tileset JSON rooted at `key` (`"0-0-0-0"` for the whole dataset). */
  async tileset(key: string): Promise<Tileset> {
    await this.walkTo(key, () => this.subtrees.has(key));
    const pending = this.subtrees.get(key);
    if (!pending) {
      throw new Error(`copc-tileset: could not resolve a hierarchy page for key "${key}"`);
    }
    const subtree = await pending;
    const tileset = buildTileset({
      subtree,
      rootKey: key,
      cube: this.provider.copc.info.cube,
      rootSpacingMetres: this.rootSpacingMetres,
      reprojector: this.provider.reprojector,
      uris,
    });
    this.afterAccess(key);
    return tileset;
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
    const pnts = buildNodePnts(view, this.provider.reprojector, { colorShift: this.colorShift });
    this.afterAccess(key);
    return pnts;
  }

  /** Expands a hierarchy page, caching its subtree, nodes and child-page refs. */
  private expand(pageKey: string, page: Hierarchy.Page): Promise<Hierarchy.Subtree> {
    const cached = this.subtrees.get(pageKey);
    if (cached) return cached;
    const pending = this.provider.loadHierarchyPage(page).then((subtree) => {
      const nodeKeys: string[] = [];
      const pageKeys: string[] = [];
      for (const [k, node] of Object.entries(subtree.nodes)) {
        if (node) {
          this.nodes.set(k, node);
          nodeKeys.push(k);
        }
      }
      for (const [k, childPage] of Object.entries(subtree.pages)) {
        if (childPage) {
          this.pages.set(k, childPage);
          pageKeys.push(k);
        }
      }
      this.contributed.set(pageKey, { nodeKeys, pageKeys });
      this.resolved.add(pageKey);
      return subtree;
    });
    this.subtrees.set(pageKey, pending);
    return pending;
  }

  /** Loads pages from the root toward `target` until `done()` holds (no eviction here). */
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

  /** Marks the request path most-recently-used, then evicts down to the cap. */
  private afterAccess(key: string): void {
    const path = ancestorPathKeys(key);
    for (let i = path.length - 1; i >= 0; i--) this.touch(path[i] as string);
    this.evictIfNeeded(new Set(path));
  }

  /** Moves a cached page to the most-recently-used end of the LRU order. */
  private touch(pageKey: string): void {
    const pending = this.subtrees.get(pageKey);
    if (pending) {
      this.subtrees.delete(pageKey);
      this.subtrees.set(pageKey, pending);
    }
  }

  /** Evicts least-recently-used resolved pages (never the root or a protected path key). */
  private evictIfNeeded(protectedKeys: Set<string>): void {
    for (const key of [...this.subtrees.keys()]) {
      if (this.subtrees.size <= this.maxCachedPages) break;
      if (key === ROOT_KEY || protectedKeys.has(key) || !this.resolved.has(key)) continue;
      this.subtrees.delete(key);
      this.resolved.delete(key);
      const contributed = this.contributed.get(key);
      if (contributed) {
        for (const nodeKey of contributed.nodeKeys) this.nodes.delete(nodeKey);
        for (const pageKey of contributed.pageKeys) this.pages.delete(pageKey);
        this.contributed.delete(key);
      }
    }
  }
}
