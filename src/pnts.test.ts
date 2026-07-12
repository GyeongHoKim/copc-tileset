import type { View } from "copc";
import { describe, expect, it } from "vitest";
import { buildNodePnts, encodePnts } from "./pnts";
import { createReprojector } from "./reproject";

interface DecodedPnts {
  magic: string;
  version: number;
  byteLength: number;
  featureTableJsonLength: number;
  featureTable: {
    POINTS_LENGTH: number;
    RTC_CENTER: [number, number, number];
    POSITION: { byteOffset: number };
    RGB?: { byteOffset: number };
  };
  positions: Float32Array;
  rgb?: Uint8Array;
  batchTableJson?: Record<string, { byteOffset: number; componentType: string; type: string }>;
  batchTableBinary?: Uint8Array;
}

function decodePnts(buf: Uint8Array): DecodedPnts {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(
    buf[0] as number,
    buf[1] as number,
    buf[2] as number,
    buf[3] as number,
  );
  const version = dv.getUint32(4, true);
  const byteLength = dv.getUint32(8, true);
  const featureTableJsonLength = dv.getUint32(12, true);
  const featureTableBinaryLength = dv.getUint32(16, true);
  const batchTableJsonLength = dv.getUint32(20, true);
  const jsonStart = 28;
  const featureTable = JSON.parse(
    new TextDecoder().decode(buf.subarray(jsonStart, jsonStart + featureTableJsonLength)),
  );
  const binaryOffset = jsonStart + featureTableJsonLength;
  const n = featureTable.POINTS_LENGTH;
  const posStart = buf.byteOffset + binaryOffset + featureTable.POSITION.byteOffset;
  const positions = new Float32Array(buf.buffer.slice(posStart, posStart + n * 12));
  let rgb: Uint8Array | undefined;
  if (featureTable.RGB) {
    const rgbStart = binaryOffset + featureTable.RGB.byteOffset;
    rgb = buf.subarray(rgbStart, rgbStart + n * 3);
  }
  let batchTableJson: DecodedPnts["batchTableJson"];
  let batchTableBinary: Uint8Array | undefined;
  if (batchTableJsonLength > 0) {
    const batchJsonStart = binaryOffset + featureTableBinaryLength;
    batchTableJson = JSON.parse(
      new TextDecoder().decode(buf.subarray(batchJsonStart, batchJsonStart + batchTableJsonLength)),
    );
    batchTableBinary = buf.subarray(batchJsonStart + batchTableJsonLength);
  }
  return {
    magic,
    version,
    byteLength,
    featureTableJsonLength,
    featureTable,
    positions,
    rgb,
    batchTableJson,
    batchTableBinary,
  };
}

