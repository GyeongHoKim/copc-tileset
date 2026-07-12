import type { BoundingSphere } from "cesium";
import { Copc, Getter, type Hierarchy } from "copc";
import { datasetBoundingSphere } from "./octree";
import { createReprojector, type Reprojector } from "./reproject";

export interface CopcProviderOptions {
  /** Extra headers to send with each range request (e.g. for authentication). */
  headers?: Record<string, string>;
}

/**
 * Reads a COPC file's header, VLRs and octree hierarchy over HTTP range requests
 * via [copc.js](https://github.com/connormanning/copc.js). Construct with
 * {@link CopcProvider.fromUrl}.
 */
export class CopcProvider {
  private _reprojector?: Reprojector;
  private _boundingSphere?: BoundingSphere;

  private constructor(
    /** The source URL of the `.copc.laz` file. */
    readonly url: string,
    /** The byte-range getter used for every read. */
    private readonly getter: Getter,
    /** The parsed COPC object: `header`, `vlrs`, `info`, `wkt`, `eb`. */
    readonly copc: Copc,
  ) {}

  /**
   * Reads the COPC header, VLRs and octree info from `url`. The host must support
   * HTTP range requests (and CORS, if cross-origin).
   */
  static async fromUrl(url: string, options: CopcProviderOptions = {}): Promise<CopcProvider> {
    const getter = createGetter(url, options.headers);
    const copc = await Copc.create(getter);
    return new CopcProvider(url, getter, copc);
  }

  /**
   * Reprojects the file's CRS to ECEF, derived from `copc.wkt`. Built lazily: an
   * unusual CRS proj4 cannot parse throws here, but header, hierarchy and point
   * reads never touch the reprojector and keep working.
   */
  get reprojector(): Reprojector {
    if (!this._reprojector) this._reprojector = createReprojector(this.copc.wkt);
    return this._reprojector;
  }

  /**
   * Loads an octree hierarchy page. Defaults to the root page; pass a child page
   * (from a previous page's `pages` map) to lazily load a deeper subtree. Nodes
   * are keyed by their `depth-x-y-z` octree key.
   */
  loadHierarchyPage(page: Hierarchy.Page = this.copc.info.rootHierarchyPage) {
    return Copc.loadHierarchyPage(this.getter, page);
  }

  /**
   * Reads and decodes a node's points. `include` restricts which dimensions get
   * extractors (a performance win) — e.g. `["X", "Y", "Z", "Red", "Green",
   * "Blue", "Intensity", "Classification", "GpsTime"]`; omit it to read all.
   */
  loadPointDataView(node: Hierarchy.Node, include?: string[]) {
    return Copc.loadPointDataView(this.getter, this.copc, node, include ? { include } : undefined);
  }

  /** ECEF bounding sphere of the whole dataset, for camera framing. Memoized. */
  get boundingSphere(): BoundingSphere {
    if (!this._boundingSphere) {
      this._boundingSphere = datasetBoundingSphere(this.reprojector, this.copc.info.cube);
    }
    return this._boundingSphere;
  }
}

/**
 * Builds a copc.js {@link Getter}. Without custom headers, delegates to copc's
 * `Getter.create` (which routes http/https vs filesystem sources, matching
 * `Copc.create(url)`). With headers, a `fetch`-based range getter carries them.
 */
function createGetter(url: string, headers?: Record<string, string>): Getter {
  if (!headers || Object.keys(headers).length === 0) return Getter.create(url);
  return async (begin: number, end: number): Promise<Uint8Array> => {
    if (begin < 0 || end < begin) {
      throw new Error(`copc-tileset: invalid byte range [${begin}, ${end})`);
    }
    if (begin === end) return new Uint8Array(0);
    const response = await fetch(url, {
      headers: { ...headers, Range: `bytes=${begin}-${end - 1}` },
    });
    // A server that ignores Range replies 200 with the whole file; treating that
    // as the requested slice would silently corrupt reads, so require 206.
    if (response.status !== 206) {
      throw new Error(
        `copc-tileset: expected HTTP 206 for a range request but got ${response.status} — ` +
          `the host may not support range requests (${url})`,
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  };
}
