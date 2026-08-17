# Security Policy

## Supported versions

Only the latest minor release published to npm receives security fixes. There
are no long-term-support branches.

| Version | Supported |
|---|---|
| 1.1.x | ✅ |
| < 1.1 | ❌ — upgrade to the latest release |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

1. **Preferred** — use GitHub's private vulnerability reporting:
   [Report a vulnerability](https://github.com/GyeongHoKim/copc-tileset/security/advisories/new).
   The report stays private until a fix is published, and the fix can be
   developed in a private fork.
2. **Alternative** — email **me@gyeongho.dev**. Put `copc-tileset` in the
   subject line.

Useful things to include: affected version, the COPC URL or crafted input that
triggers it, browser and bundler, a proof of concept, and the impact you believe
it has. Reports without a reproduction take much longer to act on.

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement of your report | within 3 business days |
| Initial assessment (valid / not / severity) | within 7 business days |
| Fix released for a confirmed vulnerability | as soon as practical; typically within 30 days |

Fixes are published as a normal npm release and disclosed through a
[GitHub Security Advisory](https://github.com/GyeongHoKim/copc-tileset/security/advisories).
Reporters are credited by name or handle unless they ask not to be.

This is a volunteer-maintained project: there is no bug bounty and no monetary
reward.

## Scope

This library runs entirely in the browser — a Service Worker plus a Cesium
primitive. It has no server component and stores no credentials of its own,
which shapes what is and is not a vulnerability here.

**In scope**

- Injection or SSRF-style abuse through the virtual URL scheme
  (`src/sw/scheme.ts`) — e.g. crafting a virtual tile path that makes the
  Service Worker fetch an unintended origin.
- Service Worker scope or cache problems: intercepting or poisoning requests
  that do not belong to the library, or serving one COPC source's tiles for
  another.
- Leaking authentication material supplied via `CopcProvider` `options.headers`
  (see [docs/authentication.md](./docs/authentication.md)) to an unintended
  origin, into logs, or into cached responses.
- Memory-safety or denial-of-service issues reachable by pointing the library at
  a **malformed or hostile `.copc.laz` file** — an unbounded allocation from a
  crafted header, an infinite loop in hierarchy walking, and the like.
- Known vulnerabilities in the runtime dependency closure (`copc`, `laz-perf`,
  `proj4` and their transitive dependencies).

**Out of scope**

- Misconfiguration of *your own* COPC host — permissive CORS, public buckets,
  signed URLs with an over-long lifetime, missing range-request support.
- The inherent consequence of putting a URL in client-side code: anything the
  browser fetches is visible to the user. Protect data at the origin serving it.
- Vulnerabilities in CesiumJS or in browsers themselves. Report those upstream;
  if the issue is that this library *uses* them unsafely, that is in scope.
- Findings from an automated scanner with no demonstrated impact on this
  library's own code paths.
- Advisories in build-time-only tooling (`devDependencies`) with no demonstrated
  path to the published artifacts, the release credentials, or a maintainer's
  machine. CI reports these without failing the build. A build-tree advisory that
  *does* have such a path — a compromised bundler writing into `dist/`, anything
  reaching the release workflow's tokens — is in scope, so report it.

## What we already do

- **SBOM on every release** in CycloneDX 1.5 and SPDX 2.3, generated from the
  lockfile by `npm sbom` itself — see [SBOM.md](./SBOM.md).
- **Weekly OSV scanning** of both the runtime closure and the full build tree
  (`.github/workflows/security.yml`), plus on every push and pull request.
  A vulnerability in the **runtime** closure fails the build, because it would
  ship to users; build-tree findings are reported to the Security tab without
  blocking.
- **Dependabot** updates for npm dependencies and GitHub Actions.
- **Tokenless npm publishing** via OIDC trusted publishing with provenance, and
  `npm audit signatures` on every release, so there is no long-lived npm token
  to steal.
