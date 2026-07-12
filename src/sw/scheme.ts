// Virtual URL scheme for on-the-fly COPC tiles. The COPC source URL is encoded
// into a single path segment so a stateless Service Worker can reconstruct it
// from the request alone:
//   /__copc-tileset__/<encodedCopcUrl>/tileset.json   (root tileset)
//   /__copc-tileset__/<encodedCopcUrl>/<key>.json      (child-page tileset)
//   /__copc-tileset__/<encodedCopcUrl>/<key>.pnts      (node point content)

export const VIRTUAL_PREFIX = "/__copc-tileset__/";

/** The virtual URL of a COPC source's root tileset.json (relative to origin). */
export function tilesetUrl(copcUrl: string): string {
  return `${VIRTUAL_PREFIX}${encodeURIComponent(copcUrl)}/tileset.json`;
}

export type CopcRequest =
  | { copcUrl: string; kind: "tileset"; key: string }
  | { copcUrl: string; kind: "pnts"; key: string };

/**
 * Parses a virtual COPC path, or returns undefined if it is not one. `key` is the
 * octree key; the root tileset resolves to the root key `"0-0-0-0"`.
 */
export function parseVirtualPath(pathname: string): CopcRequest | undefined {
  if (!pathname.startsWith(VIRTUAL_PREFIX)) return undefined;
  const rest = pathname.slice(VIRTUAL_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash < 0) return undefined;

  const copcUrl = decodeURIComponent(rest.slice(0, slash));
  const name = rest.slice(slash + 1);
  if (!copcUrl || !name) return undefined;

  if (name === "tileset.json") return { copcUrl, kind: "tileset", key: "0-0-0-0" };
  if (name.endsWith(".json"))
    return { copcUrl, kind: "tileset", key: name.slice(0, -".json".length) };
  if (name.endsWith(".pnts")) return { copcUrl, kind: "pnts", key: name.slice(0, -".pnts".length) };
  return undefined;
}
