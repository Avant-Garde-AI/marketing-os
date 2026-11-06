# Social dashboard and production recovery — November 5, 2026

The November 4 release enabled the standing policies and submitted generation
jobs. It did not complete a publishable fortnight. Four jobs were accepted before
media confirmation for the next loop failed before generation submission. The
batch stopped, delivered no review receipt, and scheduled no posts. A healthy
cron clock did not mean healthy production.

The platform now recovers only positively unsubmitted transport failures with
unchanged source material, the original reservation and live grant, a fresh gate
fingerprint, three retries maximum and five-minute cooldown. Accepted and
unknown submissions never retry. Existing completed jobs are reused.

The Social landing page now owns the light dashboard: live automation and job
progress, published/scheduled/production/attention totals, recent publication
receipts, month and lifecycle filters, and 24 posts per page. Replaced unfinished
automation batches sit under Closed rather than current work. A proposed date
is labeled Proposed, not scheduled; a published status without a provider
receipt is an issue, not a live post.

The page streams its shell and reads tenant-scoped database projections rather
than loading every source file from GitHub. A failed index reads as unavailable,
not zero content. Post details, review and execution still re-read source files;
the projection confers no authority. Automatic draft preparation now calls the
same index writer as binding, scheduling and publication. Migration 012 adds a
rebuildable post snapshot for the dashboard. Existing artifacts need a one-time
index rebuild using the existing reconciliation utility outside navigation.

Navigation no longer prefetches every console section, and repository requests
have a bounded timeout. Browser trace tools were unavailable for this repair;
no Core Web Vitals improvement is claimed without a measured browser trace.

Release checks: dashboard receipt semantics and tenant/pagination tests,
automation/scaffold/production tests, runtime TypeScript, full CLI test suite,
and a live production read after promotion. The release is only operationally
complete when actual media, Slack notice and schedules are recorded. Merely
activating a grant or starting one job is not that acceptance condition.

A failed provider scene is now isolated to its parent post without replacing the
paid generation. Held posts appear under Needs attention with an explicit
“won’t publish” label, separate from drafts and confirmed publications. The
production panel reports the held count alongside completed and in-progress
jobs. Publication receipts remain historical truth even if a later hold exists.

The production poll refreshes the read projection when a batch changes phase,
scheduled count or held count. An open dashboard therefore follows the worker
into scheduled content without leaving its post totals frozen at page load.

Provider completion is a separate stage from artwork compositing and video
export. The production card names finishing, post building, review notification
and scheduling separately, and shows prepared final media against its active
expected total. Successful generation alone never means a scheduled post.

Concurrent console rollouts must release a build containing current merged
main, then verify both the public console and configured service aliases. The
November 5 rollout was consolidated with the parallel Klaviyo reporting change;
a merged PR or one temporary alias receipt is not sufficient deployment proof.

Visual QA found that a non-square locator image could produce a vertical
coordinate reference inconsistent with the renderer. `square-1008-v1` uses a
fixed square analysis viewport and maps its points back into original-image
coordinates. The original generation pixels and artwork masters are retained.
Existing automatic receipts can receive one hash-bound coordinate correction
through the same Action gate, with the prior receipt archived before replacement.
Binding rejects legacy automatic placements; no corrected post can use the bad
cached render. New generation calls and speculative confidence rerolls are not
part of this repair.

A separate physical frame-fit critic checks the proposed rendered JPEG before a
realization Action can execute. Its passing result is bound to that pixel hash;
automatic binding rechecks the hash. A missing, uncertain or failed check cannot
become scheduled content. Worker inspection reads only the source needed for its
current phase, avoiding bulk post/receipt reads during generation. Execution
continues to re-read the relevant source at the gate.

Client-owned database correction: the console projection database and platform
control-plane database are separate. The console must obtain grant and hold
state through the tenant broker, not join platform grant tables in its local
projection SQL. Unknown broker state is shown as unverified automation, not a
safe schedule. The November 5 platform-database check was insufficient rollout
proof: production logs subsequently identified a missing snapshot column in the
actual console database. Apply migration 012 to that database and rebuild its
projection from current files. Historical migration drift is not baselined or
re-run as part of that additive repair.
