# Ongoing automation and console recovery — 2026-11-04

## Verified incident

Both owner grants existed, and Vercel production cron requests were arriving every
five/ten minutes. Social remained stopped on its October 30–November 12 batch
from October 27 with no media jobs. The planning service path now returns its
own anonymous 401 correctly, but the stopped journal was never resumed after
that deployment. "Active" described consent, not healthy production.

Email completed its first window: it preserved four already scheduled emails
and delivered its Slack receipt. Its requested file also contains Sunday/Friday
programmes added later; these must be present in the actual granted snapshot to
run. Code or a requested policy file alone does not grant those sends.

The Calendar GET awaited a rebuild from up to 62 source posts. Each iteration
read the repository and locked/upserted projections before rendering. The page
now reads the existing calendar projection directly. Mutation actions already
maintain that projection; explicit reconciliation remains a repair utility.

## Implemented repair

- Refuse an already-missed social window before model or generation spend.
- Namespace new generation inputs and post IDs by window, allowing replacement
  future windows to overlap abandoned dates without overwriting source drafts.
  Existing legacy manifests retain their IDs and hashes.
- Automatically retry only an untouched transient preflight, at most three
  times, five minutes apart, with no worker proposal/job and full review lead.
  Paid, frozen, unknown or paused work is never automatically retried.
- Record successful/failed worker check-ins separately from progress and consent.
  An active grant with a stopped batch or stale clock is visibly unhealthy.
- Stream the console shell and overview while secondary store/GitHub reads run;
  bound those reads and database waits, and expose navigation loading feedback.
- Show live email/social production state, scheduling counts and control links
  on Overview. "Published" GitHub PR counts are relabeled "Changes merged".
- Preserve the recently merged weekly email programme support and its programme-aware
  activation dates. New grants must include the requested programme snapshot.

## Release and production acceptance

Apply platform migration 019 before deploying the check-in readers. Land the
canonical template changes before the matching client-owned Arthaus port. Keep
its new-artist programme work and existing scheduled sends intact.

A fresh future social window must be approved through the existing gate under
the owner's already recorded opt-out request and 125-credit limit. Do not charge
for old dates, insert standing authority directly, or claim a batch is ready
until actual media, Slack delivery and schedules are verified.

Verify both production cron check-ins, Instagram account and publishing scope,
actual new social generation job states, review notice and scheduling. Record
any provider failure explicitly; do not label a deployed fix as a live backlog.
