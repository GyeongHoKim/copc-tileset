#!/usr/bin/env node
/**
 * Generates this package's SBOMs with `npm sbom` (built into the npm CLI — no
 * third-party generator), in both SPDX 2.3 and CycloneDX 1.5.
 *
 *   node scripts/gen-sbom.mjs           write every target under sbom/
 *   node scripts/gen-sbom.mjs --check   verify the committed targets are current
 *
 * Two scopes are emitted. The *runtime* closure (`--omit dev`) is what consumers
 * actually pull in, so it is small enough to commit and diff. The *full* tree
 * includes the build toolchain — ~1.3 MB that rewrites wholesale on every devDep
 * bump — so it ships as a GitHub Release asset only.
 *
 * Every target uses `--package-lock-only`: package-lock.json is the single source
 * of truth, so output is identical on a laptop, in CI, and in a fresh clone with
 * no `npm install` in between. The cost is CycloneDX reporting lifecycle phase
 * "pre-build" rather than "build", which is the accurate claim for a document
 * derived from a lockfile.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "sbom");

/** @type {{ file: string, format: "cyclonedx" | "spdx", omitDev: boolean, committed: boolean }[]} */
const TARGETS = [
  { file: "bom.cdx.json", format: "cyclonedx", omitDev: true, committed: true },
  { file: "bom.spdx.json", format: "spdx", omitDev: true, committed: true },
  { file: "bom.full.cdx.json", format: "cyclonedx", omitDev: false, committed: false },
  { file: "bom.full.spdx.json", format: "spdx", omitDev: false, committed: false },
];

/**
 * `npm sbom` writes the document to stdout and nothing else, so the only thing
 * to get right is capturing it.
 * @param {(typeof TARGETS)[number]} target
 * @returns {string}
 */
function generate(target) {
  const args = [
    "sbom",
    "--sbom-format",
    target.format,
    "--sbom-type",
    "library",
    "--package-lock-only",
  ];
  if (target.omitDev) args.push("--omit", "dev");

  const isWindows = process.platform === "win32";
  const result = spawnSync(isWindows ? "npm.cmd" : "npm", args, {
    cwd: root,
    encoding: "utf8",
    // Node >= 20.12 refuses to spawn a .cmd without a shell.
    shell: isWindows,
    // The full-tree SPDX document is ~720 KB — uncomfortably close to the 1 MiB default.
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(" ")} exited ${result.status}\n${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Strips the fields `npm sbom` regenerates on every run. CycloneDX requires a
 * unique serialNumber per document, so byte comparison is meaningless by design —
 * compare content instead.
 * @param {string} json
 * @returns {string}
 */
function stable(json) {
  const doc = JSON.parse(json);
  // CycloneDX
  doc.serialNumber = undefined;
  if (doc.metadata) doc.metadata.timestamp = undefined;
  // SPDX
  doc.documentNamespace = undefined;
  if (doc.creationInfo) doc.creationInfo.created = undefined;
  return JSON.stringify(doc);
}

const check = process.argv.includes("--check");

if (check) {
  const stale = [];
  for (const target of TARGETS.filter((t) => t.committed)) {
    const path = join(outDir, target.file);
    if (!existsSync(path)) {
      stale.push(`${target.file} is missing`);
      continue;
    }
    if (stable(readFileSync(path, "utf8")) !== stable(generate(target))) {
      stale.push(`${target.file} does not match the current package-lock.json`);
    }
  }

  if (stale.length > 0) {
    console.error(`copc-tileset: SBOM out of date\n  ${stale.join("\n  ")}`);
    console.error("\nRun `npm run sbom` and commit the result.");
    process.exit(1);
  }
  console.log("copc-tileset: SBOM is up to date");
} else {
  mkdirSync(outDir, { recursive: true });
  for (const target of TARGETS) {
    writeFileSync(join(outDir, target.file), generate(target));
    console.log(`copc-tileset: wrote sbom/${target.file}`);
  }
}
