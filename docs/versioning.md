# Versioning

ff-server and ff-site each have a version, `MAJOR.MINOR.PATCH`, shown in the site's
footer and at `GET /api/version`. It comes from git tags, not `package.json`
(which stays at `1.0.0` and is not used).

## How it's computed

A release is an annotated tag `vMAJOR.MINOR.PATCH`. The version of any commit is
the nearest tag, plus one patch for every commit since it (`git describe`):

| `git describe` says  | Version  |
| -------------------- | -------- |
| `v1.1.0-0-g3fa9c2e`  | `1.1.0`  |
| `v1.1.0-14-g3fa9c2e` | `1.1.14` |
| after a `v1.2.0` tag | `1.2.0`  |

So **patches are automatic**: every merge to `main` is a new number. A new minor or
major tag zeroes what follows it. Locally, uncommitted changes add `-dirty`.

## Bumping minor or major

Put **`[minor]`** (a feature you'd announce) or **`[major]`** (a breaking change) in
the PR's **title or description**. When the PR merges to `main`, the `version` job
in `.github/workflows/deploy.yml` (`scripts/tag-release.sh`) pushes the next tag,
and `deploy` builds with it. `[major]` beats `[minor]`; neither means a patch.

- The brackets are required (`[minor]`, case-insensitive). Text inside HTML comments
  is ignored, which is how the PR template mentions the markers safely.
- Both repos version separately: a feature spanning both needs the marker in both PRs.
- A `[skip ci]` commit skips the whole workflow, tagging included.
- Forgot the marker? Tag by hand: `git tag -a v1.2.0 -m "1.2.0 - what shipped" <commit>
  && git push origin v1.2.0`. Tagging an older commit renumbers everything after it;
  no history is rewritten.

## Where the version lives

- **Deployed build:** `scripts/write-version.mjs` (run by `scripts/deploy-nfsn.sh`
  after `tsc`) writes `dist/version.json`, because the host has no git. CI checks
  out with `fetch-depth: 0` so the tags are there.
- **Dev:** `src/utils/version.ts` asks `git describe` once at startup.
- **ff-site** computes the same thing at build time (`next.config.ts`); keep
  `parseDescribe` in `src/utils/version.ts` and ff-site's `src/lib/version.ts`
  identical.

Tags older than this scheme: `v1.0.0` (live at vortox.space, 2026-11-05 12:46 PM
CST), `v1.0.1`, `v1.1.0` (avatar uploads).
