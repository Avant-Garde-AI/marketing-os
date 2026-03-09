# 10 — Implementation Plan

> Marketing OS · Open Conjecture · March 2026

---

## 1. Build Order

This plan is designed for a coding agent to execute sequentially. Each phase has clear inputs, outputs, and validation criteria. Do NOT skip phases or build out of order.

---

## Phase 0: Monorepo Bootstrap

**Goal**: Set up the monorepo with pnpm workspaces, turborepo, and the empty package structure.

### Tasks

1. Initialize the repo: `git init`, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`
2. Create `tsconfig.base.json` with strict TypeScript config (ESM, strict, Node20 target)
3. Create `packages/create-marketing-os/` with `package.json`, `tsup.config.ts`, `tsconfig.json`
4. Create `packages/skills/` directory with `README.md`
5. Create `examples/demo-store/` with a minimal Shopify theme structure (Dawn skeleton)
6. Create `.github/workflows/ci.yml` for PR checks
7. Create root `.eslintrc.js`, `.prettierrc`, `.gitignore`
8. Create `LICENSE` (MIT), `README.md`, `CONTRIBUTING.md`
9. Run `pnpm install` and verify `pnpm turbo build` succeeds (empty build is ok)

### Validation

- [ ] `pnpm install` succeeds
- [ ] `pnpm turbo build` succeeds
- [ ] TypeScript compilation works with strict mode
- [ ] CI workflow would pass (lint, typecheck)

---

## Phase 1: Template Files

**Goal**: Create all the template files that the CLI will copy during scaffolding. These are the actual source files for the Marketing OS console.

### Tasks

1. Create the `/agents` template directory structure under `packages/create-marketing-os/templates/agents/`
2. Create all static template files (`.ts`, `.tsx`, `.css`, `.json` — no variable interpolation):
   - `app/page.tsx` (dashboard)
   - `app/chat/page.tsx`
   - `app/skills/page.tsx`
   - `app/activity/page.tsx`
   - `app/login/page.tsx`
   - `app/globals.css`
   - `app/api/chat/route.ts`
   - `app/api/skills/[skillId]/route.ts`
   - `app/api/webhooks/github/route.ts`
   - `middleware.ts`
   - `next.config.ts`
   - `tailwind.config.ts`
   - `tsconfig.json`
   - `postcss.config.mjs`
   - `vercel.json`
   - All `components/` files (skill-card, pr-card, metric-card, nav, marketing-chat)
   - All `components/ui/` shadcn primitives (button, card, input, badge, dialog, tabs)
   - All `lib/` files (supabase client/server/middleware, github, skills, utils)
   - All `src/mastra/tools/` files
   - All `src/mastra/agents/` files (creative-agent.ts static portion)
   - All `src/mastra/workflows/` files
   - All `src/mastra/skills/` starter skills (store-health-check, ad-copy-generator, weekly-digest)
3. Create all Handlebars template files (`.hbs` — with variable interpolation):
   - `app/layout.tsx.hbs` (store name in title)
   - `src/mastra/index.ts.hbs` (Supabase config)
   - `src/mastra/agents/marketing-agent.ts.hbs` (store context in instructions)
   - `src/mastra/tools/dispatch-to-github.ts.hbs` (repo name)
   - `src/mastra/skills/_registry.ts.hbs` (skill imports)
   - `components/header.tsx.hbs` (store name)
   - `lib/supabase/client.ts.hbs` (Supabase URL)
   - `lib/supabase/server.ts.hbs` (Supabase URL)
   - `package.json.hbs` (store name in package name)
   - `.env.example.hbs` (documented vars)
4. Create the `/docs` templates: `brand-voice.md.hbs`, `product-knowledge.md.hbs`, `policies.md.hbs`
5. Create the GitHub workflow templates: `marketing-os-agent.yml.hbs`, `marketing-os-review.yml`
6. Create `CLAUDE.md.hbs` and `marketing-os.config.json.hbs`

### Validation

- [ ] Every file referenced in `04-SCAFFOLD-SPEC.md` exists in the templates directory
- [ ] `.hbs` files contain valid Handlebars syntax with `{{variable}}` placeholders
- [ ] Static `.ts`/`.tsx` files compile when type-checked in isolation
- [ ] The `package.json.hbs` template contains all dependencies from `04-SCAFFOLD-SPEC.md`

---

## Phase 2: CLI Core

**Goal**: Build the CLI binary that orchestrates the interactive setup and scaffolding.

### Tasks

1. Create `src/index.ts` — Commander.js program with `init` and default commands
2. Create `src/utils/logger.ts` — chalk + ora based logging utilities
3. Create `src/scaffold/detect-theme.ts` — Shopify theme detection logic
4. Create `src/scaffold/render-template.ts` — Handlebars template rendering
5. Create `src/scaffold/write-files.ts` — File creation with conflict detection
6. Create `src/scaffold/install-deps.ts` — Package manager detection + install
7. Create `src/scaffold/index.ts` — Orchestrator that calls the above in sequence
8. Create `src/prompts/store.ts` — Store connection prompts (Inquirer)
9. Create `src/prompts/services.ts` — API key + Supabase prompts
10. Create `src/prompts/integrations.ts` — Integration selection prompts
11. Create `src/prompts/deploy.ts` — Vercel deployment prompts
12. Create `src/services/github.ts` — `gh` CLI interactions (create repo, set secrets)
13. Create `src/services/vercel.ts` — `vercel` CLI interactions (link, deploy)
14. Create `src/services/supabase.ts` — Supabase project validation
15. Create `src/services/shopify.ts` — Shopify CLI interactions (theme pull)
16. Create `src/utils/validate.ts` — API key format validation
17. Create `src/utils/config.ts` — marketing-os.config.json reader/writer
18. Create `src/commands/init.ts` — `init` subcommand (scaffold into existing repo)
19. Create `src/commands/create.ts` — Default interactive flow
20. Create `src/commands/add-skill.ts` — Scaffold a new skill file
21. Create `src/commands/doctor.ts` — Validate existing installation
22. Wire everything together in `src/index.ts`
23. Test: `pnpm --filter create-marketing-os build` succeeds
24. Test: `node dist/index.js --help` prints usage

### Validation

- [ ] `pnpm turbo build` succeeds
- [ ] `node packages/create-marketing-os/dist/index.js --help` prints CLI help
- [ ] `node packages/create-marketing-os/dist/index.js --version` prints version
- [ ] Running with `--yes` flag and mock inputs scaffolds files into a temp directory

---

## Phase 3: Integration Test

**Goal**: End-to-end test that scaffolds into the demo store and verifies the output builds.

### Tasks

1. Create `examples/demo-store/` with a minimal valid Shopify theme (Dawn skeleton: layout/theme.liquid, config/settings_schema.json, templates/index.json, etc.)
2. Write an integration test script that:
   - Copies `examples/demo-store/` to a temp directory
   - Runs the CLI with `--yes` flag and test values
   - Verifies all expected files were created
   - Runs `npm install` inside the scaffolded `/agents`
   - Runs `npx next build` (or `npm run build`) to verify the Next.js app compiles
3. Add this test to `packages/create-marketing-os/test/integration.test.ts`
4. Add it to the CI workflow

### Validation

- [ ] Integration test passes: scaffold → install → build succeeds
- [ ] All template variables are resolved (no `{{...}}` in output files)
- [ ] The Next.js build produces a valid `.next` output
- [ ] TypeScript compilation has zero errors

---

## Phase 4: Starter Skills

**Goal**: Implement the three starter skills with real (or realistic mock) functionality.

### Tasks

1. Implement `store-health-check.ts` — calls Shopify Admin API, computes metrics, returns structured report
2. Implement `ad-copy-generator.ts` — reads brand voice from context, generates multiple copy variants using the creative agent
3. Implement `weekly-digest.ts` — aggregates weekly data, formats as a digest report
4. Update `_registry.ts` to properly import and export all three
5. Test each skill's Zod schemas (input validation, output shape)
6. Test that the skills page renders cards correctly from the registry

### Validation

- [ ] Each skill has valid `metadata`, `inputSchema`, `outputSchema`, and `tool` exports
- [ ] Zod schemas have `.describe()` on all fields (for AutoForm generation)
- [ ] Skills execute without errors when given valid mock inputs
- [ ] The skill registry correctly lists all three skills

---

## Phase 5: Polish and Publish

**Goal**: Prepare for npm publish and initial release.

### Tasks

1. Write comprehensive `README.md` for the monorepo root (with demo GIF/video placeholder)
2. Write `CONTRIBUTING.md` with skill contribution guidelines
3. Write `packages/create-marketing-os/README.md` (npm package README)
4. Add `@changesets/cli` and configure for releases
5. Create `.github/workflows/publish.yml` for npm publishing
6. Create `.github/workflows/integration-test.yml` for E2E tests on PRs
7. Test the full flow: `npx create-marketing-os --yes` with mock services
8. Tag v0.1.0 release

### Validation

- [ ] `pnpm changeset publish` would succeed (dry-run)
- [ ] README has clear install instructions and quick-start guide
- [ ] All CI checks pass
- [ ] The package can be installed via `npx create-marketing-os --help`

---

## 2. Agent Instructions

When a coding agent works on this project, it should:

### Do

- Read the relevant spec document BEFORE writing any code for that component
- Use the exact file paths and names specified in the specs
- Use the exact dependency versions and package names specified
- Write TypeScript in strict mode with explicit types
- Follow the Handlebars template convention (`.hbs` suffix for interpolated files)
- Test each phase's validation criteria before moving to the next phase
- Commit after each completed phase with a descriptive message

### Don't

- Skip phases or build components out of order
- Add dependencies not specified in the specs without justification
- Use CommonJS (`require`) — ESM only
- Create a monolithic file — follow the modular structure specified
- Hardcode values that should be template variables
- Forget the `#!/usr/bin/env node` banner in the CLI entry point
- Use `localStorage` or browser-only APIs in server components

