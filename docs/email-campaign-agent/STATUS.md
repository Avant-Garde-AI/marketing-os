# Email Campaign Agent — Build Status

> **Current: 2026-09-08.** The path runs end to end and has sent. Arthaus's
> Labor Day promotion reached 1,612 US contacts; the Shelly Bremmer artist drop
> is scheduled to auto-send to 4,703. Five more campaigns are approved and await
> drafting.
>
> This is the first section to read. The 2026-08-31 capability table has been
> folded into the section below, since every line of it still holds; the
> 2026-07-17 build record is retained verbatim.

## Where it stands (2026-09-08)

### Proven end to end

Plan → author → review → select headline → approve → draft → schedule → send,
with every write through the Slack Action gate. Two campaigns have completed it:
one sent manually from Klaviyo, one scheduled unattended.

| Campaign | Audience | State |
|---|---|---|
| Labor Day promotion | full-reach-us (1,612) | **Sent** — 2 opens, 6 clicks at +1h |
| Shelly Bremmer | full-reach (4,703) | **Scheduled** |
| Botanical, Autumn, 83 Oranges, Benjamin Mckay, Kaethe Butcher | full-reach | approved; draft + schedule outstanding |

### Shipped since 2026-08-31

| Capability | Note |
|---|---|
| `headlineOptions` — three per campaign | Selected in the review room; a campaign is not finished with one unreviewed phrasing |
| `email.approve_campaign` | A directly-authored campaign had **no route to the ESP** — `approve_plan` only walked a calendar |
| `shopify.create_discount_code` | Gated Action, high risk; required end date, percentage capped at 50 |
| Discount verification | A campaign promising a code the store lacks is refused, at approve *and* at draft |
| Audience by roster key | The planner assigns keys, never Klaviyo ids — requiring an id made the agent invent one |
| Block validation at write time | Returns the Zod path; the agent guessed `items` for `products` twice unchallenged |
| Product images + prices from the store | Resolved by handle; the agent knows the handle, never the CDN path |
| White-frame mockup correction | Auto-swaps to black/walnut/oak; warns when the library has none |
| Klaviyo image re-hosting | Every campaign image, not just board exports |
| Month-level review sheet + copy button | One signed link for a whole month |
| Promotion archetype (weight 0) | Exists for authoring; the planner never schedules a sale on its own |

### Known gaps — new (2026-09-08)

1. **No analytics sync.** `klaviyo_performance_read` is a live read-through —
   nothing persists, so sent-campaign metrics are not in the console or the
   semantic layer. Needs a table plus a cron over `campaign-values-reports`.
   The token is confirmed to have report access.
2. **No reference sweep.** Nothing revalidates the ids in `strategy.md`
   against Klaviyo. A `preview-test` segment named there had ceased to exist,
   so the rule guaranteeing a human sees every email pointed at nothing.
3. **Image reachability is not checked at write time.** A single typo'd host
   (`cdn..shopify.com`) failed a draft twice behind undici's bare
   `fetch failed`. The 59-image sweep that found it was run by hand.
4. **Artifacts do not learn that a campaign sent.** Labor Day reads `drafted`
   while Klaviyo says `Sent`. Nothing writes back from the ESP.


### Known gaps — carried over (2026-08-31)

1. **`productRow` caption misalignment** — visible in delivered campaigns. The
   fixed-height band that fixed `graphCallout` has not been applied.
2. **No real prices** — product cards render "View piece" placeholders instead
   of Shopify prices.
3. **Tier-3 scene generation** — every AI Studio key is spend-capped; only the
   account owner can raise it. Tiers 1–2 are unaffected.
4. **The 6 design-system partials are DB-only** — they commit on next write.
5. **`readEmailFile` returns `null` on a DB error**, indistinguishable from
   "not found" — the §4 failure mode of `07`, still live in this pack.
6. **Four older sample campaigns** (`2026-09-*-artist-*`, distinct ids) sit in
   the *platform* DB, not the console's, with flat scans and white-frame
   mockups. Effectively orphaned.
7. **`GITHUB_TOKEN` cannot be retired** — `brand-design.ts`,
   `dispatch-to-github.ts`, `pr-status.ts` and `lib/github.ts` still read it
   directly.

## Build record — 2026-07-17

> First build session. Branch **`feat/email-agent`** in three
> worktrees: this repo, marketing-os-app, marketing-os-hosted-agents (each at
> `.claude/worktrees/email-agent`). Everything below is committed on those
> branches; nothing is deployed, no migration is applied, nothing has touched
> the live Arthaus Klaviyo account.

## Requirement scoreboard

