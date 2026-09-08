# Arthaus console — constraints for coding agents

Scoped to `agents/`. The repo root `CLAUDE.md` still applies; this adds what was
learned driving the September 2026 email campaigns from plan to sent, where a
dozen things looked correct and were not.

Read `docs/email-campaign-agent/08-HOSTED-VS-SELF-HOSTED.md` in the
`marketing-os` repo for the architecture. This file is the operating rules.

---

## Apply every change in two repos

This console is a **copy** of `marketing-os/packages/marketing-os/templates/agents/`,
not a dependency of it. A fix landed here alone is lost at the next upgrade; a
fix landed only in the template never reaches Arthaus.

```
1. edit  arthaus/platform/marketplace/agents/…
2. copy  → marketing-os/packages/marketing-os/templates/agents/…
3. commit + push BOTH
4. npx vercel deploy --prod --cwd agents     (from a clean checkout, see below)
```

**Never blanket-copy console → template.** The template's
`src/mastra/tools/external-mcp.ts` carries a *better* implementation than this
console's (stateless HTTP, because `MCPClient` dies against stateless MCP
servers). A blind copy deleted 227 lines of it. Before committing the template:

```bash
git diff --numstat | awk '$2 > $1 && $2 > 20'   # deletions dominating = look closer
```

**Deploy from a clean checkout of `origin/main`,** not the working tree —
sibling sessions leave uncommitted work, and `vercel deploy` ships the working
tree, not the commit.

---

## Verify against the system, never the transcript

The agent will tell you it did something it did not do. Both happened here:

- asked to **replace** two pieces, it **appended** three and left the broken
  ones in place — twice;
- once it researched for five steps and ended the turn having never called
  `email_campaign_upsert` at all. No error. Just no write.

So: after any agent-driven change, `git show origin/main:<artifact>` and read
it. After any Action, read `mos_action_audit` on the platform DB. The tool
transcript is a claim; the artifact is evidence.

---

## Where to look when an Action "does nothing"

`mos_action_audit` on the **platform** Postgres holds the outcome and the error
text. It is the only place a failed Action explains itself, and it had the exact
cause of three failures while I theorised about a broken gate. The gate was
never broken.

```sql
select kind, outcome, at, detail from mos_action_audit order by at desc limit 5;
```

`ACTIONS_GATE_SECRET` lives only in Vercel env on both sides, so you cannot call
`/api/actions/execute` yourself to "just finish it".

---

## Credentials: ask the token, do not infer it

`SHOPIFY_ACCESS_TOKEN` in `.env.local` is **not** what production uses.
`MARKETING_OS_API_URL` + `MARKETING_OS_API_KEY` are set, so
`resolveAccessToken()` takes the **broker** branch. That env token belongs to a
different Shopify app entirely.

To find out what is really in play:

```ts
runWithTenant({shop, storeSlug}, async () => {
  const c = getShopifyClient();
  await c.graphql(`{ currentAppInstallation { app { title } accessScopes { handle } } }`);
});
```

And know that **an app's declared scopes ≠ an installation's granted scopes**.
`shopify app deploy` changes what is *requested*; the install keeps its old
grant until re-authorized in the Shopify admin.

---

## Pin the API revision before probing

`lib/email/klaviyo-client.ts` pins `revision: 2026-07-15`. Probing Klaviyo with
a different revision returns **opposite answers about the same fields**: at
`2024-10-15` a campaign-message wants `channel`/`label`/`content` flat and
rejects `definition`; at the pinned revision `definition` is required. I probed
with the wrong one, "fixed" a working field into a broken one, and cost two
approval cycles.

Probe with `KLAVIYO_REVISION` or do not probe.

---

## Errors must name their subject

`fetch failed` is undici's message for every DNS and transport failure — no URL,
no cause. It reached the approval audit verbatim and hid a one-character typo
(`cdn..shopify.com`) through two cycles. Any fetch over caller-supplied URLs
gets wrapped, and the URL goes into the message.

More generally: **"no data" and "could not reach the data" are different
verdicts.** A missing scope must never render as a missing discount; an
unreachable Klaviyo must never render as an unknown audience. Degrade loudly,
and say which of the two it was.

---

## Validate references, because they rot

Everything below shipped, passed human review, and broke later:

