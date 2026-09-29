/**
 * The offer design harness's pure path (spec 34): prompt/brief inputs, the
 * wire ↔ concept mapping and validation, critic-output parsing, the
 * mechanical conformance critic, repair eligibility, quota, render plans and
 * selection glue. Ported from the hosted app's scripts/test-offer-harness.mts
 * (node:test) when the harness moved into the pack; assertions unchanged
 * (node:assert under vitest). The app keeps only its model-client and
 * render-token tests.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  brandExcerpt,
  conceptSystemPrompt,
  conceptToWire,
  conceptUserPrompt,
  conformanceVerdict,
  darkPatternVerdict,
  designStyleTokens,
  freeQuota,
  incumbentArmFor,
  isHarnessDraft,
  NEUTRAL_STYLE,
  parseConcepts,
  parseCriticOutput,
  parseDesignRequest,
  placementFor,
  previewQuery,
  renderPlan,
  repairable,
  repairUserPrompt,
  wireToConcept,
  withPinnedLeadImage,
  allowedImagesFor,
  parseRemixRequest,
  variantToConcept,
  groundPicks,
  withStorefrontFonts,
  aggregateCriticScores,
  compileOfferManifestV2,
  gradeOfferAudit,
  OfferConceptSchema,
  selectArms,
  type AuditFacts,
  type ConceptRender,
  type DiagReport,
  type HarnessBrief,
  type OfferConcept,
} from "../src/harness/index";

const IMG = "https://cdn.shopify.com/s/files/1/0001/files/room.jpg?v=1";

const DESIGN_MD = `---
name: Test
colors:
  warm-parchment: "#F5F2ED"
  charcoal: "#2D2D2D"
  warm-gray: "#6B6560"
  bronze: "#B07D4F"
  primary: "{colors.bronze}"
  background: "{colors.warm-parchment}"
  text: "{colors.charcoal}"
  text-secondary: "{colors.warm-gray}"
typography:
  display:
    fontFamily: "Playfair Display, Georgia, serif"
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
  specs:
    fontFamily: "'IBM Plex Mono', monospace"
---
# Design`;

const brief: HarnessBrief = {
  shop: "t.myshopify.com",
  storeName: "Test",
  storefrontUrl: "https://example.com",
  goal: "Grow the list without discounting",
  constraints: {},
  brand: "## Voice\nQuiet.",
  design: "",
  style: NEUTRAL_STYLE,
  styleSource: "neutral",
  products: [{ title: "Room print", url: "/products/room", imageSrc: IMG, imageAlt: "Room print" }],
  audit: null,
  pastOffers: [],
};

/** A valid 3-step quiz concept in the MODEL-FACING wire shape. */
function wireQuiz(): Record<string, unknown> {
  return {
    archetype: "zero-party-quiz",
    title: "Which room?",
    hypothesis: "Room-led curators answer a room question and convert on picks.",
    personaRef: "Modern Nest Curator",
    composition: "split-image",
    imageSrc: IMG,
    incentive: { type: "content", value: 0, codeMode: "" },
    trigger: { kind: "delay", seconds: 8 },
    steps: [
      {
        id: "hook",
        kind: "hook",
        blocks: [
          { kind: "headline", text: "Which wall are you", accent: "working on?" },
          { kind: "choice", question: "The room", answerKey: "room", options: [{ value: "living", label: "Living" }, { value: "bed", label: "Bedroom" }] },
          { kind: "decline", text: "Not now" },
        ],
      },
      {
        id: "ask",
        kind: "ask",
        blocks: [
          { kind: "headline", text: "Where should we send it?" },
          { kind: "email", text: "Send my picks", placeholder: "Email" },
          { kind: "consent", text: "Room picks weekly at most. Unsubscribe anytime." },
        ],
      },
      {
        id: "reward",
        kind: "reward",
        blocks: [
          {
            kind: "reward",
            mode: "picks",
            text: "Start here.",
            accent: "Two pieces for that wall.",
            picks: [
              { answer: "living", title: "Room print", url: "/products/room" },
              { answer: "bed", title: "Room print", url: "/products/room", imageSrc: IMG },
            ],
            link: { label: "See all", href: "/collections/all" },
          },
        ],
      },
    ],
  };
}

