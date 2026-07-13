import { type Bounds, type Hierarchy, Key } from "copc";
import { geometricError, nodeBoundingSphere } from "./octree";
import type { Reprojector } from "./reproject";

// Synthesises a 3D Tiles tileset from a COPC hierarchy page. Each octree node
// becomes a tile with a `.pnts` content; each unloaded child page becomes a tile
// whose content is an external tileset (fetched lazily to expand that subtree).
// Cesium's 3D Tiles engine then drives view-dependent streaming and LOD.

export interface Tile {
  boundingVolume: { sphere: [number, number, number, number] };
  geometricError: number;
  refine: "ADD";
  content: { uri: string };
  children?: Tile[];
}

export interface Tileset {
  asset: { version: "1.1" };
  geometricError: number;
  root: Tile;
}

/** Maps octree keys to their content URIs (node `.pnts` vs child-page tilesets). */
export interface TilesetUris {
  /** URI of a node's `.pnts` content. */
  content: (key: string) => string;
  /** URI of an unloaded child page's external tileset. */
  subtree: (key: string) => string;
}

export interface BuildTilesetParams {
  subtree: Hierarchy.Subtree;
  /** Octree key this page is rooted at (`"0-0-0-0"` for the top-level tileset). */
  rootKey: string;
  cube: Bounds;
  /** `copc.info.spacing` converted to metres (see `horizontalMetresPerUnit`). */
  rootSpacingMetres: number;
  reprojector: Reprojector;
  uris: TilesetUris;
}

const parentKey = (key: string): string => Key.toString(Key.up(Key.parse(key)));

/** Index of direct children (nodes and pages) by parent key. */
function childrenByParent(
  subtree: Hierarchy.Subtree,
): Map<string, { nodes: string[]; pages: string[] }> {
  const index = new Map<string, { nodes: string[]; pages: string[] }>();
  const bucket = (parent: string) => {
    let entry = index.get(parent);
    if (!entry) {
      entry = { nodes: [], pages: [] };
      index.set(parent, entry);
    }
    return entry;
  };
  for (const key of Object.keys(subtree.nodes)) bucket(parentKey(key)).nodes.push(key);
  for (const key of Object.keys(subtree.pages)) bucket(parentKey(key)).pages.push(key);
  return index;
}

/** Builds a tileset.json object for one COPC hierarchy page. */
export function buildTileset(params: BuildTilesetParams): Tileset {
  const { subtree, rootKey, cube, rootSpacingMetres, reprojector, uris } = params;
  const index = childrenByParent(subtree);

  const sphereVolume = (key: string): Tile["boundingVolume"] => {
    const { center, radius } = nodeBoundingSphere(reprojector, cube, key);
    return { sphere: [center[0], center[1], center[2], radius] };
  };

  const buildNodeTile = (key: string): Tile => {
    const children: Tile[] = [];
    const kids = index.get(key);
    if (kids) {
      for (const childKey of kids.nodes) children.push(buildNodeTile(childKey));
      for (const pageKey of kids.pages) children.push(buildPageTile(pageKey));
    }
    const tile: Tile = {
      boundingVolume: sphereVolume(key),
      geometricError: geometricError(rootSpacingMetres, key),
      refine: "ADD",
      content: { uri: uris.content(key) },
    };
    if (children.length > 0) tile.children = children;
    return tile;
  };

  // A child page becomes a leaf tile pointing at an external tileset that expands
  // the subtree when Cesium fetches it.
  const buildPageTile = (key: string): Tile => ({
    boundingVolume: sphereVolume(key),
    geometricError: geometricError(rootSpacingMetres, key),
    refine: "ADD",
    content: { uri: uris.subtree(key) },
  });

  const root = buildNodeTile(rootKey);
  // A tileset's own geometricError is the error of NOT rendering it at all (3D Tiles
  // spec). For the top-level tileset that is the dataset's extent, so Cesium renders
  // the root as soon as the cloud is on screen — not only after zooming in past the
  // point-spacing threshold (root spacing is metres, which projects below the default
  // maximumScreenSpaceError at fit-to-view distance, leaving the cloud invisible). A
  // lazily-expanded child page keeps the node's own error: the referencing tile in the
  // parent tileset already gates when that subtree loads.
  const tilesetGeometricError =
    rootKey === "0-0-0-0"
      ? nodeBoundingSphere(reprojector, cube, rootKey).radius
      : root.geometricError;
  return { asset: { version: "1.1" }, geometricError: tilesetGeometricError, root };
}
