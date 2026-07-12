import { Copc } from "copc";

export interface CopcProviderOptions {
  /** Extra headers to send with each range request (e.g. for authentication). */
  headers?: Record<string, string>;
}

/**
 * Reads a COPC file's header, VLRs and octree hierarchy over HTTP range
 * requests via [copc.js](https://github.com/connormanning/copc.js).
 *
 * Construct with {@link CopcProvider.fromUrl}.
 */
export class CopcProvider {
  private constructor(
    /** The source URL of the `.copc.laz` file. */
    readonly url: string,
    /** The parsed COPC object: `header`, `vlrs`, `info`, `wkt`, `eb`. */
    readonly copc: Copc,
  ) {}

  /**
   * Reads the COPC header, VLRs and octree info from `url`. The host must
   * support HTTP range requests (and CORS, if cross-origin).
   */
  static async fromUrl(url: string, _options: CopcProviderOptions = {}): Promise<CopcProvider> {
    const copc = await Copc.create(url);
    return new CopcProvider(url, copc);
  }

  /**
   * Loads an octree hierarchy page. Defaults to the root page; pass a child
   * page reference to lazily load deeper subtrees. Nodes are keyed by their
   * `D-X-Y-Z` octree key.
   */
  loadHierarchyPage(page = this.copc.info.rootHierarchyPage) {
    return Copc.loadHierarchyPage(this.url, page);
  }
}
