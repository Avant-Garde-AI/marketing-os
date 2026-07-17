/**
 * verify-ig-publish — SM2 acceptance probe for the Instagram adapter's
 * CREATE path, against the live account, WITHOUT publishing.
 *
 * Runs the first half of the IG Content Publishing flow using the adapter's
 * own functions (lib/social/channels/instagram.ts — this script imports them,
 * so what's verified is the shipped code path, not a re-implementation):
 *
 *   1. resolve the IG user id (/me on graph.instagram.com/v23.0)
 *   2. POST /{user-id}/media — create the media container (INERT: nothing
 *      appears on the profile or anywhere else)
 *   3. GET /{container-id}?fields=status_code — poll until it settles
 *   4. STOP. media_publish is deliberately never called — that is the
 *      irreversible step, and it stays behind the spec 20 approval gate.
 *
 * Unpublished containers expire on Meta's side after ~24h; nothing to clean up.
 *
 * Usage:
 *   ARTHAUS_IG_ACCESS_TOKEN=... npx tsx scripts/verify-ig-publish.ts <public-image-url> [caption]
 *
 * The image URL must be PUBLIC and a JPEG (IG rejects PNG) — a design-surface
 * export URL with ?format=jpeg, or any public JPEG for a plumbing check.
 * Optional env: ARTHAUS_IG_USER_ID / SOCIAL_IG_USER_ID to skip the /me lookup.
 */

import {
  igContainerStatus,
  igCreateContainer,
  igResolveUserId,
} from "../packages/marketing-os/templates/agents/lib/social/channels/instagram";

async function main(): Promise<void> {
  const token = process.env.SOCIAL_IG_ACCESS_TOKEN ?? process.env.ARTHAUS_IG_ACCESS_TOKEN;
  if (!token) {
    console.error("Missing ARTHAUS_IG_ACCESS_TOKEN (or SOCIAL_IG_ACCESS_TOKEN) in the environment.");
    process.exit(2);
  }
  const imageUrl = process.argv[2];
  if (!imageUrl) {
    console.error("Usage: npx tsx scripts/verify-ig-publish.ts <public-image-url> [caption]");
    process.exit(2);
  }
  const caption =
    process.argv[3] ??
    "[Marketing OS SM2 verify — dry container, never published; expires automatically]";

  console.log("== Instagram publish-path verification (DRY — no media_publish) ==");
  console.log(`image_url: ${imageUrl}`);

  const userId = await igResolveUserId(token);
  console.log(`ig user id: ${userId}`);

  const containerId = await igCreateContainer(token, userId, { imageUrl, caption });
  console.log(`container created: ${containerId}`);

  // Poll the container a few times so the settled status is visible.
  for (let i = 0; i < 6; i++) {
    const { statusCode, status } = await igContainerStatus(token, containerId);
    console.log(`container status [${i}]: ${statusCode}${status ? ` (${status})` : ""}`);
    if (statusCode === "FINISHED") {
      console.log("\nRESULT: container reached FINISHED — the adapter's create path works against");
      console.log("the live account. media_publish was NOT called; nothing was posted.");
      return;
    }
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      console.error(`\nRESULT: container ${statusCode} — check that the image URL is a public JPEG.`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("\nRESULT: container created but still IN_PROGRESS after polling — create path OK;");
  console.log("re-check its status later. media_publish was NOT called; nothing was posted.");
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
