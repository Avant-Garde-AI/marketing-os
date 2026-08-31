/**
 * Backfill: copy a store's artifacts out of the database and into its repo.
 *
 * Run this ONCE per store before flipping STORE_REPO_MODE to "mirror", so the
 * repo starts as the complete truth rather than filling in gradually while
 * reads quietly fall back to the database.
 *
 *   npx tsx scripts/backfill-artifacts-to-git.ts --shop <shop>            # dry run
 *   npx tsx scripts/backfill-artifacts-to-git.ts --shop <shop> --commit   # write
 *
 * Options:
 *   --shop <domain>   myshopify domain of the store (required)
 *   --repo <o/n>      target repo; defaults to GITHUB_REPO
 *   --prefix <p>      only paths starting with this (e.g. "email/")
 *   --commit          actually write. Without it, nothing is committed.
 *
 * Safety posture:
 *   - DRY RUN BY DEFAULT. A backfill that writes on first invocation is one
 *     you cannot safely explore with.
 *   - IDEMPOTENT. Files whose repo content already matches are skipped, so
 *     re-running makes zero commits and the second run is the verification of
 *     the first.
 *   - NON-DESTRUCTIVE. Reads the database, writes the repo. Nothing is deleted
 *     from either side, and the DB rows stay put — "mirror" still reads them
 *     and rolling back is an env var.
 *   - REPORTS DIFFERENCES rather than silently overwriting: a path that exists
 *     in both with different content is listed as a conflict and left alone.
 *     Guessing which side wins is exactly the decision a script shouldn't make.
 */

import { Pool } from "pg";
import { createGitHubStoreRepo } from "../lib/store-repo/github";
import { appAuthConfigured, installationTokenFor } from "../lib/store-repo/app-auth";

interface Args {
  shop: string;
  repo: string;
  prefix: string;
  commit: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const shop = get("--shop");
  if (!shop) {
    console.error("--shop <domain> is required (e.g. --shop acme.myshopify.com)");
    process.exit(2);
  }
  const repo = get("--repo") ?? process.env.GITHUB_REPO;
  if (!repo) {
    console.error("--repo <owner/name> is required (or set GITHUB_REPO)");
    process.exit(2);
  }
  return { shop, repo, prefix: get("--prefix") ?? "", commit: argv.includes("--commit") };
}

/** Every artifact table a pack owns. Add a row when a pack is added. */
const ARTIFACT_TABLES = [
  { table: "mos_email_artifacts", pack: "email" },
  { table: "mos_social_artifacts", pack: "social" },
];

async function main(): Promise<void> {
  const args = parseArgs();

  const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!cs) {
    console.error("SUPABASE_DATABASE_URL or DATABASE_URL must be set");
    process.exit(2);
  }

  let token = process.env.GITHUB_TOKEN ?? "";
  if (appAuthConfigured()) {
    try {
      token = await installationTokenFor(args.repo);
    } catch (e) {
      console.error(`GitHub App auth failed: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!token) {
    console.error("Need a GitHub App installation or GITHUB_TOKEN to reach the repo");
    process.exit(2);
  }

  const git = createGitHubStoreRepo({
    repo: args.repo,
    token,
    ...(process.env.GITHUB_BRANCH ? { branch: process.env.GITHUB_BRANCH } : {}),
    ...(process.env.STORE_REPO_PREFIX ? { rootPrefix: process.env.STORE_REPO_PREFIX } : {}),
    cacheTtlSeconds: 0, // always compare against what is really in the repo
  });

  const pool = new Pool({ connectionString: cs, max: 2 });
  const rows: Array<{ path: string; content: string; pack: string }> = [];

  for (const { table, pack } of ARTIFACT_TABLES) {
    try {
      const r = await pool.query(
        `SELECT path, content FROM ${table} WHERE shop = $1 AND path LIKE $2 ORDER BY path`,
        [args.shop, `${args.prefix.replace(/[%_]/g, "\\$&")}%`],
      );
      for (const row of r.rows as Array<{ path: string; content: string }>) {
        rows.push({ ...row, pack });
      }
    } catch (e) {
      // A pack that was never enabled has no table. Not an error.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/does not exist/i.test(msg)) throw e;
      console.log(`  (${table} absent — ${pack} pack not in use here)`);
    }
  }

  if (rows.length === 0) {
    console.log(`\nNothing to backfill for ${args.shop}${args.prefix ? ` under "${args.prefix}"` : ""}.`);
    await pool.end();
    return;
  }

  console.log(
    `\n${args.commit ? "BACKFILL" : "DRY RUN"} — ${rows.length} artifact(s) from ${args.shop} → ${args.repo}\n`,
  );

  const created: string[] = [];
  const identical: string[] = [];
  const conflicts: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const { path, content, pack } of rows) {
    let existing: string | null;
    try {
      existing = await git.readFile(path);
    } catch (e) {
      failed.push({ path, error: e instanceof Error ? e.message : String(e) });
      console.log(`  ERROR  ${path} — ${failed[failed.length - 1]!.error}`);
      continue;
    }

    if (existing === content) {
      identical.push(path);
      console.log(`  same   ${path}`);
      continue;
    }
    if (existing !== null) {
      // Both sides have it and they differ. Leave it: choosing a winner is a
      // human call, and a backfill that overwrites the repo would discard
      // whatever an editor changed there.
      conflicts.push(path);
      console.log(`  DIFFERS ${path}  (repo ${existing.length}b vs db ${content.length}b — left alone)`);
      continue;
    }

    if (!args.commit) {
      created.push(path);
      console.log(`  would  ${path}  (${content.length}b, ${pack})`);
      continue;
    }
    try {
      await git.writeFile(path, content);
      created.push(path);
      console.log(`  wrote  ${path}  (${content.length}b, ${pack})`);
    } catch (e) {
      failed.push({ path, error: e instanceof Error ? e.message : String(e) });
      console.log(`  ERROR  ${path} — ${failed[failed.length - 1]!.error}`);
    }
  }

  await pool.end();

  console.log(
    `\n${args.commit ? "Committed" : "Would commit"}: ${created.length}` +
      `  ·  already identical: ${identical.length}` +
      `  ·  conflicts left alone: ${conflicts.length}` +
      `  ·  failed: ${failed.length}`,
  );
  if (conflicts.length > 0) {
    console.log(
      `\nConflicts differ between the repo and the database. Reconcile each by hand,\n` +
        `then re-run — this script will not choose a winner for you:`,
    );
    for (const p of conflicts) console.log(`  ${p}`);
  }
  if (!args.commit && created.length > 0) {
    console.log(`\nRe-run with --commit to write these.`);
  }
  // Non-zero on failure so CI or a shell loop notices.
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