describe("encodePnts", () => {
  it("produces a spec-conformant, 8-byte-aligned pnts tile", () => {
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const tile = encodePnts({ pointCount: 2, rtcCenter: [100, 200, 300], positions, rgb });

    expect(tile.byteLength % 8).toBe(0);
    const decoded = decodePnts(tile);
    expect(decoded.magic).toBe("pnts");
    expect(decoded.version).toBe(1);
    expect(decoded.byteLength).toBe(tile.byteLength);
    expect((28 + decoded.featureTableJsonLength) % 8).toBe(0);
    expect(decoded.featureTable.POINTS_LENGTH).toBe(2);
    expect(decoded.featureTable.RTC_CENTER).toEqual([100, 200, 300]);
    expect(decoded.featureTable.POSITION.byteOffset).toBe(0);
    expect(decoded.featureTable.RGB?.byteOffset).toBe(positions.byteLength);
    expect(Array.from(decoded.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(decoded.rgb ?? [])).toEqual([255, 0, 0, 0, 255, 0]);
  });

  it("honours an explicit colorShift instead of per-node detection", () => {
    const columns: Record<string, number[]> = {
      X: [-123.0],
      Y: [44.0],
      Z: [0],
      Red: [65535],
      Green: [256],
      Blue: [512],
    };
    const view = {
      pointCount: 1,
      dimensions: { X: {}, Y: {}, Z: {}, Red: {}, Green: {}, Blue: {} },
      getter: (name: string) => (i: number) => columns[name]?.[i] ?? 0,
    } as unknown as View;
    // colorShift 0 masks with & 0xff: 65535->255, 256->0, 512->0.
    const shift0 = decodePnts(buildNodePnts(view, createReprojector(), { colorShift: 0 }));
    expect(Array.from(shift0.rgb ?? [])).toEqual([255, 0, 0]);
    // colorShift 8 divides by 256: 65535->255, 256->1, 512->2.
    const shift8 = decodePnts(buildNodePnts(view, createReprojector(), { colorShift: 8 }));
    expect(Array.from(shift8.rgb ?? [])).toEqual([255, 1, 2]);
  });

  it("omits RGB when no colours are provided", () => {
    const tile = encodePnts({
      pointCount: 1,
      rtcCenter: [0, 0, 0],
      positions: new Float32Array([0, 0, 0]),
    });
    expect(decodePnts(tile).featureTable.RGB).toBeUndefined();
  });

  it("encodes an aligned batch table of per-point properties", () => {
    const classification = new Uint8Array([2, 6]);
    const gpsTime = new Float64Array([100.5, 200.25]);
    const tile = encodePnts({
      pointCount: 2,
      rtcCenter: [0, 0, 0],
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      batchTable: [
        { name: "Classification", componentType: "UNSIGNED_BYTE", data: classification },
        {
          name: "GpsTime",
          componentType: "DOUBLE",
          data: new Uint8Array(gpsTime.buffer, gpsTime.byteOffset, gpsTime.byteLength),
        },
      ],
    });
    expect(tile.byteLength % 8).toBe(0);
    const decoded = decodePnts(tile);
    const json = decoded.batchTableJson;
    const bin = decoded.batchTableBinary;
    const gpsProp = json?.GpsTime;
    const clsProp = json?.Classification;
    expect(gpsProp).toBeDefined();
    expect(clsProp).toBeDefined();
    if (!bin || !gpsProp || !clsProp) return;
    // DOUBLE must be 8-byte aligned within the batch binary.
    expect(gpsProp.byteOffset % 8).toBe(0);
    const base = bin.byteOffset;
    const gps = new Float64Array(
      bin.buffer.slice(base + gpsProp.byteOffset, base + gpsProp.byteOffset + 16),
    );
    expect(Array.from(gps)).toEqual([100.5, 200.25]);
    expect(Array.from(bin.subarray(clsProp.byteOffset, clsProp.byteOffset + 2))).toEqual([2, 6]);
  });
});

describe("buildNodePnts", () => {
  it("reprojects points, scales 16-bit colour to 8-bit, and centres on the centroid", () => {
    const columns: Record<string, number[]> = {
      X: [-123.0, -123.001],
      Y: [44.0, 44.001],
      Z: [0, 10],
      Red: [65535, 0],
      Green: [0, 65535],
      Blue: [256, 512],
    };
    const view = {
      pointCount: 2,
      dimensions: { X: {}, Y: {}, Z: {}, Red: {}, Green: {}, Blue: {} },
      getter: (name: string) => (i: number) => columns[name]?.[i] ?? 0,
    } as unknown as View;

    const tile = buildNodePnts(view, createReprojector());
    const decoded = decodePnts(tile);

    expect(decoded.featureTable.POINTS_LENGTH).toBe(2);
    // 16-bit -> 8-bit: 65535 >> 8 === 255, 256 >> 8 === 1.
    expect(Array.from(decoded.rgb ?? [])).toEqual([255, 0, 1, 0, 255, 2]);
    // Positions are centred: the two local positions must sum to ~0 per axis.
    const p = Array.from(decoded.positions);
    expect((p[0] ?? 0) + (p[3] ?? 0)).toBeCloseTo(0, 3);
    expect((p[1] ?? 0) + (p[4] ?? 0)).toBeCloseTo(0, 3);
    expect((p[2] ?? 0) + (p[5] ?? 0)).toBeCloseTo(0, 3);
    // RTC centre is a real ECEF location (~Earth radius from origin).
    const [cx, cy, cz] = decoded.featureTable.RTC_CENTER;
    expect(Math.hypot(cx, cy, cz)).toBeGreaterThan(6.2e6);
  });

  it("emits Classification/Intensity/GpsTime as batch-table properties", () => {
    const columns: Record<string, number[]> = {
      X: [-123.0, -123.001],
      Y: [44.0, 44.001],
      Z: [0, 10],
      Classification: [2, 6],
      Intensity: [1000, 40000],
      GpsTime: [123456.5, 123457.5],
    };
    const view = {
      pointCount: 2,
      dimensions: { X: {}, Y: {}, Z: {}, Classification: {}, Intensity: {}, GpsTime: {} },
      getter: (name: string) => (i: number) => columns[name]?.[i] ?? 0,
    } as unknown as View;

    const decoded = decodePnts(buildNodePnts(view, createReprojector()));
    const json = decoded.batchTableJson;
    const bin = decoded.batchTableBinary;
    const clsProp = json?.Classification;
    const intensityProp = json?.Intensity;
    expect(clsProp?.componentType).toBe("UNSIGNED_BYTE");
    expect(intensityProp?.componentType).toBe("UNSIGNED_SHORT");
    expect(json?.GpsTime?.componentType).toBe("DOUBLE");
    if (!bin || !clsProp || !intensityProp) return;

    expect(Array.from(bin.subarray(clsProp.byteOffset, clsProp.byteOffset + 2))).toEqual([2, 6]);
    const intensity = new Uint16Array(
      bin.buffer.slice(
        bin.byteOffset + intensityProp.byteOffset,
        bin.byteOffset + intensityProp.byteOffset + 4,
      ),
    );
    expect(Array.from(intensity)).toEqual([1000, 40000]);
  });
});
