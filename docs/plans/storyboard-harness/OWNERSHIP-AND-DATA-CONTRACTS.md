# Creative agent, store implementation and corpus knowledge boundaries

Decision: 2026-09-26. These are three independently versioned layers, not three
competing concept registries. The core plan and spec 33 remain the implementation
roadmap; this record states where a change or artifact belongs.

| Layer | Reusable responsibility | Source of truth |
| --- | --- | --- |
| A — base deep-agent structure | Plan before execution; generate alternatives; independent critique; structural/source checks; selection/review payload; provider and capability ports; failure/budget boundaries; existing approval authority | `marketing-os/packages/storyboard`, shared skill contracts and tenant-neutral runtime/template bindings; platform gate stays in its existing repository |
| B — Arthaus implementation and use | Brand, strategy, series premises/cadence, selected artwork handles, art-graph connection/mappings, catalog eligibility, model configuration, master inventory, creative runs, human corrections and channel outcomes | `Arthaus-Inc/marketplace/agents/brand`, `agents/config`, `agents/social/{concepts,reference,research,posts,calendar}`; secrets stay in the existing credential system |
| C — social dataset contracts and knowledge | Versioned observation/narrative vocabulary; source-post/media identity and order; annotation/extraction schemas and prompts; clustering/admission rules; exemplar-to-pattern lineage; retrieval/projection contracts | Generic logic in `marketing-os/packages/storyboard-corpus` and social/reference schemas. Dataset manifests, actual media, exemplars, reviews and domain libraries live in their explicitly scoped research/store data plane, not embedded in base-agent instructions |

A owns **how an agent reasons and checks**. B owns **what Arthaus wants to say
and with which real subjects**. C owns **what was observed, abstracted and
reviewed from the source dataset**. Generated-console template code distributes
A and the C contracts; it must not distribute B's premises, endpoints, artwork
handles or approved examples as defaults. A graph provider adapter may be a
reusable optional integration, but the base planner never imports its client.
The current art-graph adapter expects two particular read operations; it is
not yet a universal graph protocol.

## Concrete repository routing

- `packages/storyboard/src/`: provider-neutral storyboard/review contracts,
  compiler, validation, planning and critic functions. No brand, catalog seeds,
  renderer, provider secret or artwork naming convention.
- `packages/skills/social-media/`: social-domain concept/reference contracts,
  grounding checks, generic tools and channel Action contracts. A reusable social
  pack is distinct from the base agent and from one store's content library.
- `packages/storyboard-corpus/`: portable bounded acquisition/analysis machinery
  and versioned extraction contracts. Provider adapters can live here without
  entering the runtime planner. Bucket/project/model are operator inputs.
- `packages/marketing-os/templates/agents/`: tenant-scoped wiring around the
  shared contracts, existing broker/repo seams and Mastra. Canonical package
  changes precede vendored template changes; hosted/generated parity must be
  verified separately. Store runtime copies are deployment artifacts, not an
  independent source for reusable behavior.
- `marketplace/agents/social/concepts/`: store-owned instances of the Post
  Concept contract. Proposed recipes stay research drafts until reviewed.
- `marketplace/agents/social/reference/`: store-selected/admitted knowledge
  snapshot, lineage to source exemplars, graph/catalog configuration and asset
  constraints. A source corpus is not automatically a served reference library.
- `marketplace/agents/social/research/storyboard-harness/`: Arthaus experiments,
  candidate series, board comparisons and review corrections. Raw/private media
  remain in scoped blob storage; credentials never enter these files.

Existing core diagnosis/pilot history may mention the first store as a case
study; it is not a second canonical store registry. New concrete creative runs
and Arthaus editorial decisions belong in marketplace. The latest detailed live
review and series proposals are moved there with the companion PR.

## Graph and dataset knowledge are different resources

The artwork/catalog graph finds **subjects and relationships**. The corpus
knowledge representation retrieves **observed creative mechanisms and their
support**. A persona MCP provides optional **audience context**; Creative Review
provides optional **outcome assessment**. Neither implementation is added here.
Do not union their nodes into an unscoped graph or make a product relationship
stand in for evidence that a post archetype performs.

A future corpus projection should connect source post → ordered media → visible
observations/transitions → proposed narrative grouping → reviewed pattern or
content archetype, retaining exact locators and annotation/schema revisions.
A store concept references the selected pattern revision; its instance binds
current graph/catalog subjects, then produces boards, decisions and separately
measured channel outcomes. Graph/search indexes are rebuildable projections;
source artifacts and review ledgers retain authority. This projection and the
full durable instance lineage are planned, not implemented by this boundary PR.

Preserve these separations in every extraction/library change:

1. Visible observations vs inferred narrative purpose vs performance claims.
2. Single-image treatment support vs ordered sequence/transition support.
3. Model proposal vs human-reviewed admission vs store-specific validation.
4. Dataset engagement associations vs measured outcomes for the publishing store.
5. Post-level exemplars vs account replication; counts derive from inspected
   members, never a model's assertion. Researched claims carry no count.
6. Public/shareable abstraction vs tenant-private source, taste and outcome data.

A library snapshot needs explicit domain/tenant scope, revision, evidence status,
source lineage and retrieval eligibility. Unreviewed/zero-evidence recipes cannot
silently become counted defaults. The existing pattern/reference schemas and
checks cover parts of this; the full library admission/projection pipeline is
still roadmap work. Do not invent a implemented generic knowledge graph merely
because extraction JSON exists. Raw competitor pixels/copy are references to
inspect, not default production assets or copy to repeat.

## Store graph configuration contract

The shared subject collector now uses exact handles by default. It no longer
strips `-old` or `-no-frame` suffixes. The runtime optionally reads the tenant's
`social/reference/art-graph.json`, version 1:

```json
{
  "version": 1,
  "connections": {
    "enabled_connection_prefix": {
      "facetHandleAliases": { "catalog-handle": "graph-facet-handle" }
    }
  }
}
```

Only the selected connection's explicit map applies. The runtime reads this
artifact through the tenant repo binding; the model cannot pass a mapping.
Absent config means exact identity; malformed config fails closed. Alias lookup
changes only the facet query and join, never the exact catalog handle. Another
store's suffix convention or graph result cannot authorize a substitute product.
No mapping implies stock, rights, dimensions or a bare-artwork master.

Arthaus's known alias and candidate recipes live in the companion marketplace
PR. That repo still needs the new runtime revision/configuration deployed before
the mapping is consumed. This change does not complete scaffold/hosted/MCP parity,
admit corpus patterns, activate concepts or grant publishing consent.