function concept(overrides: Partial<OfferConcept> = {}): OfferConcept {
  const c = OfferConceptSchema.parse(wireToConcept(wireQuiz()));
  return { ...c, ...overrides };
}

// --- brand inputs -----------------------------------------------------------

test("designStyleTokens resolves {colors.x} references and picks display/body/mono faces", () => {
  const { style, source } = designStyleTokens(DESIGN_MD);
  assert.equal(source, "DESIGN.md");
  assert.equal(style.bg, "#F5F2ED");
  assert.equal(style.ink, "#2D2D2D");
  assert.equal(style.ink2, "#6B6560");
  assert.equal(style.accent, "#B07D4F");
  assert.equal(style.line, "rgba(45,45,45,.16)");
  assert.equal(style.font, "DM Sans, system-ui, sans-serif");
  assert.equal(style.fontDisplay, "Playfair Display, Georgia, serif");
  assert.equal(style.fontMono, "'IBM Plex Mono', monospace");
});

test("designStyleTokens falls back to neutral without usable front matter", () => {
  assert.equal(designStyleTokens(null).source, "neutral");
  assert.equal(designStyleTokens("# no front matter").source, "neutral");
  assert.deepEqual(designStyleTokens("---\ncolors:\n  accent: '#fff'\n---").style, NEUTRAL_STYLE);
});

test("brandExcerpt keeps the voice/audience sections and respects the budget", () => {
  const md = "---\nx: 1\n---\n# Brand\n## History\nlong ago\n## Voice & Tone\nquiet, exact\n## Audience Architecture\nModern Nest Curator\n";
  const out = brandExcerpt(md);
  assert.match(out, /Voice & Tone/);
  assert.match(out, /Modern Nest Curator/);
  assert.doesNotMatch(out, /long ago/);
  assert.ok(brandExcerpt("## Voice\n" + "x".repeat(9000), 100).length < 140);
});

// --- prompts ------------------------------------------------------------------

test("concept prompts carry the catalog, the refusals and the brief", () => {
  const sys = conceptSystemPrompt();
  for (const needle of ["zero-party-quiz", "quiet-editorial", "confirmshaming", "countdowns", "JSON field usage", "unsubscribe"]) {
    assert.ok(sys.includes(needle), `system prompt mentions ${needle}`);
  }
  const user = conceptUserPrompt({ ...brief, constraints: { margin: { grossMarginPct: 55, floorPct: 40 } } }, "too similar");
  assert.match(user, /percent cap: 15%/);
  assert.match(user, /image https:\/\/cdn\.shopify\.com/);
  assert.match(user, /previous set was rejected: too similar/);
  const repair = repairUserPrompt(brief, concept(), [{ critic: "brand", score: 0.4, pass: false, notes: "generic", patch: "use the room image" }]);
  assert.match(repair, /suggested: use the room image/);
  assert.match(repair, /"text": "Send my picks"/, "repair shows the concept in the wire shape");
});

// --- wire ↔ concept -------------------------------------------------------------

test("wireToConcept maps the compact wire blocks onto the pack union", () => {
  const c = concept();
  const email = c.steps[1]!.blocks.find((b) => b.kind === "email");
  assert.deepEqual(email, { kind: "email", cta: "Send my picks", placeholder: "Email" });
  const reward = c.steps[2]!.blocks[0]!;
  assert.equal(reward.kind, "reward");
  if (reward.kind === "reward") {
    assert.equal(reward.headline, "Start here.");
    assert.equal(reward.body, "Two pieces for that wall.");
    assert.deepEqual(Object.keys(reward.picks ?? {}), ["living", "bed"]);
  }
  assert.deepEqual(c.incentive, { type: "content" });
});

test("conceptToWire → wireToConcept round-trips", () => {
  const c = concept();
  assert.deepEqual(OfferConceptSchema.parse(wireToConcept(conceptToWire(c))), c);
});

