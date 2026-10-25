# Social queue recovery — October 25, 2026

## Initial audit


The October 21 reconnect succeeded. The Moroccan and space carousels have real
publication receipts on October 21 and 23. Instagram identity readback still
matches @arthaushq. No further posts are scheduled. The recurring social worker
was not implemented or enabled; the policy and publishing cron alone never
created another batch. Do not describe that state as deployed social autopilot.

The requested recovery batch covers October 26–November 8: seven carousels,
four newly generated artwork loops, and three already-rendered, source-preserving
camera edits. It retains verified masters and artist credits. New generation
requires 21 scene jobs capped at three credits and four loops capped at eight:
95 reserved credits within the owner's 125-credit fortnightly cap. Historical
estimates total 87.75; fresh quotes, real execution, final assets, gate decisions
and schedule receipts are still required. Editorial dates are not send consent.

## Loading correction

The Social board awaited each post's GitHub read sequentially before rendering.
It now uses a six-reader pool, retains deterministic order and reports unreadable
records. Repository listing failures still surface rather than posing as an empty
calendar. A loading boundary gives navigation visible feedback while records load.
No shared tenant cache, lifecycle changes or extra publishing authority is added.

A six-post read sample against the real store repository took 1,493 ms sequentially
and 224 ms concurrently on October 25. This measures repository requests from the
operator's machine, not production TTFB, LCP or a full browser trace. Browser
control timed out repeatedly on the loaded laptop; no web-vitals score is claimed.
The laptop snapshot showed 27,194.88 MB swap in use and heavy VM/Chrome CPU use.
Running apps and jobs were left intact.

## Implementation and deployment update

Core [#140](https://github.com/Avant-Garde-AI/marketing-os/pull/140), platform
[#55](https://github.com/Avant-Garde-AI/marketing-os-app/pull/55), and store
[#284](https://github.com/Arthaus-Inc/marketplace/pull/284) are merged. The platform
migration has applied and its production broker reports a healthy @arthaushq
connection. The runtime deployment and one-time authenticated owner activation
are verified separately; no active grant or newly scheduled batch is implied by
these merges.

The recurring recipe pool uses eleven curated entries with 25 verified master
bindings. Each automatic window creates seven new loops and seven new three-slide
carousels, reserving 119 of the confirmed 125 credits. The first configured window
is October 27–November 9 at 10 AM America/Chicago, followed by November 10–23;
that next window prepares November 3. Local UTC offsets resolve independently
across the November 1 clock change. The earlier recovery drafts remain editorial
history; they are not evidence of finished media or scheduled content.

A real existing completed loop exercised the new credential-free media sandbox.
Both the 1080×1920 Reel and 1080×1350 feed export passed the canonical duration,
content-hash and MP4-byte validators. No additional Higgsfield generation was
submitted for that exporter test. See the platform's retained
`docs/plans/qa/social-loop-export-2026-10-25.json` receipt.
