/**
 * The domain a handoff cookie must be scoped to so BOTH the console and the
 * embedded Design Studio receive it.
 *
 * Its own module because a Next route handler may only export a fixed set of
 * fields — exporting a helper from route.ts fails the build — and because this
 * is the one piece of the handoff with a wrong answer that fails silently: a
 * cookie scoped too narrowly never reaches the canvas and presents as "the
 * login keeps coming back", with nothing in the logs.
 */

/**
 * Longest shared domain suffix, or null when the two hosts share none.
 *
 * Null rather than a guess. If the Studio is not same-site with the console no
 * cookie we set can reach it, and the caller should say so loudly instead of
 * setting one that cannot work.
 *
 * At least two labels: a single label is a public suffix (".cloud", ".com")
 * and browsers refuse cookies scoped to one. That rule is also what stops
 * "evil-arthaus.cloud" from sharing a domain with "www.arthaus.cloud" — they
 * share only "cloud", which is correctly rejected.
 */
export function sharedCookieDomain(consoleHost: string, penpotHost: string): string | null {
  const c = consoleHost.toLowerCase().split(":")[0]!;
  const p = penpotHost.toLowerCase().split(":")[0]!;
  if (!c || !p) return null;
  if (c === p) return c;

  const cp = c.split(".");
  const pp = p.split(".");
  const shared: string[] = [];
  for (let i = 1; i <= Math.min(cp.length, pp.length); i++) {
    const a = cp[cp.length - i];
    if (a !== pp[pp.length - i]) break;
    shared.unshift(a!);
  }
  return shared.length >= 2 ? `.${shared.join(".")}` : null;
}
