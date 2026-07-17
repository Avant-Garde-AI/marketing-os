# WS2-R5 — Client-Rendering QA Matrix

> Status 2026-07-17: harness + fixture ready; **the render pass itself needs a
> human with real mail clients** (no rendering-tool subscription approved —
> WS2 OQ2). The golden email is deterministic, so screenshots stay valid until
> the renderer vocabulary or the skeleton changes (both would regenerate the
> golden and re-open this matrix).

## The fixture

`packages/email-assembly/test/golden/arthaus-campaign.html` — the committed
golden assembly (Arthaus-tokenized skeleton + 2 surface sections + 3 HTML
sections, every 04 §6 invariant passing). To send it to yourself:

1. Any of: paste into a Klaviyo CODE template and use template preview-send;
   or use `scripts/verify-klaviyo.ts --write` (hosted-agents) once Arthaus
   credentials exist; or a throwaway SMTP sender — the HTML is self-contained
   (images are absolute URLs).
2. Send to accounts covering the matrix below.

## The matrix (record VERDICT: pass | known-issue | fail + screenshot)

| Client | Mode | Verdict | Screenshot | Notes |
|---|---|---|---|---|
| Gmail web (desktop) | light | — | qa/shots/gmail-web-light.png | |
| Gmail iOS app | light | — | qa/shots/gmail-ios.png | |
| Apple Mail (macOS) | light | — | qa/shots/apple-light.png | |
| Apple Mail (macOS) | **dark** | — | qa/shots/apple-dark.png | boards must not float as light slabs (04 §5b) |
| Apple Mail (iOS) | dark | — | qa/shots/apple-ios-dark.png | |
| Outlook Windows (classic) | light | — | qa/shots/outlook-win.png | VML buttons; MSO conditionals |
| Outlook.com (web) | light | — | qa/shots/outlook-web.png | |

## What to look for (from 04 §5's honest analysis)

- **Blank render / broken layout** = FAIL (blocks WS2 exit).
- Buttons: bulletproof VML CTA renders as a filled rectangle in Outlook
  Windows (not a bare link).
- Product row: stacks to single column ≤480px (Gmail iOS / Apple iOS).
- Dark mode: HTML sections invert acceptably (token dark pairs); board images
  keep their own backgrounds to the edges — no white halo. Dark mode is
  damage control, not control: record honestly, don't chase perfection.
- Preheader: preview text shows in the inbox list, not in the body.
- Images off (Outlook Windows default): alt text carries the message; the
  email still reads (text/HTML sections are the information layer).
- Gmail clipping: the golden is ~9.4KB — nowhere near the ~102KB clip line;
  re-check if a real campaign approaches 80KB (the assembler warns).

## Human TODO (Garrett or delegate)

- [ ] Run the send + capture screenshots into `qa/shots/`
- [ ] Fill verdicts; any FAIL → file against `packages/email-assembly`
  (renderer vocabulary bugs fix once, apply everywhere)
- [ ] Decide WS2 OQ2 (Litmus/Email-on-Acid spend) if manual rounds get old
