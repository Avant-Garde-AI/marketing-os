/**
 * VENDORED from packages/skills/social-media (the CANONICAL source, spec 24
 * SM0/SM2 + spec 26 — its test suite lives there). Keep this file faithful
 * below this header; fix bugs upstream first, then re-vendor.
 */
/**
 * Claims — a post may not assert what its bound data does not support.
 *
 * The register rules (a store's `doNot`) govern how a brand SOUNDS. They have
 * nothing to say about truth, and copy can satisfy every one of them while
 * misattributing the thing it is about. That distinction stopped being
 * academic the first time this agent was given real latitude: for a painting by
 * 83 Oranges it wrote "by artist Céleste Vocs" — an invented person, credited
 * for a real work — and pointed the link at a domain the store does not own.
 * No register rule was broken.
 *
 * A model fills gaps. That is not a defect to be prompted away; it is what a
 * model does when a fact is missing. So the fix is not a better instruction, it
 * is refusing the write.
 *
 * DOMAIN-NEUTRAL ON PURPOSE. The pack does not know what an "artist" is. It
 * knows that a store can declare which ENTITIES a post is allowed to name and
 * which HOSTS it may link to. An art marketplace passes artist and work; a
 * apparel store would pass a designer or a collaborator. The rule is the same:
 * name what is bound, link where you own.
 */

/** What the store says this post is actually about. */
import { checkColorClaims, type PaletteColor } from "./palette";

export interface BoundFacts {
  /**
   * Every entity the copy may name — people, works, collections. Matching is
   * case-insensitive and containment-based, so "83 Oranges" covers
   * "the artists of 83 Oranges".
   */
  entities?: string[];
  /** Hosts a link may point at. Site-relative paths are always allowed. */
  allowedLinkHosts?: string[];
  /** Slug the target link should contain, when the post is about one thing. */
  handle?: string;
  /**
   * Social handles the copy may @-mention, without the leading "@".
   *
   * A mention is not decoration: on every network it resolves to a REAL
   * account. Tagging the wrong one credits a stranger for someone's work and
   * notifies them about it, so an unbound @mention is a heavier mistake than an
   * unbound name in prose, not a lighter one.
   */
  allowedHandles?: string[];
  /**
   * The work's dominant colours, extracted from its actual pixels.
   *
   * This is the only bound fact derived from the IMAGE rather than from a
   * record, and it exists because every fabrication this store has shipped was
   * a colour claim: a teal botanical described as "warm terracotta and ochre",
   * a black-ink drawing as "dusty rose, sage and pale yellow". Names, handles
   * and links could be checked against a list; a sentence about how something
   * LOOKS had nothing to be compared against until now.
   *
   * Omitted means unchecked, and `checked` says so rather than implying the
   * copy passed.
   */
  palette?: PaletteColor[];
}

export interface ClaimProblem {
  id:
    | "unbound-entity"
    | "unbound-entity-claim"
    | "foreign-link"
    | "bad-link"
    | "link-not-the-subject"
    | "unbound-handle"
    | "unbound-handle-claim"
    | "unsupported-color-claim";
  detail: string;
  severity: "blocking" | "warning";
}

export interface ClaimReport {
  ok: boolean;
  problems: ClaimProblem[];
  checked: string[];
}

/**
 * Attribution phrases. Deliberately narrow: this looks for copy that CREDITS
 * someone ("by X", "artist X", "from X"), not every capitalised word. A checker
 * that flags every proper noun would flag the brand, the city and the season,
 * and a checker that cries wolf gets switched off.
 */
const CREDIT = /\b(?:by|artist|artists|from the studio of|photographed by)\s+([A-Z][\p{L}'’.&-]*(?:\s+[A-Z0-9][\p{L}0-9'’.&-]*){0,3})/gu;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function namesAnEntity(named: string, entities: string[]): boolean {
  const n = norm(named);
  return entities.some((e) => {
    const v = norm(e);
    return v.includes(n) || n.includes(v);
  });
}

/**
 * Check a post's copy and link against what the store bound.
 *
 * Returns problems rather than throwing — a caller may want to report them
 * (a review surface) or refuse (the authoring write). `upsertPost` refuses.
 */
