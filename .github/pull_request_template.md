<!--
Thanks for contributing! A few notes before you submit:

- The PR title must be a Conventional Commit (`feat(pnts): …`, `fix(sw): …`,
  `docs: …`) — it becomes the commit message when this is squashed, and
  semantic-release derives the next version from it.
- Do not bump the version or edit CHANGELOG.md; that is automated.
- See CONTRIBUTING.md if anything below is unclear.
-->

## What does this change?

<!-- What problem does it solve, and how? Keep the "why" — the diff shows the "what". -->

Closes #

## How was it verified?

<!--
Which datasets did you try, in which browser? A before/after screenshot is worth
a lot for anything that changes what is on screen.
-->

## Checklist

- [ ] The PR title follows [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] `npm run check` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (unit tests stay **offline** — anything hitting the network went into `*.integration.test.ts`)
- [ ] No `cesium` import was added to any module reachable from `src/sw/copc-sw.ts` (only `src/CopcPointCloudPrimitive.ts` may import Cesium)
- [ ] Dependencies changed? → ran `npm run sbom` and committed `sbom/bom.cdx.json` + `sbom/bom.spdx.json`
- [ ] Public API or behaviour changed? → updated `README.md` and the relevant guide in `docs/`
- [ ] Breaking change? → the title uses `!` or the body has a `BREAKING CHANGE:` footer