test("parseConcepts enforces the brief's image allow-list, the percent cap and one email", () => {
  const good = wireQuiz();
  const foreignImage = { ...wireQuiz(), title: "Foreign", imageSrc: "https://cdn.shopify.com/other.jpg" };
  const greedy = { ...wireQuiz(), title: "Greedy", incentive: { type: "percent", value: 30 } };
  const twoEmails = wireQuiz();
  (twoEmails.steps as { blocks: unknown[] }[])[0]!.blocks.push({ kind: "email", text: "Go" }, { kind: "consent", text: "Unsubscribe anytime, promise." });
  const bogus = { title: "Bogus", steps: [] };
  const r = parseConcepts({ concepts: [good, foreignImage, greedy, twoEmails, bogus] }, brief);
  assert.equal(r.concepts.length, 1);
  assert.deepEqual(r.rejected.map((x) => x.title), ["Foreign", "Greedy", "Which room?", "Bogus"]);
  assert.match(r.rejected[1]!.errors.join(), /exceeds the 20% cap/);
  assert.match(r.rejected[2]!.errors.join(), /exactly one email/);
});

test("parseDesignRequest keeps only well-formed constraints", () => {
  assert.deepEqual(parseDesignRequest({}), { error: "goal (string) is required" });
  const ok = parseDesignRequest({
    goal: "  grow  ",
    constraints: { placement: "takeover", incentiveTypes: ["none", "spin-to-win"], margin: { grossMarginPct: 60, floorPct: 40 } },
  });
  assert.deepEqual(ok, { goal: "grow", constraints: { placement: "takeover", incentiveTypes: ["none"], margin: { grossMarginPct: 60, floorPct: 40 } } });
  const bad = parseDesignRequest({ goal: "g", constraints: { placement: "bar", margin: { grossMarginPct: 40, floorPct: 50 } } });
  assert.deepEqual(bad, { goal: "g", constraints: {} });
});

// --- critics ----------------------------------------------------------------------

test("parseCriticOutput fails closed and enforces the 0.7 pass bar", () => {
  assert.deepEqual(parseCriticOutput("brand", { score: 0.9, pass: true, notes: "on palette", patch: "" }), {
    critic: "brand",
    score: 0.9,
    pass: true,
    notes: "on palette",
  });
  assert.equal(parseCriticOutput("brand", { score: 0.6, pass: true, notes: "meh" }).pass, false);
  assert.equal(parseCriticOutput("brand", { score: 1.7, pass: true, notes: "x" }).score, 1);
  const unexplained = parseCriticOutput("persona", { score: 0.95, pass: true, notes: "  " });
  assert.equal(unexplained.pass, false);
  assert.match(unexplained.notes, /no reasons/);
  assert.equal(parseCriticOutput("novelty", null).pass, false);
  assert.equal(parseCriticOutput("brand", { score: 0.8, pass: true, notes: "ok", patch: "tighten the headline" }).patch, "tighten the headline");
});

function diag(over: Partial<DiagReport> = {}): DiagReport {
  return {
    surfaceId: "s",
    arm: "v1",
    step: 0,
    steps: 2,
    viewport: { w: 390, h: 844 },
    composition: "split-image",
    rects: { card: { x: 20, y: 100, w: 320, h: 500 }, close: { x: 0, y: 0, w: 44, h: 44 }, cta: { x: 0, y: 0, w: 200, h: 48 }, choices: [] },
    overflow: false,
    contrast: [
      { role: "headline", fg: "#000", bg: "#fff", ratio: 12 },
      { role: "cta", fg: "#fff", bg: "#2d2d2d", ratio: 13 },
    ],
    imageLoaded: true,
    errors: [],
    ...over,
  };
}
const render = (over: Partial<ConceptRender> = {}): ConceptRender => ({
  renderId: "r",
  viewport: "mobile",
  step: 0,
  ok: true,
  ready: true,
  diag: diag(),
  ...over,
});

