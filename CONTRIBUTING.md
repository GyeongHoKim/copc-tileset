# Contributing to copc-tileset

Thanks for taking the time to look at this project. Bug reports, documentation
fixes, sample datasets that break the renderer, and code are all welcome —
you do not need to be a point-cloud expert to help.

By participating you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Where to start

| I want to… | Go here |
|---|---|
| Ask a question | [Discussions → Q&A](https://github.com/GyeongHoKim/copc-tileset/discussions/categories/q-a) |
| Report a bug | [New issue → Bug report](https://github.com/GyeongHoKim/copc-tileset/issues/new/choose) |
| Suggest a feature | [New issue → Feature request](https://github.com/GyeongHoKim/copc-tileset/issues/new/choose) — check [ROADMAP.md](./ROADMAP.md) first |
| Report a vulnerability | **Not** an issue — see [SECURITY.md](./SECURITY.md) |
| Find a first task | [`good first issue`](https://github.com/GyeongHoKim/copc-tileset/labels/good%20first%20issue) · [`help wanted`](https://github.com/GyeongHoKim/copc-tileset/labels/help%20wanted) |

A good bug report includes a **publicly reachable `.copc.laz` URL** (or one of
the sample datasets in the README) — without one, most rendering bugs cannot be
reproduced.

## Development setup

Node **>= 22.14.0** is required (see `engines` in `package.json`).

```bash
git clone https://github.com/GyeongHoKim/copc-tileset.git
cd copc-tileset
npm clean-install
npm run dev            # interactive demo from examples/ at http://localhost:5173
```

The demo in `examples/` is the fastest way to see a change: it streams the public
Autzen / Millsite / SoFi datasets and exposes the EDL, attenuation, point-size,
SSE and picking controls.

## Commands

```bash
npm run build            # bundle to dist/ with tsdown (ESM + .d.ts)
npm run typecheck        # tsc --noEmit
npm run check            # biome lint + format check (read-only)
npm run check:fix        # biome autofix + format write
npm test                 # vitest run — unit tests only (offline, deterministic)
npm run test:integration # vitest against real COPC data over the network (60s timeouts)
npm run test:e2e         # build the demo + drive it in headless Chromium (Playwright)
npm run sbom             # regenerate the SBOMs in sbom/ (npm sbom, SPDX + CycloneDX)
npm run sbom:check       # fail if the committed SBOMs are stale — runs in CI
```

Run a single test: `npx vitest run src/pnts.test.ts` (add `-t "name"` to filter
by test name). Watch mode: `npm run test:watch`.

## The quality gate

Before opening a pull request, all three must pass — this is exactly what the CI
`verify` job runs, so a failure here is a failure there:

```bash
npm run check
npm run typecheck
npm test
```

`npm run check:fix` fixes most formatting and lint findings automatically. A
husky `pre-commit` hook runs `biome check` on staged files, so badly formatted
code usually cannot be committed in the first place.

## Testing policy

- **Unit tests** live next to the code as `src/**/*.test.ts` and **must stay
  offline and deterministic**. They are what `npm test` and every PR run.
- **Anything that touches the network** goes in `*.integration.test.ts`, which is
  excluded from `npm test` (compare `vitest.config.ts` with
  `vitest.integration.config.ts`) and run on demand with
  `npm run test:integration`.
- **The full browser path** — Service Worker intercepting virtual tile URLs and
  Cesium rendering the synthesised `.pnts` — is covered by `e2e/render.spec.ts`.
  It needs a browser and the network, so it runs in its own CI workflow.

New rendering or encoding logic should come with a unit test. If the only way to
prove it is against real data, add an integration test rather than making a unit
test hit the network.

## Architecture constraint (read this before writing code)

**The tile-generation code runs inside a Service Worker, which has no DOM and no
Cesium.** `src/CopcPointCloudPrimitive.ts` is the *only* module allowed to import
from `cesium`. Everything reachable from the worker entry point
(`src/sw/copc-sw.ts`) — the provider, tile store, tileset synthesis, `.pnts`
encoding, octree geometry, reprojection — must be Cesium-free plain math, or the
Service Worker build breaks.

If you need a geometric helper that Cesium already provides, port the math
instead of importing it. `src/octree.ts` and `src/reproject.ts` show the pattern:
the WGS84 ellipsoid constants are used directly so the output matches
`Cesium.Cartesian3.fromDegrees` without depending on Cesium.

Other conventions:

- Biome formatting — 2-space indent, double quotes, semicolons, 100 columns.
- TypeScript is strict with `noUncheckedIndexedAccess` and
  `verbatimModuleSyntax` — use `import type` for type-only imports.
- Error messages are prefixed `copc-tileset:`.

A deeper module-by-module tour lives in [AGENTS.md](./AGENTS.md).

## Changing dependencies

Any change to `package.json` dependencies means **regenerating the SBOM**:

```bash
npm run sbom
git add sbom/bom.cdx.json sbom/bom.spdx.json
```

CI's `sbom:check` step fails otherwise. This applies to Dependabot pull requests
too — they bump the lockfile but cannot regenerate the SBOM, so a runtime
dependency bump needs that commit pushed on top of the bot's branch.

Do not remove the `sbom/` exclusion in `biome.json`: reformatting canonical
`npm sbom` output would break the "re-run the command and compare" verification
story. See [SBOM.md](./SBOM.md).

Runtime dependencies are deliberately kept to a minimum (currently `copc`,
`laz-perf` and `proj4`, a 10-package runtime closure). A pull request that adds
one needs to make the case for it.

## Commits and pull requests

Commits **must** follow [Conventional Commits](https://www.conventionalcommits.org/).
A husky `commit-msg` hook runs commitlint, so a malformed message is rejected
locally:

```
feat(pnts): add per-point ScanAngleRank to the batch table
fix(sw): reject range responses that are not HTTP 206
docs: document the Vite plugin on sub-path hosts
```

- Branch off `trunk`. Give the **pull request title** the same Conventional
  Commit form — it becomes the commit message when the PR is squashed.
- **Never bump the version or edit `CHANGELOG.md` by hand.** `semantic-release`
  derives both from commit messages when `trunk` is released, and a manual bump
  will conflict with it.
- Fill in the pull request checklist. It exists so that a review can be about the
  change itself rather than about the build.
- Breaking changes need a `!` (`feat!: …`) or a `BREAKING CHANGE:` footer — that
  is what drives the major version.

## What gets accepted

[ROADMAP.md](./ROADMAP.md) states what this project is for and, just as
importantly, what it is not for. Proposals outside that scope will be closed
with a pointer to it — that is not a judgement of the idea, only of its fit here.
If you think the scope itself should change, open a Discussion first; it is a
cheaper conversation than a rejected pull request.

Changes most likely to be merged quickly: bug fixes with a failing test,
documentation and example improvements, correctness fixes in the octree /
reprojection / `.pnts` math, and support for COPC files that currently fail to
render.

## Maintainers and response times

This project currently has a **single maintainer** (@GyeongHoKim), working on it
outside of a full-time role. Expect an initial response to issues and pull
requests within about a week; a quiet thread is a busy maintainer, not a
rejection — a polite ping after that is welcome.

That single-maintainer setup is a known risk to the project's bus factor. If you
contribute consistently and your changes hold up, you will be offered commit
access; broadening maintainership is an explicit goal, not a reluctant fallback.

## Licensing of contributions

This project is licensed under **AGPL-3.0-or-later**. By submitting a
contribution you agree that it is your own work (or that you have the right to
submit it) and that it will be distributed under that same license. There is no
CLA and no copyright assignment.
