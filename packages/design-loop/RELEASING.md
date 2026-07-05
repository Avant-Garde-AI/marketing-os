# Releasing `@avant-garde/design-loop`

Central, bench-gated releases; clients pull on their own schedule (PRD §7).

## Cadence & trigger

- **Weekly** bench-gated run (CI cron, Mondays) — see `.github/workflows/design-loop-release.yml`.
- **On demand** — push a `design-loop-v<semver>` tag, or run the workflow with `publish: true`.

## The gate (blocks the release)

Every release runs the full bench and applies `design-loop-release-gate`:

- **a11y zero-tolerance** — any failing a11y case blocks, unconditionally.
- **No regressions** — a case that passed in the previous release (`release/baseline.json`) re-failing blocks, unconditionally.
- **Threshold** — other new failures block once over `maxAllowedFailures` (default 0).

On a pass the baseline is updated and the bench report (`release/bench-report.md`) is published as a CI artifact with headline deltas. Nothing auto-mutates a client environment.

## Versioning & pinning

Three versions move independently; each client deployment pins all three and upgrades on its own schedule:

- **agent** — `@avant-garde/design-loop` (this package)
- **skill-set** — the design skill-set (`DESIGN_SKILLSET_VERSION`, pulled at session start)
- **MCP snapshot** — the Design MCP knowledge snapshot (`DESIGN_MCP_SNAPSHOT`)

All three are stamped on every `WorkReport.versionVector` and every emitted trace, so outcomes are attributable to an exact `agent × skill-set × MCP snapshot × brand-doc` combination. Compatibility is expressed in the release manifests.

## Staged rollout

1. **Canary cohort first** — the new version is exercised against internal + friendly stores before it is recommended fleet-wide. **Arthaus is the first canary** (the first end-to-end target). Client environments can't be benched directly, so the cohort is the integration test.
2. **Recommended signal** — once the canary validates, the version is marked recommended with a changelog; clients choose when to pull/pin it.

## Publishing (manual until the npm token is wired)

```bash
pnpm --filter @avant-garde/design-loop build   # prepublishOnly also runs this
cd packages/design-loop && npm publish --access public --provenance
```

The CI `Publish to npm` step does this automatically on a tag (gated by the bench) when `NPM_TOKEN` is set.
