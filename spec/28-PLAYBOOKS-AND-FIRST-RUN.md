# 28 — Playbooks & the First Run

> Open Conjecture · September 2026 · **PROPOSAL — not built in the hosted app**
>
> The capability library as the onboarding path: a new install walks a numbered
> sequence — define the brand, publish it, put an offer live — and comes out the
> other side with a `brand.md` in their repo, a public brand page agents can
> read, and a running storefront experiment. The open-core offer engine is the
> thing that makes the paid tier obvious.

---

## 1. What a playbook is

A playbook is a **vetted prompt with a name and a number**. Not a workflow
engine, not a wizard — a card that opens a session with the agent already
pointed at a job worth doing.

This already ships in the open-source self-hosted console
(`packages/marketing-os/templates/agents/app/playbooks/page.tsx`): six numbered
volumes, each `{vol, id, name, description, category, prompt}`, one **Run**
action that seeds the chat. That is the entire mechanism, and it is the right
amount of machinery. The Shopify app has no equivalent — a hosted merchant sees
an empty chat box and has to invent the first question.

Two properties make the pattern worth more than a prompt library:

- **A playbook is legible as a product surface.** "Vol. 04 — Design an Offer"
  is a thing a merchant can be sold, taught, and reminded about. "Type
  something to the AI" is not.
- **A playbook is a stable handle for a session.** Under spec 27, a session run
  from a playbook carries `origin: 'playbook'` and the playbook id, so "what
  came out of Design an Offer" is answerable, and so playbooks can be measured
  (run rate, completion rate, change sets produced) rather than guessed at.

## 2. The first run

The three steps below are the product, in order. Each produces a durable
artifact the next one consumes, which is why the sequence is not arbitrary.

### Step 1 — Define the brand

The agent interviews the owner and converges on `brand.md`: essence, persona,
value proposition, voice, guardrails. It proposes a grounded first pass rather
than presenting a blank form, walks it section by section, and commits only on
approval. The artifact lands **in the store repo** — files are truth (spec 22
D1), so the brand survives the app, the vendor, and the model.

**Built:** yes, for hosted stores. `brandSoulTools` are in the pooled runtime's
base tool set and the app has a Brand page.

**Caveat worth knowing:** there are two brand artifacts and they are not the
same thing. `brand.md` (Brand Soul, spec 22) is live end-to-end. `brand-design.md`
(the Brand Conversion Document, spec 21) is produced by a separate
`brandDefinitionAgent` which is registered in the hosted Mastra instance but
**unreachable from the app's chat** — `/api/chat` hard-selects `marketingAgent`
or `marketingAgentFast`. A playbook pointed at the conversion document would
dead-end today. Either route to it (a one-line agent selector on the chat
route, plus a way for the client to ask for it) or keep step 1 on Brand Soul
and treat the conversion document as a later volume.

### Step 2 — Publish the brand

`brand.md` becomes a public, addressable page — `/brand/{store-slug}` — that
other agents can read. This is the step that surprises people: the brand stops
being a document in a drawer and becomes context any assistant can fetch.

**Built:** yes, live on Arthaus (`arthaus.cloud/brand/arthaus-website`).

In first-run framing this is not a separate chore — it is the payoff shot for
step 1. The playbook's completion state is "your brand is live at this URL,"
with the URL copyable.

### Step 3 — Put an offer live

Evaluate what the funnel is missing, design an offer against it, ship it as an
experiment with a control arm, and let it reallocate toward the winner. This is
where the app stops being an analytics chat and starts replacing a paid tool.

**Built: half.** See §3 — this is the gap that matters most.

## 3. The offer engine: what is actually built, and where

Splitting it honestly, because the two halves live in different repos under
different licences.

| Half | What it does | Where it lives | Licence | Hosted stores? |
|---|---|---|---|---|
| **Authoring** | `propose_offer` (designs incentive + copy + arms, side-effect free), `offer_review` (read a running test, recommend), `offer_performance` | `packages/marketing-os/templates/agents/src/mastra/tools/offer-*.ts` | **MIT** (`@avant-garde/marketing-os`) | ❌ never ported to the pooled runtime |
| **Storefront + governance** | Surfaces app embed (theme app extension, off by default), surface store with mechanical re-validation, dark-pattern blocklist, `offer.activate` Action, daily metrics, posterior-based weight reallocation | `marketing-os-app` (`extensions/surfaces`, `api.offers.*`, `lib/actions.server.ts`, `offer-posteriors.server.ts`) | private | ✅ live |