| Req | State | Where / proof |
|---|---|---|
| WS1-R1 provider+Vault | ✅ built | app: migration 006 + `klaviyo-connect.server.ts` (both lanes behind one row shape) |
| WS1-R2 OAuth+key | ✅ built, ⏳ live round-trip | PKCE w/ AES-sealed verifier; **needs the Klaviyo OAuth app (Garrett) or an Arthaus pk_ key** |
| WS1-R3 KlaviyoClient | ✅ built (18/18 fixtures) | hosted: `lib/email/klaviyo-client.ts`; endpoint shapes carry VERIFY flags → run `scripts/verify-klaviyo.ts` against Arthaus |
| WS1-R4 template/audience reads | ✅ | pack tools + universal-content inlining (fixture-tested; in-HTML block syntax is a documented uncertainty) |
| WS1-R5 conversion metric | ✅ | resolve at connect; ambiguous → stored candidates for the WS4 picker |
| WS1-R6 performance read | ✅ | attribution basis stated in every payload |
| WS2-R1 multi-board | ✅ **canary 21/21 live** | design-surfaces; absolute-coord finding pinned by test |
| WS2-R2 compose templates | ✅ | pack `compose-templates.ts` (hero/promo/product/editorial, tokens→BoardSpec) |
| WS2-R3 skeleton extraction | ✅ (27 tests) | email-assembly `extract.ts`; Arthaus real-template extraction awaits WS1 creds |
| WS2-R4 assembly | ✅ (byte-deterministic, golden) | email-assembly; all 04 §6 invariants mechanical |
| WS2-R5 QA matrix | 🟡 harness ready | `qa/README.md` — **human render pass needed** |
| WS2-R6 scaffold (06) | ✅ | `scaffoldEmailSystem` — the Arthaus `emails/` pattern; answers PRD §8 Q5 |
| WS3-R1 Action framework | ✅ built | gate in app (005: atomic nonce, audit incl. refused), runtime in hosted; legacy paths refactored, risk=high confirm. E2E click-through needs a deploy |
| WS3-R2 artifacts | ✅ | + `registry.json` (06 §4) |
| WS3-R3 planning reads | ✅ | pure, deterministic, guardrail-honest |
| WS3-R4 drafting | ✅ runtime wiring | assemble binding, email_render_preview, preview route; live Arthaus dev-run pending creds |
| WS3-R5 four Actions | ✅ (20 tests incl. invalidation matrix) | pack + registered in hosted; **Arthaus e2e on test segment pending** |
| WS3-R6 cron | ✅ built | `/api/cron/email` on the shared frame (H7); rituals (weekly/monthly cards) TODO — needs the Slack card seam |
| WS3-R7 enablement + skill-kit | ✅ | H1.2 gate (fails closed); both packs on skill-kit |
| WS4-R1 migrations + projection | ✅ written, ⏳ apply | 005/006/007 + drafted 004 — **apply together to prod Supabase (Garrett)**; backfill script ready |
| WS4-R2 calendar | ✅ | template `/calendar`; channel-agnostic (grep-provable) |
| WS4-R3 campaign detail + preview | ✅ | + REVISIT gallery-renderer gap fixed |
| WS4-R4 skills page + connect | ✅ | H1.2 enforced server-side; connect-key auth-lane mismatch documented |
| WS4-R5 Email Recap | ✅ pack `reports` export | cron scheduling rides spec 19 as-built |
| WS4-R6 template bump + Arthaus PR | 🟡 in progress | v0.16.0 bump prepared this session; upgrade PR is the next session's first move |

## The gate before "done" (PRD §3 exit demo)

Blocked exclusively on Garrett-owned externals, in order:
1. **Credentials**: create the Klaviyo OAuth app (KLAVIYO_CLIENT_ID/SECRET on
   marketing-os-app) *or* mint an Arthaus custom-scoped `pk_` key and connect
   via the key lane.
2. **Migrations**: apply 004+005+006+007 to prod Supabase (one set).
3. **Env**: `ACTIONS_GATE_SECRET` on marketing-os-app + hosted-agents (+ the
   Arthaus console once upgraded); confirm `MARKETING_OS_API_URL`,
   `MOS_AGENTS_PUBLIC_URL` where the new routes need them.
4. **Deploys**: hosted-agents + (after the upgrade PR) the Arthaus console —
   CLI from verified checkouts.
5. **Live smoke**: `scripts/verify-klaviyo.ts` against Arthaus (the endpoint
   VERIFY flags), then skeleton ingestion of a real Arthaus template, then the
   exit demo on a small internal segment.

## Honest gaps (not blockers, tracked)
- Gate invariants (nonce replay, refused-approver) are enforced by atomic SQL
  + structure but have no automated tests — neither sibling repo has a test
  framework; `demo.echo` (ACTIONS_DEMO=1) exists for a live gate validation.
- Weekly/monthly ritual cards (WS3-R6 second half) need the Slack failure/
  ritual card seam (H7 TODO); queue data is already in `mos_calendar_items`.
- Console approve (WS4 OQ3) deliberately Slack-only; console shows state.
- `marketing-os upgrade --yes` (H8.2) untouched — hand-drive the Arthaus PR
  (the PR #26 pattern) unless fixed first.
- Klaviyo connect-key route authenticates via the embedded admin session; the
  template's paste-proxy will 401 until a deployment-key lane is added
  (documented in the proxy header) — the integrations-page path works.