test("conformanceVerdict passes clean renders and names each violation", () => {
  assert.equal(conformanceVerdict([render(), render({ viewport: "desktop", diag: diag({ viewport: { w: 1440, h: 900 } }) })], "overlay").pass, true);
  const bad = conformanceVerdict(
    [
      render({
        diag: diag({
          overflow: true,
          imageLoaded: false,
          rects: { card: { x: 0, y: 0, w: 380, h: 800 }, close: { x: 0, y: 0, w: 24, h: 24 }, choices: [{ x: 0, y: 0, w: 150, h: 30 }] },
          contrast: [{ role: "body", fg: "#999", bg: "#fff", ratio: 2.8 }],
        }),
      }),
      render({ ready: false, diag: null, step: 1 }),
    ],
    "corner-card",
  );
  assert.equal(bad.pass, false);
  for (const needle of ["overflows", "image failed", "close button is 24×24", "choice 1 is 150×30", "body contrast 2.80", "97% of the phone width", "never reported ready"]) {
    assert.ok(bad.notes.includes(needle), `notes include "${needle}": ${bad.notes}`);
  }
  // Takeovers and overlays (bottom sheets on a phone) may use the full width.
  for (const placement of ["takeover", "overlay"] as const) {
    assert.equal(
      conformanceVerdict([render({ diag: diag({ rects: { card: { x: 0, y: 0, w: 390, h: 844 }, close: { x: 0, y: 0, w: 44, h: 44 }, choices: [] } }) })], placement).pass,
      true,
    );
  }
  assert.equal(conformanceVerdict([], "overlay").pass, false);
});

test("darkPatternVerdict refuses confirmshaming declines", () => {
  const shaming = concept();
  (shaming.steps[0]!.blocks[2] as { text: string }).text = "No thanks, I'd rather pay full price";
  const manifest = {
    ...compileOfferManifestV2({ surfaceSlug: "ofr_ok_c", arms: { v1: concept() }, style: NEUTRAL_STYLE }),
  };
  assert.equal(darkPatternVerdict(manifest).pass, true);
  manifest.variants.v1!.steps = shaming.steps;
  const v = darkPatternVerdict(manifest);
  assert.equal(v.pass, false);
  assert.match(v.notes, /full price/);
});

test("repairable: soft failures only", () => {
  const soft = [
    { critic: "conformance" as const, score: 1, pass: true, notes: "" },
    { critic: "brand" as const, score: 0.5, pass: false, notes: "" },
    { critic: "incumbent" as const, score: 0, pass: false, notes: "", applicable: false },
  ];
  assert.equal(repairable(soft), true);
  assert.equal(repairable([...soft, { critic: "conformance" as const, score: 0, pass: false, notes: "" }]), false);
  assert.equal(repairable([{ critic: "brand" as const, score: 1, pass: true, notes: "" }]), false);
});

// --- selection glue ---------------------------------------------------------------

