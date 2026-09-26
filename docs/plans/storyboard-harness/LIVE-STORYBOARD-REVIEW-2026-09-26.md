# First live graph-grounded storyboard rehearsal

Status: **awaiting human review**, not approved, deployed or engagement-validated.
See the [comparison page](reviews/2026-09-26-detail-reveal.html) for actual source
images, all three proposed boards and independent judgments. Images are original
catalog renders, not composed slides. No image generation or publishing occurred.

## What ran

A fresh public Picasso concept/facet read and tenant-scoped Shopify read returned
`bm33` and `sun-leaf-abstract-botanical-mid-century`; `explore-4-old` failed the
public-product-page check. The core compiler bound these receipts and existing
catalog images to an explicitly local draft of **The detail that changes the
reading**. This draft is a research input, not an edit to store-owned concepts.
Current store Brand Soul contents were read from the checkout. No admitted
corpus patterns or recent-post baseline were supplied, so every board remains a
hypothesis. Both source images visibly contain frames; neither is a bare master.

The existing Mastra model adapter was first exercised with an explicit local
`anthropic/claude-sonnet-4-6` choice. Its first call failed because the account
had insufficient API credit. No deployed environment setting was changed.
A local transport then called the same core planner/critic interfaces using
Vertex `gemini-3.1-pro-preview` in `arthaus-us`, the corpus pilot's existing
model/project. This proves a live **core rehearsal**, not the enabled-MCP
runtime tool, deployed Mastra provider path or governed persistence flow.
JSON-mode output was validated with the actual Zod schemas. The attempted
provider JSON-schema constraint returned HTTP 400 and was removed for this
probe; this is not a production structured-output adapter.

The initial 8,192-token response hit MAX_TOKENS, with most output allocated to
thinking. It was retained as a failure, not parsed as a completed board. One
bounded retry used LOW thinking and a 16,384-token output cap. It produced three
schema-valid options. Original critique then exposed a comparison-input bug:
the current board was included among its alternatives. Two critics emitted
foreign IDs or omitted the whole-story verdict. Those protocol failures were
**not creative eliminations**. The source fix excludes the current board and
makes verdict scope explicit. Only the three critics were re-run on the saved
boards; there was no second planner run or silent copy repair.

Across the truncated response, completed four-call pass and three corrected
critic calls, eight Vertex responses reported 112,178 prompt tokens, 5,853
candidate tokens and 10,099 thought tokens (128,130 total). The HTTP 400 and
Anthropic billing rejection provided no usage record. These are reported token
counts, not reconciled billed cost. Raw inputs, provider outputs and saved
images remain private at `/private/tmp/storyboard-live-review-20260926/`; no
credentials are copied into committed artifacts.

## Result and limits

| Board | Proposed information change | Corrected model judgment |
| --- | --- | --- |
| BM33 figure → full sky | An isolated silhouette gains surrounding sky/context | Eliminate: copy/caption omit specific colors and fail the Brand Soul description formula |
| Sun Leaf branch → full landscape | Botanical line detail gains landscape context | Eliminate: caption lacks specific colors and a concrete spatial recommendation |
| Sun Leaf circle → full landscape | An isolated geometric form becomes part of the landscape | Retain for review: detail/reveal and copy satisfy the critic's interpretation of the brand formula |

These are advisory model decisions. The retained board still needs a human to
confirm the proposed crop is legible, the reading is worthwhile and the language
fits Arthaus. Calling the circle "terracotta" is a proposed color reading, not
a catalog specification. The two rejections concern copy compliance, not proven
reader boredom. All three options use the same two-step detail/full mechanic;
subject and crop changes do not establish portfolio diversity. There is no
blind comparison to the old social agent yet, no cross-subject archetype
validation, no counted corpus support and no observed engagement outcome.

The finalized review hash, recomputed after corrected judgments, is
`1d31b8d525120b5e17ffd730a9986268f62724902601356a5380cfe4bd3b7da2`.
The comparison page is a research review artifact and grants no spend or
publishing consent. Hosted/scaffold/MCP parity and durable review are still open.

## Next product steps

1. Human review of the retained board and the two copy-based rejection reasons;
   record corrections before any realization. Select or reject this series as
   a hypothesis, not an engagement-proven recipe.
2. Review the five corpus sequences and acquire a more relevant art-retail
   sample. Abstract inspected reader moves into concept/transition hypotheses;
   don't turn merchandise presentation into Arthaus's editorial rotation.
3. Test distinct reader arguments (contrast, relationship discovery, detail
   reveal) over multiple catalog subjects against the old-agent baseline.
   Add relationship reads before qualifying concepts that require graph edges.
4. Finish bounded model/provider configuration, deployment exposure and
   governed persistence before a production pilot. Keep the existing imagery
   and Action gates. Bare masters remain required for mockups; detail/full
   posts can deliberately use labeled catalog renders without mockup spend.

Verification for the comparison-input correction: 36 storyboard tests and
package typecheck pass. The integration assertion verifies each critic receives
exactly the other two boards. The fix is mirrored into the runtime template.
