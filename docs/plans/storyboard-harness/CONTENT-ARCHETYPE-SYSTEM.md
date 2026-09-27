# From corpus patterns to repeatable art content

**Decision record, 2026-09-25.** This corrects the immediate priority of the
[core architecture](../../STORYBOARD-ARCHITECTURE-AND-IMPLEMENTATION.md).
The product is a system that can repeatedly make distinctive, useful social
posts from real catalog artworks and graph relationships. A sound extraction
pipeline is an input to that system, not its output.

## The unit we are building

A **content archetype** is a repeatable reader-facing argument. It defines a
question or tension, the information gained at each beat, the graph/catalog
facts needed to instantiate it, the circumstances in which it must refuse,
and what can vary across runs. It is more specific than a content pillar and
more abstract than a finished post. A layout archetype only arranges pixels.
A corpus transition such as `reveal` or `comparison` is a reusable move inside
an archetype, not a complete reason to publish. An individual artist's merch
carousel can teach us an art-to-product change without becoming an Arthaus
posting recipe.

The existing [Post Concepts](../../../spec/29-POST-CONCEPTS.md) and
`social/concepts/*.md` are the right **store-owned authoring surface** for this
unit. Their premise, reader payoff, needs, expressions, continuity and cadence
should evolve; do not create a second competing template store. The current
four Arthaus concepts are brand-derived drafts with `evidence.n = 0`. They are
ideas to test, not corpus-proven or engagement-proven formats. The layout genome
remains a later rendering input and cannot stand in for the content library.

An instantiated archetype should carry these linked records:

| Record | Required content | Authority |
| --- | --- | --- |
| Archetype revision | Premise, reader payoff, hook, beat roles, hard/soft needs, allowed variations, refusal rules, cadence | Reviewed store artifact |
| Subject packet | Exact artwork handles, artist IDs, graph query/tool and result refs, relevant facets/edges, catalog availability and rights | Graph for discovery/facets; current catalog for product truth |
| Storyboard | Beat-level new information, visible assets or feasible asset instructions, factual claims, transition, continuity and variant rationale | Planner proposal, then human choice |
| Evidence ledger | Original inspected post IDs and slide locators; reviewer corrections; separately, observed outcome tests | Corpus and measurement records, never model assertion |

Graph retrieval must be a **read-only capability port** bound to the tenant's
existing Picasso MCP connection. A tool result is not authority merely because
the agent says it queried the graph: the packet needs resolvable result IDs or
source refs and catalog handles. `explore_concept` and `faceted_discovery` can
find subjects; `get_artwork_facets` can support visual descriptions;
`recommend_similar` and `concept_walk` can propose relationships;
`ask_concierge` can suggest context but its free text cannot replace a facet,
catalog record or reviewed artist claim. Availability, dimensions, current
images and product links come from the catalog at plan/dispatch time. If a
required fact or image is absent, the archetype refuses that subject. No graph
result may make a framed render into a bare-artwork master.

The current native `shopify-get-products` read is too thin for that join: it
returns ID, title, status and image/variant counts, but not handle, asset URL,
dimensions, price or inventory. The next adapter must extend a tenant-scoped
catalog **read** or use an existing equivalent; it must not treat the graph's
cached product fields as current commerce truth. Current `sourceRef` strings
are caller-supplied and only enforce an inspectable assertion. The adapter
must resolve and pin real MCP/catalog receipts before claiming verification.

## Candidate Arthaus series to test

These are **design hypotheses**, not admitted findings. They are deliberately
different reader arguments. Each can run over many catalog subjects if its
requirements are met; none copies an exemplar's styling or artwork.

