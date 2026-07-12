// COPC/LAS files routinely carry a *compound* CRS WKT (a horizontal CRS plus a
// vertical CRS), e.g. `COMPD_CS[PROJCS[...ft...], VERT_CS[...ftUS...]]`. proj4
// only does horizontal transforms and cannot parse `COMPD_CS`, so we extract the
// horizontal CRS for proj4 and read the vertical unit separately to scale Z into
// metres (Cesium's height unit).
//
// Parsing is a lightweight WKT1 string scan (not a full parser): good enough to
// isolate nodes and unit factors. WKT2 keywords are handled best-effort.

/**
 * Extracts the first balanced `KEYWORD[...]` substring, or undefined if absent.
 * Quoted strings are skipped so brackets inside a name (e.g. `"State Plane [ft]"`)
 * do not corrupt the depth count.
 */
function extractNode(wkt: string, keyword: string): string | undefined {
  const start = wkt.indexOf(`${keyword}[`);
  if (start < 0) return undefined;
  let depth = 0;
  let inQuotes = false;
  for (let i = start + keyword.length; i < wkt.length; i++) {
    const c = wkt[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (c === "[") {
        depth++;
      } else if (c === "]") {
        depth--;
        if (depth === 0) return wkt.slice(start, i + 1);
      }
    }
  }
  return undefined;
}

/** Removes the first nested `KEYWORD[...]` node from `wkt`, if present. */
function removeNode(wkt: string, keyword: string): string {
  const node = extractNode(wkt, keyword);
  return node ? wkt.replace(node, "") : wkt;
}

/** The last `UNIT["name", factor]` positive conversion factor within `node`. */
function lastUnitFactor(node: string): number | undefined {
  const re = /UNIT\[\s*"[^"]*"\s*,\s*([0-9eE.+-]+)/g;
  let last: number | undefined;
  for (let m = re.exec(node); m !== null; m = re.exec(node)) {
    last = Number.parseFloat(m[1] as string);
  }
  return last !== undefined && Number.isFinite(last) && last > 0 ? last : undefined;
}

/**
 * The projected CRS's own linear unit factor (metres per unit). The nested
 * geographic CRS is removed first so its angular unit (degrees, ~0.0174) is never
 * mistaken for the linear one.
 */
function projectedLinearUnit(projcs: string): number | undefined {
  let body = projcs;
  for (const geoKeyword of ["GEOGCS", "GEOGCRS", "BASEGEOGCRS"]) {
    body = removeNode(body, geoKeyword);
  }
  return lastUnitFactor(body);
}

/**
 * Returns the horizontal CRS WKT suitable for proj4. For a compound CRS this is
 * the inner `PROJCS`/`GEOGCS` (WKT1) or `PROJCRS`/`GEOGCRS` (WKT2); otherwise the
 * input is returned unchanged.
 */
export function horizontalWkt(wkt: string): string {
  const trimmed = wkt.trim();
  if (!/^(COMPD_CS|COMPOUNDCRS)\[/.test(trimmed)) return trimmed;
  return (
    extractNode(trimmed, "PROJCS") ??
    extractNode(trimmed, "PROJCRS") ??
    extractNode(trimmed, "GEOGCS") ??
    extractNode(trimmed, "GEOGCRS") ??
    trimmed
  );
}

/**
 * Metres-per-unit for the CRS's vertical (Z) axis. Prefers the explicit `VERT_CS`
 * unit; otherwise falls back to the projected horizontal linear unit, since LAS
 * point coordinates conventionally share the CRS's linear unit (a feet-projected
 * file almost always stores feet Z). Returns 1 (metres) for a geographic or
 * unit-less CRS. An explicit `VERT_CS` always wins, so declare one to be exact.
 */
export function verticalUnitToMetres(wkt: string): number {
  const vertical =
    extractNode(wkt, "VERT_CS") ?? extractNode(wkt, "VERTCRS") ?? extractNode(wkt, "VERT_CRS");
  if (vertical) return lastUnitFactor(vertical) ?? 1;

  const projected = extractNode(wkt, "PROJCS") ?? extractNode(wkt, "PROJCRS");
  if (projected) return projectedLinearUnit(projected) ?? 1;

  return 1;
}
