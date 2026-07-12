import type { CopcTileStore } from "../copcTileStore";
import { parseVirtualPath } from "./scheme";

/** Resolves (creating/caching as needed) the tile store for a COPC source URL. */
export type StoreResolver = (copcUrl: string) => CopcTileStore | Promise<CopcTileStore>;

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};
const PNTS_HEADERS = {
  "Content-Type": "application/octet-stream",
  "Access-Control-Allow-Origin": "*",
};

/**
 * Handles a virtual COPC tile request, returning a `Response`, or `undefined` if
 * the URL is not a COPC virtual path (so the caller can let it pass through).
 * This is the transport-agnostic core of the Service Worker, testable in Node.
 */
export async function handleCopcRequest(
  url: string,
  resolveStore: StoreResolver,
): Promise<Response | undefined> {
  let request: ReturnType<typeof parseVirtualPath>;
  try {
    // Both URL parsing and parseVirtualPath's decodeURIComponent can throw on a
    // malformed path; treat any such request as "not ours" and pass it through.
    request = parseVirtualPath(new URL(url).pathname);
  } catch {
    return undefined;
  }
  if (!request) return undefined;

  try {
    const store = await resolveStore(request.copcUrl);
    if (request.kind === "tileset") {
      const tileset = await store.tileset(request.key);
      return new Response(JSON.stringify(tileset), { status: 200, headers: JSON_HEADERS });
    }
    const pnts = await store.pnts(request.key);
    return new Response(pnts as BufferSource, { status: 200, headers: PNTS_HEADERS });
  } catch (error) {
    return new Response(`copc-tileset: ${String(error)}`, { status: 500 });
  }
}