- `strategy.md` named a `preview-test` segment Klaviyo no longer had — the rule
  guaranteeing a human sees every email pointed at nothing;
- a campaign named a discount code that did not exist, addressed to 4,703
  people;
- an audience id (`XyZ123`) the agent invented because the schema demanded one
  it could not know;
- an image host with a doubled dot.

When you add a field that names an external thing, add the check that it still
resolves — at write time *and* at the gate before send.

---

## Audiences: never hand-write Klaviyo condition JSON

`lib/email/segments.ts` is the only thing that writes segment definitions, and
`klaviyo.create_segment` is the only thing that creates them. Both exist because
a wrong audience is the least visible failure in this system — it does not
error, it produces a number, and a segment matching the wrong 400 people looks
exactly like one matching the right 400.

The shapes were probed live on 2026-09-08; three of five plausible guesses were
refused, and one wrong guess was **accepted silently**:

| want | shape |
|---|---|
| on a list | `profile-group-membership`, one `group_ids` entry per condition, LISTS only |
| country | `properties['$country']` (stored back as `location['country']`) |
| ever did X | `timeframe_filter: {type:"date", operator:"alltime"}` — not `null` |
| did X lately | `{type:"date", operator:"in-the-last", quantity, unit}` — not `type:"relative"` |
| did X on ONE campaign | `metric_filters:[{property:"$message", filter:{…value: <26-char ID>}}]` — no `type` key |

That last row is the dangerous one. `property: "Campaign Name"` with the human
title is accepted and matched **0** profiles where `$message` with the ID
matched **46**. The compiler rejects a non-ULID there for exactly this reason.

Groups are AND'd; conditions within a group are OR'd. Getting it backwards once
produced a "full reach" segment of three people.

To read an audience rather than write one, use `klaviyo_audience_explain` — the
rule in English plus the count. Do this before reusing any segment you did not
create; `klaviyo_audiences_read` gives names and sizes, which is enough to pick
one and not enough to check it.

`additional-fields` is refused on collection endpoints, so counts and
definitions come one segment per request. And Klaviyo evaluates a segment only
**after** it exists — no approval card can honestly show a size beforehand.

---

## Store-specific facts

- **Prices are hidden.** `showPrices: false` in `email/strategy.md`; the store
  sells across currencies, so one figure in a broadcast is wrong for most
  readers. Never re-enable without asking.
- **Leaning-frame mockups are the default imagery** and the store's best asset.
  The `--white--` colourway is broken (frame invisible, art appears to float);
  `lib/email/leaning-mockups.ts` swaps it for black/walnut/oak automatically and
  warns when the library has no alternative. ~24% of leaning mockups are white
  and about a quarter of artworks have no other colourway.
- **`leaning-studio` is an acceptable fallback** when an artwork has no framed
  leaning mockup (decided 2026-09-08). Several of Kaethe Butcher's key pieces —
  `a-hug-in-the-garden`, `into-the-sun` — exist only as studio shots. Prefer a
  framed colourway when one exists; use studio rather than dropping the piece.
- **Mockups are Shopify *files*, not product media.** They never appear on a
  product's `media` connection, and the frame colour lives only in the filename.
  Shopify's file search is fuzzy — `alien-1-leaning` also returns
  `alien-10-leaning`; match the handle exactly.
- **Audiences are named by roster key**, never by Klaviyo id. `full-reach`
  (4,703), `full-reach-us` (1,612), `newsletter`. `strategy.md` is the authority.
- **The store timezone is BST**; campaign `scheduledAt` values are mixed
  `-04:00`/`-05:00` and should be normalised one day.

---

## The gates, and what each one is for

Do not add another without a reason this list does not cover.

| gate | refuses |
|---|---|
| `email_campaign_upsert` | blocks that will not render; audiences the roster cannot complete; white mockups (corrects them) |
| `email.approve_campaign` | a campaign promising a code the store lacks; warns on a past send date |
| `klaviyo.create_campaign_draft` | anything not `approved`; re-checks the discount; re-hosts every image onto Klaviyo |
| `klaviyo.schedule_campaign` | **the first step that sends with nobody watching** |
| `klaviyo.create_segment` | audiences whose rule Klaviyo would refuse; warns on a duplicate name |
| review room | can select a headline; **cannot approve** — a token proves possession of a link, not identity |
