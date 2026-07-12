import { Cartesian3 } from "cesium";
import type { View } from "copc";
import type { Reprojector } from "./reproject";

// Encodes a COPC octree node's points as a 3D Tiles `.pnts` tile. Positions are
// stored as float32 offsets from an RTC_CENTER (the point centroid in ECEF) so
// large ECEF magnitudes don't lose precision. See the pnts spec:
// https://github.com/CesiumGS/3d-tiles/tree/main/specification/TileFormats/PointCloud

const HEADER_BYTE_LENGTH = 28;
const PNTS_MAGIC = 0x73746e70; // "pnts" little-endian

/** A per-point property exposed for picking (`Cesium3DTileFeature`) and shaders. */
export interface BatchTableProperty {
  name: string;
  componentType: "UNSIGNED_BYTE" | "UNSIGNED_SHORT" | "FLOAT" | "DOUBLE";
  /** Packed little-endian values, length `pointCount * componentBytes`. */
  data: Uint8Array;
}

/** COPC per-point dimensions copied into each tile's batch table, if present. */
interface PointAttribute {
  name: string;
  componentType: BatchTableProperty["componentType"];
  bytesPerComponent: number;
  write: (view: DataView, offset: number, value: number) => void;
}

const POINT_ATTRIBUTES: PointAttribute[] = [
  {
    name: "Classification",
    componentType: "UNSIGNED_BYTE",
    bytesPerComponent: 1,
    write: (view, offset, value) => view.setUint8(offset, value),
  },
  {
    name: "Intensity",
    componentType: "UNSIGNED_SHORT",
    bytesPerComponent: 2,
    write: (view, offset, value) => view.setUint16(offset, value, true),
  },
  {
    name: "GpsTime",
    componentType: "DOUBLE",
    bytesPerComponent: 8,
    write: (view, offset, value) => view.setFloat64(offset, value, true),
  },
];

export interface PntsData {
  pointCount: number;
  /** ECEF centre the positions are relative to. */
  rtcCenter: readonly [number, number, number];
  /** Local float32 positions, length `3 * pointCount`, relative to `rtcCenter` (metres). */
  positions: Float32Array;
  /** Optional uint8 RGB, length `3 * pointCount`. */
  rgb?: Uint8Array;
  /** Optional per-point properties (one row per point, no BATCH_ID). */
  batchTable?: BatchTableProperty[];
}

const COMPONENT_BYTES = { UNSIGNED_BYTE: 1, UNSIGNED_SHORT: 2, FLOAT: 4, DOUBLE: 8 } as const;

const align8 = (n: number): number => (n + 7) & ~7;
const alignTo = (n: number, a: number): number => Math.ceil(n / a) * a;

/** Pads `json` with spaces so that `precedingBytes + byteLength` is 8-byte aligned. */
function padJsonTo8(json: string, precedingBytes: number): Uint8Array {
  const encoder = new TextEncoder();
  const base = encoder.encode(json).length;
  const padCount = align8(precedingBytes + base) - (precedingBytes + base);
  return encoder.encode(json + " ".repeat(padCount));
}

/**
 * Lays out a batch table binary + JSON. Properties are ordered largest component
 * first so each aligned `byteOffset` falls out naturally. Returns undefined when
 * there are no properties.
 */
function layoutBatchTable(
  properties: BatchTableProperty[],
): { json: Record<string, unknown>; binary: Uint8Array } | undefined {
  if (properties.length === 0) return undefined;
  const ordered = [...properties].sort(
    (a, b) => COMPONENT_BYTES[b.componentType] - COMPONENT_BYTES[a.componentType],
  );
  const json: Record<string, unknown> = {};
  const placed: Array<{ data: Uint8Array; offset: number }> = [];
  let offset = 0;
  for (const property of ordered) {
    offset = alignTo(offset, COMPONENT_BYTES[property.componentType]);
    json[property.name] = {
      byteOffset: offset,
      componentType: property.componentType,
      type: "SCALAR",
    };
    placed.push({ data: property.data, offset });
    offset += property.data.byteLength;
  }
  const binary = new Uint8Array(offset);
  for (const { data, offset: at } of placed) binary.set(data, at);
  return { json, binary };
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

  const batch = layoutBatchTable(data.batchTable ?? []);
  const afterFeature = HEADER_BYTE_LENGTH + featureTableJson.length + featureTableBinaryLength;
  const batchTableJson = batch
    ? padJsonTo8(JSON.stringify(batch.json), afterFeature)
    : new Uint8Array(0);
  const batchTableBinaryLength = batch ? align8(batch.binary.byteLength) : 0;

  const byteLength = afterFeature + batchTableJson.length + batchTableBinaryLength;

  const out = new Uint8Array(byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, PNTS_MAGIC, true);
  view.setUint32(4, 1, true); // version
  view.setUint32(8, byteLength, true);
  view.setUint32(12, featureTableJson.length, true);
  view.setUint32(16, featureTableBinaryLength, true);
  view.setUint32(20, batchTableJson.length, true);
  view.setUint32(24, batchTableBinaryLength, true);

  out.set(featureTableJson, HEADER_BYTE_LENGTH);
  const featureBinaryOffset = HEADER_BYTE_LENGTH + featureTableJson.length;
  out.set(
    new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength),
    featureBinaryOffset,
  );
  if (rgb) out.set(rgb, featureBinaryOffset + positions.byteLength);
  if (batch) {
    out.set(batchTableJson, afterFeature);
    out.set(batch.binary, afterFeature + batchTableJson.length);
  }
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

  // Per-point attributes for picking / attribute shaders, for whichever the file
  // has. Bytes are written explicitly little-endian, as the pnts format requires.
  const attributes = POINT_ATTRIBUTES.filter((attr) => view.dimensions[attr.name]).map((attr) => {
    const data = new Uint8Array(kept * attr.bytesPerComponent);
    return { attr, get: view.getter(attr.name), data, dataView: new DataView(data.buffer) };
  });

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
    for (const { attr, get, dataView } of attributes) {
      attr.write(dataView, j * attr.bytesPerComponent, get(i));
    }
    j++;
  }

  const batchTable: BatchTableProperty[] = attributes.map(({ attr, data }) => ({
    name: attr.name,
    componentType: attr.componentType,
    data,
  }));

  return encodePnts({ pointCount: kept, rtcCenter, positions, rgb, batchTable });
}
