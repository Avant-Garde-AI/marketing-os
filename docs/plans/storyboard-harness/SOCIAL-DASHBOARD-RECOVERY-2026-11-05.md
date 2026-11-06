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
