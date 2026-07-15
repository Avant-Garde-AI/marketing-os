# Managed Penpot — Design Surfaces infrastructure (spec 23)

The platform-managed Penpot instance behind the Design Surface layer.
`docker-compose.yaml` is the DS0/local stack; `docker-compose.upstream.yaml` is
the pristine upstream file kept for diffing on upgrades (spec 23 §8).

## Boot (local)

```bash
cd infra/penpot
docker compose up -d
# backend takes ~20s (JVM); UI at http://localhost:9001
```

## Bootstrap the service account (once per instance)

```bash
cd packages/design-surfaces
npx tsx src/cli.ts bootstrap --password '<strong password>'
# → prints { profileId, accessToken, defaultTeamId } — accessToken shows ONCE.
export PENPOT_ACCESS_TOKEN=…           # → Vault in production
export PENPOT_SERVICE_EMAIL=svc@marketing-os.local
export PENPOT_SERVICE_PASSWORD=…       # → Vault; REQUIRED for the export lane
                                       #   (the exporter authenticates with a
                                       #   minted session, not the access token)
```

## Provision a tenant

```bash
npx tsx src/cli.ts provision-tenant arthaus --invite owner@store.com:admin
```

Idempotent: team `tenant-arthaus` + a "Design Surfaces" project.

## Prove the chain

```bash
npx tsx src/cli.ts demo arthaus            # compose → import → export PNG
npx tsx scripts/demo-arthaus.ts            # same, with REAL Arthaus DESIGN.md tokens
PENPOT_CANARY=1 pnpm test:canary           # the spec 23 §8 conformance suite
```

## Upgrading Penpot (the §8 discipline — we are self-supported, D4)

1. `curl -sL https://raw.githubusercontent.com/penpot/penpot/main/docker/images/docker-compose.yaml -o docker-compose.upstream.yaml` and diff for config renames (2.8 and 2.12 both renamed things).
2. Bump `PENPOT_VERSION` in a scratch env, boot, run the canary suite against it.
3. Canary green → adopt the pin. Canary red → the failing test names exactly which internal dependency moved.

## Production notes (parked — REVISIT.md item 1)

- Needs an always-on Docker host (Fly/Railway/VM + Helm) — NOT Vercel-deployable.
- Flip the flag set to the PRODUCTION block documented in docker-compose.yaml
  (disable registration, OIDC-only humans, secure cookies, prepl internal-only).
- The exporter's `PENPOT_PUBLIC_URI` must point at the internal frontend
  service; the adapter rewrites returned asset URIs to the public origin.
- Embedded canvas (DS4) additionally needs the per-tenant proxy alias +
  `frame-ancestors` injection (spec 23 §3 D2).
