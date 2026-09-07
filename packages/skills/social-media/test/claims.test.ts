import { describe, expect, it } from "vitest";
import { checkPostClaims } from "../src/claims";
import { upsertPost } from "../src/authoring";
import type { SocialRepo } from "../src/types";

const memoryRepo = (): SocialRepo & { files: Map<string, string> } => {
  const files = new Map<string, string>();
  return {
    files,
    readFile: async (p) => files.get(p) ?? null,
    writeFile: async (p, c) => { files.set(p, c); },
    list: async () => [],
  };
};

const BOUND = { entities: ["83 Oranges", "Road To Heaven"], allowedLinkHosts: ["myarthaus.com"], handle: "10157-road-to-heaven" };
const base = { id: "2026-10-01-x", channel: "instagram", targetLink: "/products/10157-road-to-heaven" };

describe("checkPostClaims", () => {
  it("passes copy that credits a bound entity", () => {
    expect(checkPostClaims({ copy: 'A quiet corner. "Road To Heaven" by 83 Oranges.', targetLink: "/p/x" }, BOUND).ok).toBe(true);
  });

  it("blocks a credit that is not bound — the Céleste Vocs failure", () => {
    const r = checkPostClaims({ copy: "'Road to Heaven' by artist Céleste Vocs." }, BOUND);
    expect(r.ok).toBe(false);
    expect(r.problems[0]!.id).toBe("unbound-entity");
  });

  it("blocks a credit when nothing is bound — the state that produces inventions", () => {
    const r = checkPostClaims({ copy: "A study by Marina Held." }, {});
    expect(r.ok).toBe(false);
    expect(r.problems[0]!.id).toBe("unbound-entity-claim");
  });

  it("matches loosely enough for natural phrasing", () => {
    expect(checkPostClaims({ copy: "From their studio, the artists of 83 Oranges work in miniature." }, BOUND).ok).toBe(true);
  });

  it("blocks a link off the store's hosts", () => {
    const r = checkPostClaims({ copy: "x", targetLink: "https://arthaus.com/products/x" }, BOUND);
    expect(r.problems.some((p) => p.id === "foreign-link")).toBe(true);
  });

  it("allows site-relative links and store hosts", () => {
    expect(checkPostClaims({ copy: "x", targetLink: "/products/10157-road-to-heaven" }, BOUND).ok).toBe(true);
    expect(checkPostClaims({ copy: "x", targetLink: "https://myarthaus.com/products/10157-road-to-heaven" }, BOUND).ok).toBe(true);
  });

  it("says nothing about links when the store has not declared its hosts", () => {
    // Guessing would block legitimate links; silence is the honest answer.
    expect(checkPostClaims({ copy: "x", targetLink: "https://anywhere.example/x" }, { entities: ["a"] }).ok).toBe(true);
  });

  it("warns rather than blocks on a store host with the wrong slug", () => {
    const r = checkPostClaims({ copy: "x", targetLink: "https://myarthaus.com/products/other" }, BOUND);
    expect(r.ok).toBe(true);
    expect(r.problems.some((p) => p.id === "link-not-the-subject" && p.severity === "warning")).toBe(true);
  });
});

describe("upsertPost refuses a fabricated post", () => {
  it("does not write when copy credits an unbound entity", async () => {
    const repo = memoryRepo();
    await expect(
      upsertPost(repo, { ...base, copy: "'Road to Heaven' by artist Céleste Vocs." }, BOUND),
    ).rejects.toThrow(/Céleste Vocs/);
    // The point of refusing at the write: nothing lands for review to trust.
    expect(repo.files.size).toBe(0);
  });

  it("writes when the credit is bound, and reports warnings without blocking", async () => {
    const repo = memoryRepo();
    const r = await upsertPost(
      repo,
      { ...base, copy: '"Road To Heaven" by 83 Oranges.', targetLink: "https://myarthaus.com/products/other" },
      BOUND,
    );
    expect(r.created).toBe(true);
    expect(repo.files.size).toBe(1);
    expect(r.claimWarnings?.[0]).toMatch(/does not contain the bound handle/);
  });

  it("still refuses an unbound credit when no facts are supplied at all", async () => {
    const repo = memoryRepo();
    await expect(upsertPost(repo, { ...base, copy: "A study by Marina Held." })).rejects.toThrow(/no bound entities/);
    expect(repo.files.size).toBe(0);
  });

  it("leaves ordinary copy alone", async () => {
    const repo = memoryRepo();
    const r = await upsertPost(repo, { ...base, copy: "A wall that finally feels finished." });
    expect(r.created).toBe(true);
  });
});

describe("social handles", () => {
  const B = { entities: ["83 Oranges"], allowedHandles: ["83oranges"], allowedLinkHosts: ["myarthaus.com"] };

  it("allows a bound @mention", () => {
    expect(checkPostClaims({ copy: "Work by 83 Oranges. @83oranges", targetLink: "/p/x" }, B).ok).toBe(true);
  });

  it("blocks an invented @mention — it resolves to a real stranger's account", () => {
    const r = checkPostClaims({ copy: "Work by 83 Oranges. @celeste.vocs.studio", targetLink: "/p/x" }, B);
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.id === "unbound-handle")).toBe(true);
  });

  it("blocks tagging anyone when no handles are bound", () => {
    const r = checkPostClaims({ copy: "See @someone" }, {});
    expect(r.problems.some((p) => p.id === "unbound-handle-claim")).toBe(true);
  });

  it("tolerates a leading @ in the bound list", () => {
    expect(checkPostClaims({ copy: "@83oranges" }, { allowedHandles: ["@83oranges"] }).ok).toBe(true);
  });

  it("does not mistake an email for a mention", () => {
    expect(checkPostClaims({ copy: "Reach us at hello@myarthaus.com" }, { allowedHandles: ["83oranges"] }).ok).toBe(true);
  });
});