test("aggregate → selectArms → final manifest with control + 2 variants + incumbent", () => {
  const verdictsA = [
    { critic: "conformance" as const, score: 1, pass: true, notes: "" },
    { critic: "dark-pattern" as const, score: 1, pass: true, notes: "" },
    { critic: "brand" as const, score: 0.9, pass: true, notes: "" },
    { critic: "persona" as const, score: 0.8, pass: true, notes: "" },
    { critic: "novelty" as const, score: 0.8, pass: true, notes: "" },
    { critic: "incumbent" as const, score: 0, pass: true, notes: "", applicable: false },
  ];
  const verdictsB = [
    { critic: "conformance" as const, score: 1, pass: true, notes: "" },
    { critic: "dark-pattern" as const, score: 1, pass: true, notes: "" },
    { critic: "brand" as const, score: 0.75, pass: true, notes: "" },
    { critic: "persona" as const, score: 0.8, pass: true, notes: "" },
    { critic: "novelty" as const, score: 0.8, pass: true, notes: "" },
    { critic: "incumbent" as const, score: 0, pass: true, notes: "", applicable: false },
  ];
  const failing = [{ critic: "dark-pattern" as const, score: 0, pass: false, notes: "" }];
  const scored = [
    { id: "b", aggregate: aggregateCriticScores(verdictsB) },
    { id: "x", aggregate: aggregateCriticScores(failing) },
    { id: "a", aggregate: aggregateCriticScores(verdictsA) },
  ];
  assert.equal(scored[1]!.aggregate.hardFail, true);
  assert.deepEqual(selectArms(scored, 2).map((s) => s.id), ["a", "b"]);

  const incumbent = incumbentArmFor({ vendor: "klaviyo", appeared: true });
  assert.deepEqual(incumbent, { vendor: "klaviyo" });
  assert.equal(incumbentArmFor({ vendor: "privy", appeared: true }), null);
  assert.equal(incumbentArmFor({ vendor: "klaviyo", appeared: false }), null);
  const m = compileOfferManifestV2({
    surfaceSlug: "ofr_final",
    arms: { v1: concept(), v2: concept({ archetype: "story" }) },
    style: NEUTRAL_STYLE,
    controlWeight: 0.25,
    incumbent,
  });
  assert.deepEqual(m.experiment.arms.map((a) => [a.key, a.kind, a.weight]), [
    ["control", "control", 0.25],
    ["v1", "variant", 0.25],
    ["v2", "variant", 0.25],
    ["incumbent", "incumbent", 0.25],
  ]);
  assert.equal(m.variants.v1!.style.bg, NEUTRAL_STYLE.bg, "style comes from tokens, not the model");
  assert.ok(m.variants.v1!.steps[0]!.blocks.some((b) => b.kind === "progress"), "multi-step flows gain progress");
});

test("placement, render plans and preview query", () => {
  // Premium out of the gate: every composition is a full takeover by default.
  for (const composition of ["card", "split-image", "editorial-type", "full-bleed-image"] as const) {
    assert.equal(placementFor({ composition }, {}), "takeover");
  }
  assert.equal(placementFor({ composition: "card" }, { placement: "overlay" }), "overlay");
  const plan = renderPlan("c1_i0", 3, true);
  assert.equal(plan.length, 7);
  assert.deepEqual(plan.at(-1), { id: "c1_i0_teaser_mobile", viewport: "mobile", step: 0, teaser: true });
  assert.equal(renderPlan("c1_i1", 1, false).length, 2);
  const q = new URLSearchParams(previewQuery("tok.en.sig", 2, true));
  assert.equal(q.get("mos_preview"), "tok.en.sig");
  assert.equal(q.get("mos_arm"), "v1");
  assert.equal(q.get("mos_step"), "2");
  assert.equal(q.get("mos_diag"), "1");
  assert.equal(q.get("mos_teaser"), "1");
  assert.equal(isHarnessDraft("ofr_habc__c3"), true);
  assert.equal(isHarnessDraft("ofr_habc"), false);
});

test("freeQuota: one run per rolling 30 days", () => {
  const now = new Date("2026-09-28T00:00:00Z");
  assert.deepEqual(freeQuota([], now), { allowed: true, retryAfter: null });
  const q = freeQuota([new Date("2026-09-10T00:00:00Z")], now);
  assert.equal(q.allowed, false);
  assert.equal(q.retryAfter, "2026-10-10T00:00:00.000Z");
  assert.equal(freeQuota([new Date("2026-08-01T00:00:00Z")], now).allowed, true);
});

// --- audit rubric (through the adapter) -------------------------------------------

test("gradeOfferAudit grades a measured popup and reports 'none' when nothing appeared", () => {
  const f: AuditFacts = {
    viewport: "mobile",
    vendor: "klaviyo",
    appeared: true,
    timeToShowMs: 1200,
    coversPct: 0.9,
    closeTarget: { w: 20, h: 20 },
    ctaTarget: { w: 300, h: 48 },
    ctaContrast: 7,
    hasImage: false,
    hasConsentText: false,
    stepCount: null,
    incentiveText: "15% off",
    visibleText: "Get 15% off. No thanks, I'd rather pay full price",
    closeVisibleAtFirstPaint: false,
    vendorScriptKb: 300,
    renderId: null,
  };
  const r = gradeOfferAudit([f]);
  assert.equal(r.vendor, "klaviyo");
  assert.ok(["D", "F"].includes(r.grade), r.grade);
  assert.ok(r.lines.some((l) => l.id === "dark-patterns" && l.verdict === "fail"));
  assert.equal(gradeOfferAudit([{ ...f, appeared: false }]).grade, "none");
});