### Key Technical Gotchas

1. **Handlebars in TypeScript**: Use the `handlebars` package to render `.hbs` templates. The CLI reads the template file, compiles it, and writes the rendered output (without the `.hbs` extension) to the target directory.

2. **Next.js App Router**: All pages under `app/` use the App Router convention. Server Components by default. Mark `"use client"` only when hooks or interactivity is needed.

3. **Mastra external packages**: The `next.config.ts` MUST include `serverExternalPackages: ["@mastra/*"]` or the build will fail.

4. **shadcn/ui components**: These are copied as source files into `components/ui/`, not installed as packages. Use the shadcn CLI to generate them initially, then include them as static template files.

5. **assistant-ui**: This is an npm package (not copied source). It must be in `package.json` dependencies.

6. **Supabase SSR**: Use `@supabase/ssr` for server-side auth in Next.js middleware. Do NOT use `@supabase/auth-helpers-nextjs` (deprecated).

7. **Template file paths**: When the CLI renders templates, the output path strips the `.hbs` extension. So `app/layout.tsx.hbs` becomes `app/layout.tsx` in the target directory.

8. **The CLI `bin` field**: The `package.json` `bin` field must point to `./dist/index.js`. The `tsup` build adds the `#!/usr/bin/env node` shebang via the `banner` option.

---

## 3. Milestone Summary

| Phase | Deliverable | Estimated Effort |
|-------|------------|-----------------|
| Phase 0 | Monorepo scaffold | 1–2 hours |
| Phase 1 | All template files | 4–6 hours |
| Phase 2 | CLI binary | 4–6 hours |
| Phase 3 | Integration test | 2–3 hours |
| Phase 4 | Starter skills | 2–3 hours |
| Phase 5 | Polish + publish | 2–3 hours |
| **Total** | **v0.1.0 release** | **15–23 hours** |

---

## 4. Future Phases (Post v0.1.0)

| Phase | Description |
|-------|------------|
| v0.2 | GA4 + Meta Ads tool implementations with real API calls |
| v0.3 | Community skill registry (npm-based distribution) |
| v0.4 | Multi-store agency dashboard (shared Supabase with RLS per store) |
| v0.5 | In-console skill browser with one-click install |
| v1.0 | Production-stable release with full documentation site |
