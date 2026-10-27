# Email autopilot: rolling two-week batches under a standing grant

Owner request, 2026-10-21: one week before each two-week email window, an agent
authors the window's campaigns from the store's strategy, stages them, and
notifies Slack. Sends go out unless someone holds them within **48 hours**.
Owners can still open the calendar from Claude Code over the store MCP and change
it the way they do today.

This is the email half of the standing-authority work described in
[`storyboard-harness/SOCIAL-AUTOPILOT.md`](storyboard-harness/SOCIAL-AUTOPILOT.md).
The platform pieces (grant, delegated release, hold/pause, digest) are
channel-generic so social can use them.

## The invariant, restated

Reads compose freely. Writes narrow through one gate. Autopilot does not add a
second path:

- **A human grants the policy once, through the gate.** `autopilot.grant` is an
  app-executed Action. Its card shows the exact policy and its hash, and
  approving it records the real approver. No file, config flag or model-callable
  tool can create a grant.
- **Every write is still a proposal row that `decideAction()` executes.** A
  delegated proposal carries `grant_id`. The platform, not the runtime, decides
  whether it may release, and it releases with actor `grant:<id>` so the audit
  log separates delegated decisions from human ones.
- **The model never holds authority.** The authoring agent can only write
  campaign artifacts (`email_campaign_upsert`) and render previews. A
  deterministic stager in the runtime chooses what to propose, checks it
  against the policy, and attaches the claims the platform verifies.

## Policy (`email/autopilot.md`, requested configuration)

```yaml
schemaVersion: 1
enabled: true
timeZone: America/Chicago
firstWindowStart: 2026-11-23   # windows are [start, start+13]
batchDays: 14
leadDays: 7                    # author + stage on start-7
holdHours: 48                  # sends auto-approve 48h after the Slack notice
sendDays: [tuesday, thursday]
localTime: "10:00"
archetypes: [artist-drop, editorial, set-feature, room-recommendation, new-arrivals, seasonal]
audiences: [full-reach]        # strategy audience keys
maxCampaignsPerWindow: 6
```

The file is a request. Only the **granted** copy (stored on the grant row with
its hash) has authority. Editing the file does not change what is granted. A new
grant is needed, and approving it supersedes the old one.

## Lifecycle of one window

| When | Who | What |
| --- | --- | --- |
| `start-7`, first cron tick | platform cron | Creates the batch row (unique per grant + window), mints a 6-hour MCP connector token, starts the authoring sandbox. |
| authoring | Claude Code in a Vercel Sandbox, store MCP only | Reads strategy, calendar, sent history and review notes. Writes `proposed` campaigns for the window's slots with `email_campaign_upsert` and renders each one. Cannot call `propose_*`. |
| staging | runtime `/api/autopilot/email/stage` (service-only) | For every campaign in the window: checks policy (archetype, audience, slot time, status, clean render, cap), then proposes `email.approve_campaign` → `klaviyo.create_campaign_draft` → `klaviyo.schedule_campaign` with `delegation`. Campaigns that fail policy are left for humans and listed. |
| immediate release | platform propose route | Approve and draft are **non-sending**, so the platform releases them inline under the grant. |
| hold window | platform | Schedule proposals get `release_at = notice + 48h`. One Slack digest lists every campaign with its review link and a **Hold** button, plus **Pause autopilot**. |
| release | platform cron | Each due schedule is re-verified against the active grant: same policy hash, not held, notice delivered, send time still ahead. Then `decideAction(actor: grant:<id>)`. |

**Hold** moves one proposal back to a normal manual card in the thread.
**Pause** stops every pending release and future kickoffs until resumed.
Already-scheduled sends are cancelled through the existing `klaviyo.cancel_send`
card.

Editing a campaign after staging is safe. The changed-since-drafted check makes
its schedule fail at release, and the next staging tick re-drafts it. If the
hold would end after the send time, the stager leaves it for a human instead of
compressing the hold.

## Owners editing through Claude Code

Anything `proposed` in the window is the batch, whoever wrote it. An owner can
open the calendar in Claude Code over the store MCP, rewrite or add campaigns
before staging, or hold and edit afterwards. Off-policy work (a promotion, a
US-only audience, a Saturday send) is never auto-staged. It goes through the
normal three cards.

## Fixed as prerequisites

- **Plan proposer:** a week with no allowed send day no longer falls back to
  weekends (the Sunday Nov 1 and Monday Nov 30 slots). Audiences marked
  `rotation: false` are never rotated in.
- **`email_campaign_upsert` MCP schema:** now declares `headlineOptions` and
  `selectedHeadlineId`, so clients stop sending them as strings.

## Remaining operational risk

- Authoring quality depends on the art graph. When it is down, the batch is
  still authored from Shopify and storefront data, and the digest says so.
- Sandbox authoring costs model spend once per window. It is metered under the
  existing agent job caps.

## Owner activation and recovery (2026-10-27)

The Email console now exposes authenticated Enable, Pause/Resume, Continue and
per-campaign Hold controls. A real Supabase console user signs the exact request
for `/api/broker/email-autopilot`. Enable creates and approves `autopilot.grant`
through the existing gate, recording that actual user once. Covered campaigns
then need no individual approval; the Slack digest begins the granted opt-out
period. Existing strategy cadence, audiences and excluded promotion types remain
the scope of the grant. Two weeks means a calendar window, not daily email.

First activation uses a fresh start date with a full production day and review
period, instead of waiting for an old requested date weeks away. Subsequent
windows retain that granted 14-day cadence and prepare seven days ahead. Existing
campaigns are read before authoring to avoid duplicating planned or scheduled
sends. Continue advances only the authenticated tenant; the cron still advances
all installed tenants belonging to its app.

Automatic sends waiting out their review period are excluded from the ordinary
"waiting for approval" inbox. The Email list marks them "Automatic · review
open" and excludes them from the manual bulk-schedule button. Explicitly held
items return to the manual inbox; a paused grant remains paused in automation
controls. The live status reads the actual gate decisions so a held or scheduled
campaign cannot remain mislabeled as an automatic pending send.