So the answer to "is the offer engine agent open source?" is **yes — the agent
half is MIT**, shipped inside the `@avant-garde/marketing-os` template that any
store can `npx` into their own repo and self-host. Also `@avant-garde/design-loop`
(MIT), whose `checkDarkPatterns` gate the offer tools call, and
`@avant-garde/brand-md` (Apache-2.0). What is *not* open is the hosted
platform: `marketing-os-app` and `marketing-os-hosted-agents` are both private
with no licence field. That is a coherent open-core line — **the agent and its
skills are open; the multi-tenant storefront runtime, the credential broker,
and the governance gate are the service** — but it does mean a hosted merchant
today can be served an offer they cannot author.

**The port that closes it** is mechanical and small: the three tool files are
~400 lines total, and the only real change is swapping their
`MARKETING_OS_API_URL` + tenant-key `fetch` for the hosted `broker-client`
pattern (`MOS_PLATFORM_SERVICE_KEY` + tenant context) that the email and social
tools already use. Then merge them into `baseMarketingTools` behind an
enablement gate, and flip `offer-engine` from `soon` to `installable` in the
app's plugin catalog. One commit in `marketing-os-hosted-agents`, one line in
`marketing-os-app`.

## 4. Why this is the conversion moment

The trial-to-paid argument writes itself once step 3 works, and it does not
depend on the merchant believing anything about AI:

- The offer engine replaces a category of paid app (popup/offer tools) that
  stores already pay for monthly.
- It ships offers **as experiments with a control arm**, which the tools it
  replaces mostly do not.
- It refuses dark patterns mechanically, which is a brand-safety argument to
  the owner and a defensible position publicly.
- It gets better with the brand artifact from steps 1–2, which the merchant has
  already produced by the time they reach it — so the sequence sells itself.

The open-core split helps rather than hurts here: the authoring agent being MIT
means a technical store can self-host the whole thing, and the ones who don't
want to run infrastructure pay for the hosted runtime, the storefront embed,
and the approval gate. The thing you charge for is the thing that is genuinely
expensive to operate.

## 5. Build shape

**In the Shopify app:**

- `/app/playbooks` — the numbered library, ported from the OSS console page.
  Same card design (Vol. NN, category chip, one-line description, Run).
- Run seeds a session: `/app/console?playbook={id}`, which opens the Agent page
  with the playbook's prompt pre-filled as the first turn. Needs the Agent page
  to accept a seeded prompt — small change.
- Playbook cards carry a **state**, not just an action: unstarted, in progress
  (a session exists), done (the artifact exists — `brand.md` committed, brand
  page live, a surface ACTIVE). State comes from data the app already has.
- First-run: the home dashboard's "Finish setup" card (spec 27 §4.3) points at
  volumes 01–03 in order rather than at connection chores. Connections are
  prerequisites the playbooks pull the merchant through, not a checklist that
  precedes value.

**Catalog placement:** playbooks are prompts, plugins are capability. A playbook
whose prompt needs a plugin's tools shows "needs the Offer Engine" the same way
the Email Agent shows "needs Klaviyo" — one requirement model, already built.

## 6. Open questions

1. **Where does the playbook catalog live?** Duplicating the array in both the
   OSS console and the Shopify app guarantees drift. It should be one exported
   const in a published MIT package (`@avant-garde/skill-kit` is the natural
   home) that both consume — the same call as the skill-pack catalog.
2. **Does a playbook run pin a version?** "Improved by outcomes across the
   network" (the OSS page's own copy) implies playbooks get edited. A session
   should record the playbook version it ran, or "why did this work last month"
   is unanswerable.
3. **Brand Soul or Brand Conversion Document for volume 01?** §2 step 1 — needs
   a decision before the first-run sequence is built, not after.
4. **Should the offer engine be enabled by default on install?** It is the
   conversion argument, so yes in spirit — but it requires the merchant to
   enable a theme app embed, which is the one step no agent can do for them.
   The playbook has to carry that instruction gracefully.
