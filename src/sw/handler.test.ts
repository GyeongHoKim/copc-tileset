import { describe, expect, it } from "vitest";
import type { CopcTileStore } from "../copcTileStore";
import { handleCopcRequest } from "./handler";
import { tilesetUrl, VIRTUAL_PREFIX } from "./scheme";

const ORIGIN = "https://app.example";
const COPC = "https://host/data.copc.laz";

function fakeStore(overrides: Partial<CopcTileStore> = {}): CopcTileStore {
  return {
    tileset: async (key: string) => ({
      asset: { version: "1.1" },
      geometricError: 1,
      root: { key },
    }),
    pnts: async () => new Uint8Array([1, 2, 3, 4]),
    ...overrides,
  } as unknown as CopcTileStore;
}

describe("handleCopcRequest", () => {
  it("returns undefined for non-COPC URLs", async () => {
    expect(await handleCopcRequest(`${ORIGIN}/index.html`, () => fakeStore())).toBeUndefined();
  });

  it("serves tileset JSON for a tileset request", async () => {
    const response = await handleCopcRequest(ORIGIN + tilesetUrl(COPC), () => fakeStore());
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("application/json");
    const body = await (response as Response).json();
    expect(body.asset.version).toBe("1.1");
    expect(body.root.key).toBe("0-0-0-0");
  });

  it("passes the decoded COPC url to the resolver", async () => {
    let seen = "";
    await handleCopcRequest(ORIGIN + tilesetUrl(COPC), (copcUrl) => {
      seen = copcUrl;
      return fakeStore();
    });
    expect(seen).toBe(COPC);
  });

  it("serves pnts bytes as octet-stream", async () => {
    const path = `${ORIGIN}${VIRTUAL_PREFIX}${encodeURIComponent(COPC)}/1-0-0-0.pnts`;
    const response = await handleCopcRequest(path, () => fakeStore());
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(new Uint8Array(await (response as Response).arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });

  it("returns 500 when the store throws", async () => {
    const store = fakeStore({
      tileset: async () => {
        throw new Error("boom");
      },
    });
    const response = await handleCopcRequest(ORIGIN + tilesetUrl(COPC), () => store);
    expect(response?.status).toBe(500);
    expect(await (response as Response).text()).toContain("boom");
  });
});