export function checkPostClaims(
  post: { copy?: string | null; targetLink?: string | null },
  bound: BoundFacts = {},
): ClaimReport {
  const problems: ClaimProblem[] = [];
  const copy = String(post.copy ?? "");
  const entities = (bound.entities ?? []).filter(Boolean);

  for (const m of copy.matchAll(CREDIT)) {
    const named = m[1]!.trim().replace(/[.,;:]$/, "");
    if (entities.length === 0) {
      problems.push({
        id: "unbound-entity-claim",
        detail: `copy credits "${named}" but the post has no bound entities to check it against`,
        severity: "blocking",
      });
      continue;
    }
    if (!namesAnEntity(named, entities)) {
      problems.push({
        id: "unbound-entity",
        detail: `copy credits "${named}", which is not among this post's bound entities (${entities.join(", ")})`,
        severity: "blocking",
      });
    }
  }

  // @mentions. Matched before links so a handle is never mistaken for one.
  const handles = (bound.allowedHandles ?? []).map((h) => h.replace(/^@/, "").toLowerCase());
  for (const m of copy.matchAll(/(?:^|[\s(])@([A-Za-z0-9._]{1,30})\b/g)) {
    const tag = m[1]!.toLowerCase();
    if (handles.length === 0) {
      problems.push({
        id: "unbound-handle-claim",
        detail: `copy tags @${m[1]} but the post has no bound handles to check it against`,
        severity: "blocking",
      });
      continue;
    }
    if (!handles.includes(tag)) {
      problems.push({
        id: "unbound-handle",
        detail: `copy tags @${m[1]}, which is not among this post's bound handles (${handles.map((h) => "@" + h).join(", ")})`,
        severity: "blocking",
      });
    }
  }

  const hosts = (bound.allowedLinkHosts ?? []).map((h) => h.toLowerCase());
  const links = [post.targetLink ?? "", ...(copy.match(/https?:\/\/\S+/g) ?? [])].filter(Boolean);
  for (const l of links) {
    if (l.startsWith("/")) continue; // site-relative is always the store's own
    let host: string;
    try {
      host = new URL(l).host.toLowerCase();
    } catch {
      problems.push({ id: "bad-link", detail: `not a URL: ${l}`, severity: "blocking" });
      continue;
    }
    // With no allow-list the store has not said what it owns, so this cannot be
    // judged — and guessing would block legitimate links. Silence is correct.
    if (hosts.length > 0 && !hosts.includes(host)) {
      problems.push({
        id: "foreign-link",
        detail: `link points at "${host}", which is not one of this store's hosts (${hosts.join(", ")})`,
        severity: "blocking",
      });
    }
  }

  if (bound.handle && post.targetLink && !String(post.targetLink).includes(bound.handle)) {
    // A store host with the wrong slug is a mistake worth a human's eye, not a
    // fabricated fact — and a guard that blocks on everything gets bypassed.
    problems.push({
      id: "link-not-the-subject",
      detail: `targetLink "${post.targetLink}" does not contain the bound handle "${bound.handle}"`,
      severity: "warning",
    });
  }

  // Colour claims, against the work's own pixels. BLOCKING, like the other
  // attribution checks: describing a teal work as terracotta is the same
  // species of error as crediting the wrong artist — a confident statement
  // about someone's work that is simply untrue — and it reaches a reader the
  // same way.
  const palette = bound.palette ?? [];
  for (const c of checkColorClaims(copy, palette)) {
    problems.push({ id: "unsupported-color-claim", detail: c.detail, severity: "blocking" });
  }

  return {
    ok: !problems.some((p) => p.severity === "blocking"),
    problems,
    checked: [
      "unbound-entity",
      "unbound-entity-claim",
      "unbound-handle",
      "unbound-handle-claim",
      "foreign-link",
      "bad-link",
      "link-not-the-subject",
      // Named only when a palette was supplied: an absent palette means the
      // colour claims went UNCHECKED, and saying otherwise would let a caller
      // read silence as approval.
      ...(palette.length > 0 ? ["unsupported-color-claim"] : []),
    ],
  };
}

/** The message a refused write reports. Blocking problems only. */
export function claimRefusal(report: ClaimReport): string {
  const blocking = report.problems.filter((p) => p.severity === "blocking");
  return (
    `This post asserts things its bound data does not support, so it was not saved:\n` +
    blocking.map((p) => `  - ${p.detail}`).join("\n") +
    `\nFix the copy, or bind the facts (boundFacts.entities / allowedLinkHosts) if they are real.`
  );
}
