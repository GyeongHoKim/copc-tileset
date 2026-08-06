# Software Bill of Materials

Every release of `@gyeonghokim/copc-tileset` ships a machine-readable inventory of
its dependencies, in both industry-standard formats.

## Where to find it

| File | Format | Scope |
|---|---|---|
| [`sbom/bom.cdx.json`](./sbom/bom.cdx.json) | CycloneDX 1.5 | Runtime dependencies |
| [`sbom/bom.spdx.json`](./sbom/bom.spdx.json) | SPDX 2.3 | Runtime dependencies |
| `bom.full.cdx.json` | CycloneDX 1.5 | Full build tree (661 packages) |
| `bom.full.spdx.json` | SPDX 2.3 | Full build tree (661 packages) |

The two runtime files are committed here and included in the published npm tarball.
All four are attached to every [GitHub Release](https://github.com/GyeongHoKim/copc-tileset/releases);
the full-build-tree pair lives there only, because at ~1.3 MB it would otherwise
rewrite wholesale on every dev-tooling bump.

## How it is produced

`npm sbom`, built into the npm CLI — no third-party generator is involved. The
document is derived entirely from `package-lock.json` (`--package-lock-only`), so
it is reproducible offline and does not depend on an installed `node_modules`.
CycloneDX therefore reports lifecycle phase `pre-build`, which is the accurate
claim for a lockfile-derived document.

Generation is wired into `semantic-release`'s `prepare` step (see
[`.releaserc.json`](./.releaserc.json)), after `@semantic-release/npm` writes the
new version number and before the release is committed — so the SBOM's root
component version always equals the released version.

## Verify it yourself

```bash
npm run sbom:check   # regenerates and compares against the committed files
```

Or run the underlying command directly:

```bash
npm sbom --sbom-format cyclonedx --sbom-type library --package-lock-only --omit dev
```

**Compare content, not bytes.** `npm sbom` stamps a fresh `serialNumber` and
`metadata.timestamp` (CycloneDX) / `documentNamespace` and `creationInfo.created`
(SPDX) on every run — the CycloneDX specification requires a unique serial number
per document. `npm run sbom:check` strips those four fields before comparing.

## Runtime closure

What a consumer of this package actually installs:

| Package | Version | License |
|---|---|---|
| copc | 0.0.8 | MIT |
| cross-fetch | 3.2.0 | MIT |
| laz-perf | 0.0.7 | Apache-2.0 |
| mgrs | 1.0.0 | MIT |
| node-fetch | 2.7.0 | MIT |
| proj4 | 2.20.9 | MIT |
| tr46 | 0.0.3 | MIT |
| webidl-conversions | 3.0.1 | BSD-2-Clause |
| whatwg-url | 5.0.0 | MIT |
| wkt-parser | 1.5.5 | MIT |

All permissive (MIT / Apache-2.0 / BSD-2-Clause); this package itself is
AGPL-3.0-or-later.

> **`cesium` is not in this list.** It is a `peerDependency` supplied by the
> consuming application, and because it is also a devDependency here, `--omit dev`
> excludes it. It appears in the full-build-tree SBOM on the GitHub Release.

## What is bundled into what

A lockfile-derived SBOM states that a package is a dependency; it cannot state
that the package is *physically embedded* in a published file. This build does
embed some of them:

| Published file | Build | Embedded third-party code |
|---|---|---|
| `dist/index.js` | `platform: neutral` | `copc`, `proj4` bundled in. `laz-perf` stays external — your bundler resolves it and emits the `.wasm` |
| `dist/copc-sw.js` | `platform: browser`, everything bundled | **all of** `copc`, `proj4`, `laz-perf` — including `laz-perf.wasm`, inlined as a base64 `data:` URL |
| `dist/cli.js`, `dist/vite.js` | `platform: node` | none |

`dist/copc-sw.js` is deliberately self-contained so it can be dropped onto a static
host with no bundler processing. See the [build config](./tsdown.config.ts).

## Vulnerability scanning

[`.github/workflows/security.yml`](./.github/workflows/security.yml) runs
[OSV-Scanner](https://google.github.io/osv-scanner/) against these SBOMs on every
push and pull request, and weekly on a schedule. Results are uploaded to the
repository's **Security → Code scanning** tab.

The runtime SBOM is a gate — a vulnerability there ships to users, so it fails the
build. The build-tree scan reports without blocking, since those advisories affect
maintainers rather than consumers.

Separately, `npm audit signatures` runs during release to verify that every
installed package carries a valid npm registry signature.
