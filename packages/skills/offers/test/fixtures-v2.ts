import type { OfferConcept } from "../src/schema-v2";

export const IMG = "https://cdn.shopify.com/s/files/1/0001/room.jpg";

/** A 3-step zero-party quiz: choice → email → picks. */
export function quizConcept(): OfferConcept {
  return {
    archetype: "zero-party-quiz",
    title: "Which room are you furnishing?",
    hypothesis: "Collectors buy for a specific room; asking first makes the picks feel curated.",
    composition: "split-image",
    steps: [
      {
        id: "hook",
        kind: "hook",
        blocks: [
          { kind: "image", src: IMG, alt: "A living room with framed prints" },
          { kind: "eyebrow", text: "Art for your walls" },
          { kind: "headline", text: "Art for the room", accent: "you're working on." },
          {
            kind: "choice",
            question: "Which room is it for?",
            answerKey: "room",
            options: [
              { value: "living", label: "Living room" },
              { value: "bedroom", label: "Bedroom" },
            ],
          },
          { kind: "progress" },
          { kind: "decline", text: "Not right now" },
        ],
      },
      {
        id: "ask",
        kind: "ask",
        blocks: [
          { kind: "headline", text: "Where should we send your picks?" },
          { kind: "email", placeholder: "Email address", cta: "Send my picks" },
          { kind: "consent", text: "By joining you agree to receive marketing emails. Unsubscribe anytime." },
          { kind: "progress" },
        ],
      },
      {
        id: "reward",
        kind: "reward",
        blocks: [
          {
            kind: "reward",
            mode: "picks",
            headline: "Your picks",
            picks: {
              living: [{ title: "Large-format prints", url: "/collections/large-format" }],
              bedroom: [{ title: "Quiet prints", url: "/collections/quiet", imageSrc: IMG }],
            },
            link: { label: "See all", href: "/collections/all" },
          },
        ],
      },
    ],
    incentive: { type: "content" },
  };
}

/** A one-step editorial concept, no incentive. */
export function editorialConcept(): OfferConcept {
  return {
    archetype: "quiet-editorial",
    title: "The collector's list",
    hypothesis: "Premium buyers respond to access, not discounts.",
    composition: "editorial-type",
    steps: [
      {
        id: "only",
        kind: "hook",
        blocks: [
          { kind: "headline", text: "Join the collector's list" },
          { kind: "body", text: "First look at new editions, and the stories behind them." },
          { kind: "email", cta: "Join" },
          { kind: "consent", text: "By joining you agree to receive marketing emails from us." },
          { kind: "decline", text: "Maybe later" },
        ],
      },
    ],
    incentive: { type: "none" },
  };
}
