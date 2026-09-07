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
}

export interface ClaimProblem {
  id: "unbound-entity" | "unbound-entity-claim" | "foreign-link" | "bad-link" | "link-not-the-subject";
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

  return {
    ok: !problems.some((p) => p.severity === "blocking"),
    problems,
    checked: ["unbound-entity", "unbound-entity-claim", "foreign-link", "bad-link", "link-not-the-subject"],
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
