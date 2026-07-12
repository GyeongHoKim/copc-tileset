import { Cartesian3 } from "cesium";
import type { View } from "copc";
import type { Reprojector } from "./reproject";

// Encodes a COPC octree node's points as a 3D Tiles `.pnts` tile. Positions are
// stored as float32 offsets from an RTC_CENTER (the point centroid in ECEF) so
// large ECEF magnitudes don't lose precision. See the pnts spec:
// https://github.com/CesiumGS/3d-tiles/tree/main/specification/TileFormats/PointCloud

const HEADER_BYTE_LENGTH = 28;
const PNTS_MAGIC = 0x73746e70; // "pnts" little-endian

export interface PntsData {
  pointCount: number;
  /** ECEF centre the positions are relative to. */
  rtcCenter: readonly [number, number, number];
  /** Local float32 positions, length `3 * pointCount`, relative to `rtcCenter` (metres). */
  positions: Float32Array;
  /** Optional uint8 RGB, length `3 * pointCount`. */
  rgb?: Uint8Array;
}

const align8 = (n: number): number => (n + 7) & ~7;

/** Pads `json` with spaces so that `precedingBytes + byteLength` is 8-byte aligned. */
function padJsonTo8(json: string, precedingBytes: number): Uint8Array {
  const encoder = new TextEncoder();
  const base = encoder.encode(json).length;
  const padCount = align8(precedingBytes + base) - (precedingBytes + base);
  return encoder.encode(json + " ".repeat(padCount));
}

/** Serialises point data to a `.pnts` binary tile. */
export function encodePnts(data: PntsData): Uint8Array {
  const { pointCount, rtcCenter, positions, rgb } = data;

  const featureTable: Record<string, unknown> = {
    POINTS_LENGTH: pointCount,
    RTC_CENTER: [rtcCenter[0], rtcCenter[1], rtcCenter[2]],
    POSITION: { byteOffset: 0 },
  };
  if (rgb) featureTable.RGB = { byteOffset: positions.byteLength };

  const featureTableJson = padJsonTo8(JSON.stringify(featureTable), HEADER_BYTE_LENGTH);
  const featureTableBinaryLength = align8(positions.byteLength + (rgb?.byteLength ?? 0));
  const byteLength = HEADER_BYTE_LENGTH + featureTableJson.length + featureTableBinaryLength;

  const out = new Uint8Array(byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, PNTS_MAGIC, true);
  view.setUint32(4, 1, true); // version
  view.setUint32(8, byteLength, true);
  view.setUint32(12, featureTableJson.length, true);
  view.setUint32(16, featureTableBinaryLength, true);
  view.setUint32(20, 0, true); // batchTableJSONByteLength
  view.setUint32(24, 0, true); // batchTableBinaryByteLength

  out.set(featureTableJson, HEADER_BYTE_LENGTH);
  const binaryOffset = HEADER_BYTE_LENGTH + featureTableJson.length;
  out.set(
    new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength),
    binaryOffset,
  );
  if (rgb) out.set(rgb, binaryOffset + positions.byteLength);
  return out;
}

/**
 * Reads up to `sample` colour values and returns the right-shift to map them to
 * 8-bit: 8 if they look 16-bit, else 0. Colour bit depth is a property of the
 * whole file, so callers should detect it once and pass it to every
 * {@link buildNodePnts} call (via its `colorShift` option) — deciding per node
 * risks inconsistent colours between tiles.
 */
export function detectColorShift(view: View, sample = 1000): number {
  const getters = [view.getter("Red"), view.getter("Green"), view.getter("Blue")];
  const limit = Math.min(view.pointCount, sample);
  let max = 0;
  for (let i = 0; i < limit; i++) {
    for (const get of getters) {
      const v = get(i);
      if (v > max) max = v;
    }
  }
  return max > 255 ? 8 : 0;
}

/**
 * Builds a `.pnts` tile from a decoded COPC node {@link View}, reprojecting each
 * point to ECEF. Points whose reprojection is non-finite (out of the CRS domain)
 * are dropped. Positions become float32 offsets from the kept points' centroid.
 */
export function buildNodePnts(
  view: View,
  reprojector: Reprojector,
  options: { colorShift?: number } = {},
): Uint8Array {
  const count = view.pointCount;
  const getX = view.getter("X");
  const getY = view.getter("Y");
  const getZ = view.getter("Z");
  const hasColor = Boolean(view.dimensions.Red && view.dimensions.Green && view.dimensions.Blue);

  const ecef = new Float64Array(count * 3);
  const keep = new Uint8Array(count);
  const scratch = new Cartesian3();
  let kept = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  for (let i = 0; i < count; i++) {
    reprojector.toEcef(getX(i), getY(i), getZ(i), scratch);
    if (Number.isFinite(scratch.x) && Number.isFinite(scratch.y) && Number.isFinite(scratch.z)) {
      keep[i] = 1;
      ecef[i * 3] = scratch.x;
      ecef[i * 3 + 1] = scratch.y;
      ecef[i * 3 + 2] = scratch.z;
      sumX += scratch.x;
      sumY += scratch.y;
      sumZ += scratch.z;
      kept++;
    }
  }

  if (kept === 0) {
    return encodePnts({ pointCount: 0, rtcCenter: [0, 0, 0], positions: new Float32Array(0) });
  }

  const rtcCenter: [number, number, number] = [sumX / kept, sumY / kept, sumZ / kept];
  const positions = new Float32Array(kept * 3);
  const rgb = hasColor ? new Uint8Array(kept * 3) : undefined;
  const getR = hasColor ? view.getter("Red") : undefined;
  const getG = hasColor ? view.getter("Green") : undefined;
  const getB = hasColor ? view.getter("Blue") : undefined;
  const shift = hasColor ? (options.colorShift ?? detectColorShift(view)) : 0;

  let j = 0;
  for (let i = 0; i < count; i++) {
    if (!keep[i]) continue;
    const base = i * 3;
    positions[j * 3] = (ecef[base] ?? 0) - rtcCenter[0];
    positions[j * 3 + 1] = (ecef[base + 1] ?? 0) - rtcCenter[1];
    positions[j * 3 + 2] = (ecef[base + 2] ?? 0) - rtcCenter[2];
    if (rgb && getR && getG && getB) {
      rgb[j * 3] = (getR(i) >> shift) & 0xff;
      rgb[j * 3 + 1] = (getG(i) >> shift) & 0xff;
      rgb[j * 3 + 2] = (getB(i) >> shift) & 0xff;
    }
    j++;
  }

  return encodePnts({ pointCount: kept, rtcCenter, positions, rgb });
}
