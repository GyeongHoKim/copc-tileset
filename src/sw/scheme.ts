// Virtual URL scheme for on-the-fly COPC tiles. The COPC source URL is encoded
// into a single path segment so a stateless Service Worker can reconstruct it
// from the request alone:
//   <base>__copc-tileset__/<encodedCopcUrl>/tileset.json   (root tileset)
//   <base>__copc-tileset__/<encodedCopcUrl>/<key>.json      (child-page tileset)
//   <base>__copc-tileset__/<encodedCopcUrl>/<key>.pnts      (node point content)
//
// URLs are relative (no leading slash) so they resolve under the app's base path
// and therefore inside the Service Worker's scope — important on sub-path hosts
// like GitHub Pages project sites, where a worker cannot claim the origin root.
// The worker matches the marker anywhere in the request path.

export const VIRTUAL_PREFIX = "__copc-tileset__/";

/** The virtual URL of a COPC source's root tileset.json (relative to the app base). */
export function tilesetUrl(copcUrl: string): string {
  return `${VIRTUAL_PREFIX}${encodeURIComponent(copcUrl)}/tileset.json`;
}

export type CopcRequest =
  | { copcUrl: string; kind: "tileset"; key: string }
  | { copcUrl: string; kind: "pnts"; key: string };

/**
 * Parses a virtual COPC request from a path (the marker may appear after a base
 * prefix), or returns undefined if it is not one. `key` is the octree key; the
 * root tileset resolves to the root key `"0-0-0-0"`.
 */
export function parseVirtualPath(pathname: string): CopcRequest | undefined {
  // Anchor to a path-segment boundary (leading slash) so the marker is not matched
  // inside another segment, and the encoded COPC url (which contains no "/") cannot
  // shadow it. This keeps interception scoped to genuine virtual tile requests.
  const marker = `/${VIRTUAL_PREFIX}`;
  const at = pathname.indexOf(marker);
  if (at < 0) return undefined;
  const rest = pathname.slice(at + marker.length);
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
