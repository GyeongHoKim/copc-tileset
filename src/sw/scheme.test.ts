import { describe, expect, it } from "vitest";
import { parseVirtualPath, tilesetUrl, VIRTUAL_PREFIX } from "./scheme";

const COPC = "https://s3.amazonaws.com/hobu-lidar/autzen-classified.copc.laz";

describe("tilesetUrl + parseVirtualPath", () => {
  it("round-trips the COPC url through the root tileset path", () => {
    const url = tilesetUrl(COPC);
    expect(url.startsWith(VIRTUAL_PREFIX)).toBe(true); // relative, no leading slash
    const parsed = parseVirtualPath(`/${url}`);
    expect(parsed).toEqual({ copcUrl: COPC, kind: "tileset", key: "0-0-0-0" });
  });

  it("matches the marker under an app base path (e.g. GitHub Pages sub-path)", () => {
    const parsed = parseVirtualPath(`/copc-tileset/${tilesetUrl(COPC)}`);
    expect(parsed).toEqual({ copcUrl: COPC, kind: "tileset", key: "0-0-0-0" });
  });

  it("parses a child-page tileset request", () => {
    const path = `/${VIRTUAL_PREFIX}${encodeURIComponent(COPC)}/1-1-1-1.json`;
    expect(parseVirtualPath(path)).toEqual({ copcUrl: COPC, kind: "tileset", key: "1-1-1-1" });
  });

  it("parses a node pnts request", () => {
    const path = `/${VIRTUAL_PREFIX}${encodeURIComponent(COPC)}/2-1-0-3.pnts`;
    expect(parseVirtualPath(path)).toEqual({ copcUrl: COPC, kind: "pnts", key: "2-1-0-3" });
  });

  it("ignores non-COPC and malformed paths", () => {
    expect(parseVirtualPath("/some/other/path")).toBeUndefined();
    expect(parseVirtualPath(`/${VIRTUAL_PREFIX}onlyonesegment`)).toBeUndefined();
    expect(
      parseVirtualPath(`/${VIRTUAL_PREFIX}${encodeURIComponent(COPC)}/weird.txt`),
    ).toBeUndefined();
  });

  it("does not match the marker embedded inside another path segment", () => {
    // No leading slash before the marker -> not a real virtual tile request.
    const path = `/assets/xy${VIRTUAL_PREFIX}${encodeURIComponent(COPC)}/tileset.json`;
    expect(parseVirtualPath(path)).toBeUndefined();
  });

  it("preserves a copc url containing query parameters", () => {
    const signed = "https://host/data.copc.laz?token=a/b+c";
    const parsed = parseVirtualPath(`/${tilesetUrl(signed)}`);
    expect(parsed?.copcUrl).toBe(signed);
  });
});