| Series hypothesis | Reader payoff and beat change | Graph/catalog contract | Refusal and variation |
| --- | --- | --- | --- |
| **One feeling, three visual languages** | Start with a mood/question, reveal two works that express it through contrasting palette or medium, then a third that breaks the expected look while preserving the mood. The final beat teaches the relationship, not just shows another SKU. | A named concept/facet with at least three available works, distinct artists or media, verified facet paths for both shared and contrasting traits. | Refuse if the works are near-duplicates or the shared connection is only the model's prose. Rotate the concept, ordering and contrast dimension. |
| **The unexpected neighbor** | Show one work, introduce a visually surprising second, then reveal the specific graph relationship that makes them hang together; optionally show a catalog-supported arrangement. | Seed artwork, `recommend_similar` or `concept_walk` edge/path, verified facets on both endpoints, two available handles. | Refuse if the relationship cannot be explained without generic taste language or if imagery cannot show the pair honestly. Vary graph path and reveal order. |
| **Choose the anchor, then the wall** | Begin with an anchor piece and a concrete reason it anchors; beat 2 adds a piece that changes the wall's balance; payoff shows a complete, curator-approved set. | Verified anchor, real companion works and explicit shared/contrasting facets; approved set geometry or existing imagery. | Refuse an invented arrangement or unsupported scale. Vary the anchor constraint and wall composition, not just artwork names. |
| **The detail that changes the reading** | An artwork detail poses a visual question; the full work answers it; a related work shows that the motif or treatment is not isolated. | High-resolution authorized image, locatable detail, full work handle, graph-backed related work and facet. | Refuse if the crop is illegible, the related-work link is weak, or a framed render is misrepresented as bare art. Vary the detail and relationship. |

The existing `one-work-three-rooms` and `true-to-scale` concepts remain useful
utility experiments, but the room imagery/accurate dimensions contract must be
satisfied before they enter an automated rotation. `how-it-was-made` cannot
claim documentary process from a finished image; any simulation needs explicit
labeling and an owner decision. Candidate-series names and directions are
reviewable proposals, not automatic edits to store-owned concept files.

## How the corpus can support or reject these

The corpus should answer two separate questions: **what repeatable information
move is observable?** and **whether this implementation earns attention for
our audience?** Five unreviewed carousels cannot answer either at release
quality. First, review exact slide changes and correct unsupported readings.
Then recover a stratified, in-domain sample with both strong and ordinary posts
across account tiers, formats and artists. Extract visible sequence structure
blind to engagement; cluster by reader question, subject relationship and beat
change, not by visual similarity alone. Inspect original posts and outliers for
each proposed cluster. Store post-level counts only for inspected members and
keep the source accounts separate so one prolific artist cannot masquerade as
cross-artist replication.

Recorded likes/comments permit **candidate prioritization**, ideally compared
within account and similar publication conditions. They do not identify why a
post performed, estimate reach, or establish that an archetype will drive
engagement for Arthaus. Mark a series `observed-structure` only after inspected
cross-post support; mark `validated-for-Arthaus` only after a predeclared
Arthaus test on published posts. Before that, `brand-hypothesis` is honest.
Do not turn a model's inferred purpose into a counted pattern.

The first product evaluation is deliberately smaller than full automation:
instantiate two eligible subjects per candidate series; produce multiple
storyboard variants with one eliminated for a reviewable reason; compare them
blindly against the current social agent's output before imagery spend. A
reviewer rates reader interest, beat-2 information gain, factual/visual
grounding, brand fit and variation across subjects. Record the original
graph/catalog packet, pattern refs and rejection reasons. Only selected boards
continue to imagery. Later, use a balanced calendar with explicit format,
audience, timing and subject controls, predeclared primary measures such as
saves/shares per reached account, and observed Instagram outcomes to update
the series. Track creative diversity and repetition as guardrails. No offline
engagement prediction replaces the live test.

## Implementation order from this checkpoint

1. **Concept-first agent behavior.** Make the agent read the store's standing
   concepts before choosing a layout. Require graph/catalog source refs for
   subject and need assessments; fail closed when connected graph data is
   unavailable. Keep the existing Action gate.
2. **Thin graph-to-board seam.** Add a typed read-only subject packet and an
   adapter around enabled Picasso MCP tools. Resolve catalog handles and assets
   separately. Bind an instantiated Post Concept to the storyboard planner;
   preserve archetype ID, revision, subject refs, beat changes and all rejected
   options in the review packet. No direct model-callable write.
3. **Relevant corpus calibration.** Review the five extracted still sequences,
   treat the merch case as a transition example only, and sample more artist
   and art-retail content by reader argument rather than follower rank alone.
   Cheap workers perform bounded recovery/normalization; frontier vision handles
   difficult interpretation; humans admit patterns.
4. **Creative acceptance before scale.** Run the blind storyboard comparison,
   then a governed first post with verified assets. Only after that build the
   batch worker, larger pattern library and automated archetype rotation.

The graph and Creative Review/NeuroGraph boundaries are distinct. Picasso is
the connected **artwork discovery** source here. A future customer NeuroGraph
persona MCP can inform audience context; the optional Creative Review adapter
can assess outcome hypotheses. Both remain optional and neither grants a
publishing authority or supplies observed engagement.