test("wireToConcept trims an overlong repaired hypothesis instead of failing the concept", () => {
  const long = "Room-first visitors ".repeat(40);
  const c = OfferConceptSchema.parse(wireToConcept({ ...wireQuiz(), hypothesis: long }));
  assert.ok(c.hypothesis.length <= 400);
  assert.ok(c.hypothesis.endsWith("…"));
});

test("withStorefrontFonts prefers the faces the storefront renders over DESIGN.md wishes", () => {
  const { style } = designStyleTokens(DESIGN_MD);
  const out = withStorefrontFonts(style, { body: '"DM Sans", sans-serif', display: '"Playfair Display", serif', mono: null });
  assert.equal(out.font, '"DM Sans", sans-serif');
  assert.equal(out.fontDisplay, '"Playfair Display", serif');
  assert.equal(out.fontMono, style.fontMono);
  assert.equal(out.bg, style.bg);
  assert.equal(withStorefrontFonts(style, { body: "serif", display: null, mono: null }).font, style.font);
});

test("groundPicks rewrites picks from the catalog and drops invented ones", () => {
  const c = concept();
  const products = [{ title: "Room print", url: "/products/room", imageSrc: IMG, imageAlt: "x", vendor: "Tracie Andrews" }];
  const g = groundPicks(c, products);
  const reward = g.steps.flatMap((s) => s.blocks).find((b) => b.kind === "reward");
  assert.ok(reward && reward.kind === "reward");
  for (const list of Object.values(reward.picks ?? {})) {
    for (const p of list) {
      assert.equal(p.title, "Room print — Tracie Andrews");
      assert.equal(p.imageSrc, IMG);
    }
  }
  const none = groundPicks(c, [{ title: "Other", url: "/products/other", imageSrc: IMG, imageAlt: "x" }]);
  const r2 = none.steps.flatMap((s) => s.blocks).find((b) => b.kind === "reward");
  assert.ok(r2 && r2.kind === "reward" && r2.mode === "message" && !r2.picks);
});

test("groundPicks keeps a long 'title — artist' within the pick title limit", () => {
  const long = { title: "An unusually long artwork title that keeps going well past the pick limit", url: "/products/room", imageSrc: IMG, imageAlt: "x", vendor: "Someone With A Long Name" };
  const g = groundPicks(concept(), [long]);
  const reward = g.steps.flatMap((s) => s.blocks).find((b) => b.kind === "reward");
  assert.ok(reward && reward.kind === "reward");
  for (const list of Object.values(reward.picks ?? {})) for (const p of list) assert.ok(p.title.length <= 80, p.title);
  OfferConceptSchema.parse(g);
});

test("parseRemixRequest: arms in order, holdback bounds, retire list", () => {
  assert.equal(parseRemixRequest({ goal: "x" }), null);
  const r = parseRemixRequest({ remix: { arms: [{ offerId: "ofr_sofa", arm: "v1", note: "keep the reveal" }, { offerId: "ofr_room", arm: "v1" }], controlWeight: 0.1, retire: ["ofr_old", "bad id!"] } });
  assert.ok(r && !("error" in r));
  assert.deepEqual(r.arms.map((a) => a.offerId), ["ofr_sofa", "ofr_room"]);
  assert.equal(r.controlWeight, 0.1);
  assert.deepEqual(r.retire, ["ofr_old"]);
  const bad = parseRemixRequest({ remix: { arms: [{ offerId: "ofr_x" }], controlWeight: 0.05 } });
  assert.ok(bad && "error" in bad);
});

test("variantToConcept turns a live v2 variant back into a valid concept", () => {
  const c = concept();
  const variant = { composition: c.composition, steps: c.steps, incentive: c.incentive, archetype: c.archetype };
  const back = OfferConceptSchema.parse(variantToConcept(variant, { title: "The Sofa Rule", hypothesis: "Room-first visitors will answer a sizing question." }));
  assert.equal(back.title, "The Sofa Rule");
  assert.equal(back.archetype, c.archetype);
});

test("a model-written pick title over the limit is trimmed before the schema sees it", () => {
  const w = wireQuiz() as Record<string, unknown>;
  const steps = structuredClone((w as { steps: { blocks: Record<string, unknown>[] }[] }).steps);
  const reward = steps.flatMap((st) => st.blocks).find((b) => b.kind === "reward")!;
  (reward.picks as { title: string }[]).forEach((p) => (p.title = "A very long descriptive pick title that the model wrote with far too many words in it for the card"));
  const c = OfferConceptSchema.parse(wireToConcept({ ...w, steps }));
  const r = c.steps.flatMap((st) => st.blocks).find((b) => b.kind === "reward");
  assert.ok(r && r.kind === "reward");
  for (const list of Object.values(r.picks ?? {})) for (const p of list) assert.ok(p.title.length <= 80);
});

test("a missed teaser capture is not a conformance failure", () => {
  assert.equal(conformanceVerdict([render(), { ...render(), teaser: true, ready: false, diag: null }], "takeover").pass, true);
});

test("an image-led concept with its image in a later step is compiled with the image up front", () => {
  const c = concept();
  const img = { kind: "image" as const, src: IMG, alt: "Room" };
  const moved = {
    ...c,
    composition: "split-image" as const,
    steps: c.steps.map((st, i) => ({ ...st, blocks: i === 0 ? st.blocks.filter((b) => b.kind !== "image") : i === 1 ? [img, ...st.blocks.filter((b) => b.kind !== "image")] : st.blocks.filter((b) => b.kind !== "image") })),
  };
  const m = compileOfferManifestV2({ surfaceSlug: "ofr_lead_img", arms: { v1: moved }, style: NEUTRAL_STYLE });
  assert.equal(m.variants.v1!.steps[0]!.blocks.some((b) => b.kind === "image"), true);
});

test("a screen where the storefront never loaded is inconclusive when the step rendered elsewhere", () => {
  const ok = render();
  const blocked = { ...render({ viewport: "desktop" }), ready: false, diag: null, unavailable: true };
  assert.equal(conformanceVerdict([ok, blocked], "takeover").pass, true);
  // ...but a step with no clean render at all still fails.
  assert.equal(conformanceVerdict([{ ...blocked, viewport: "mobile" as const }, blocked], "takeover").pass, false);
});

test("withPinnedLeadImage puts the merchant's room shot first and keeps it", () => {
  const room = "https://cdn.shopify.com/s/files/1/2196/4605/files/collection-far-field-hero.jpg";
  const c = withPinnedLeadImage(concept(), room, "Far Field above a long sofa");
  assert.equal(c.imageSrc, room);
  const first = c.steps[0]!.blocks.find((b) => b.kind === "image");
  assert.ok(first && first.kind === "image" && first.src === room);
  assert.equal(c.steps[0]!.blocks.filter((b) => b.kind === "image").length, 1);
});

test("lifestyle shots are allowed images alongside product images", () => {
  const room = "https://cdn.shopify.com/s/files/1/room.jpg";
  const allowed = allowedImagesFor({ products: [{ title: "P", url: "/products/p", imageSrc: IMG, imageAlt: "p" }], lifestyle: [{ title: "Room", imageSrc: room, imageAlt: "r" }] });
  assert.ok(allowed.has(room) && allowed.has(IMG));
  const pr = parseRemixRequest({ remix: { arms: [{ offerId: "ofr_x", arm: "v1", imageSrc: room }, { offerId: "ofr_y", imageSrc: "https://evil.example/x.jpg" }] } });
  assert.ok(pr && !("error" in pr));
  assert.equal(pr.arms[0]!.imageSrc, room);
  assert.equal(pr.arms[1]!.imageSrc, undefined);
});
