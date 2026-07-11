// Brand Soul document store (spec 22 D1) — files-first over a DB index.
//
// D1: files in the store's own repo are the canonical manifest. In this
// client-owned deployment they live in `agents/brand/` (traced into the
// serverless bundle via next.config outputFileTracingIncludes). The DB holds
// WORKING versions the agent saves during refine sessions; reads resolve to
// whichever is newer (file version from front matter vs. DB version).
// Committing a working version back to the repo goes through the normal
// git pipeline (dispatch-to-github), not a runtime write. Kinds mirror the
// manifest: brand.md, DESIGN.md, research-brief.md, research-output.md,
// exploration-prompts.md.

import { readFile } from "fs/promises";
import path from "path";
import { Pool } from "pg";
import { parse as parseYaml } from "yaml";

const BRAND_DIR = process.env.MOS_BRAND_DIR ?? path.join(process.cwd(), "brand");

async function readFileDoc(kind: string): Promise<{ version: number; content: string } | null> {
  try {
    const content = await readFile(path.join(BRAND_DIR, kind), "utf8");
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let version = 1;
    if (fm) {
      try {
        const v = (parseYaml(fm[1]) as Record<string, unknown>)?.version;
        if (typeof v === "number" && v > 0) version = v;
      } catch {
        // unversioned file → baseline v1
      }
    }
    return { version, content };
  } catch {
    return null; // no file for this kind
  }
}

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) {
    const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!cs) throw new Error("SUPABASE_DATABASE_URL required for brand documents");
    _pool = new Pool({ connectionString: cs, max: 3 });
  }
  return _pool;
}

let _inited = false;
async function ensureTables(): Promise<void> {
  if (_inited) return;
  await pool().query(
    `CREATE TABLE IF NOT EXISTS mos_brand_documents (
       shop text NOT NULL,
       kind text NOT NULL,
       version int NOT NULL,
       content text NOT NULL,
       distilled jsonb,
       change_note text,
       updated_by text,
       created_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (shop, kind, version)
     )`
  );
  await pool().query(
    `CREATE TABLE IF NOT EXISTS mos_research_jobs (
       id serial PRIMARY KEY,
       shop text NOT NULL,
       interaction_id text NOT NULL,
       status text NOT NULL DEFAULT 'in_progress',
       created_at timestamptz NOT NULL DEFAULT now(),
       completed_at timestamptz
     )`
  );
  _inited = true;
}

export type BrandDocKind =
  | "brand.md"
  | "DESIGN.md"
  | "research-brief.md"
  | "research-output.md"
  | "exploration-prompts.md";

export interface BrandDoc {
  kind: BrandDocKind;
  version: number;
  content: string;
  distilled: Record<string, unknown> | null;
  createdAt: string;
}

/** Minimal brand.md front-matter distill (mirrors @avant-garde/brand-md, D5). */
export function distillBrandContent(content: string): Record<string, unknown> | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  let fm: Record<string, any>;
  try {
    fm = parseYaml(m[1]) as Record<string, any>;
  } catch {
    return null;
  }
  if (!fm || typeof fm !== "object") return null;
  const out: Record<string, unknown> = { brand: fm.name, version: fm.version };
  if (fm.essence?.line) out.essence = fm.essence.line;
  if (fm.voice) out.voice = fm.voice;
  if (fm.ai_voice_rules) out.ai_voice_rules = fm.ai_voice_rules;
  if (fm.art_description_formula) out.art_description_formula = fm.art_description_formula;
  if (fm.guardrails) out.guardrails = fm.guardrails;
  const primary = fm.personas?.primary;
  if (primary?.name) {
    out.primary_persona = {
      name: primary.name,
      mental_model: primary.mental_model,
      decision_hierarchy: primary.decision_hierarchy,
    };
  }
  return out;
}

export async function getBrandDoc(shop: string, kind: BrandDocKind): Promise<BrandDoc | null> {
  // DB working versions (non-fatal — a client deploy without a DB still reads files).
  let dbDoc: BrandDoc | null = null;
  try {
    await ensureTables();
    const r = await pool().query(
      `SELECT kind, version, content, distilled, created_at
         FROM mos_brand_documents WHERE shop = $1 AND kind = $2
        ORDER BY version DESC LIMIT 1`,
      [shop, kind]
    );
    const row = r.rows[0];
    if (row) dbDoc = { kind: row.kind, version: row.version, content: row.content, distilled: row.distilled, createdAt: String(row.created_at) };
  } catch (e) {
    console.error("[brand] DB read failed (falling back to files)", e instanceof Error ? e.message : e);
  }
  // Repo file baseline (D1: files are truth); newest version wins.
  const fileDoc = await readFileDoc(kind);
  if (fileDoc && (!dbDoc || fileDoc.version >= dbDoc.version)) {
    return {
      kind,
      version: fileDoc.version,
      content: fileDoc.content,
      distilled: kind === "brand.md" ? distillBrandContent(fileDoc.content) : null,
      createdAt: "repo",
    };
  }
  return dbDoc;
}

export async function saveBrandDoc(
  shop: string,
  kind: BrandDocKind,
  content: string,
  opts: { changeNote?: string; updatedBy?: string } = {}
): Promise<{ version: number }> {
  await ensureTables();
  const distilled = kind === "brand.md" ? distillBrandContent(content) : null;
  const r = await pool().query(
    `INSERT INTO mos_brand_documents (shop, kind, version, content, distilled, change_note, updated_by)
     SELECT $1, $2, COALESCE(MAX(version), 0) + 1, $3, $4::jsonb, $5, $6
       FROM mos_brand_documents WHERE shop = $1 AND kind = $2
     RETURNING version`,
    [shop, kind, content, distilled ? JSON.stringify(distilled) : null, opts.changeNote ?? null, opts.updatedBy ?? null]
  );
  // Invalidate the per-turn context cache on brand.md writes.
  if (kind === "brand.md") brandContextCache.delete(shop);
  return { version: r.rows[0].version };
}

export async function listBrandDocVersions(shop: string, kind: BrandDocKind): Promise<Array<{ version: number; changeNote: string | null; createdAt: string }>> {
  await ensureTables();
  const r = await pool().query(
    `SELECT version, change_note, created_at FROM mos_brand_documents
      WHERE shop = $1 AND kind = $2 ORDER BY version DESC LIMIT 20`,
    [shop, kind]
  );
  return r.rows.map((row) => ({ version: row.version, changeNote: row.change_note, createdAt: String(row.created_at) }));
}

// --- per-turn distilled context (BS4), TTL-cached like the external-MCP merge ---
const brandContextCache = new Map<string, { at: number; text: string }>();
const TTL_MS = 5 * 60 * 1000;

/**
 * The per-turn brand context block (D5: front matter only). Returns "" when the
 * store has no brand.md — the engine degrades to no injection, never an error.
 */
export async function getBrandInstructions(shop: string): Promise<string> {
  const hit = brandContextCache.get(shop);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.text;
  let text = "";
  try {
    const doc = await getBrandDoc(shop, "brand.md");
    if (doc?.distilled) {
      text =
        `\n\n## Brand Soul (brand.md v${doc.version} — the store's owner-approved brand core; obey it in every reply)\n` +
        `The distilled brand context below governs voice, tone, copy rules, and guardrails for ALL of your output. ` +
        `Match the voice pillars and tone-by-context; never violate a guardrail or use a banned word. ` +
        `For full depth (positioning, messaging, experience architecture), call get_brand_document.\n` +
        "```json\n" + JSON.stringify(doc.distilled, null, 1) + "\n```";
    }
  } catch (e) {
    console.error("[brand] context load failed", e);
  }
  brandContextCache.set(shop, { at: Date.now(), text });
  return text;
}

// --- deep research jobs (D4: async fire-then-poll) ---
export async function saveResearchJob(shop: string, interactionId: string): Promise<void> {
  await ensureTables();
  await pool().query(`INSERT INTO mos_research_jobs (shop, interaction_id) VALUES ($1, $2)`, [shop, interactionId]);
}

export async function latestResearchJob(shop: string): Promise<{ interactionId: string; status: string } | null> {
  await ensureTables();
  const r = await pool().query(
    `SELECT interaction_id, status FROM mos_research_jobs WHERE shop = $1 ORDER BY id DESC LIMIT 1`,
    [shop]
  );
  const row = r.rows[0];
  return row ? { interactionId: row.interaction_id, status: row.status } : null;
}

export async function markResearchJob(shop: string, interactionId: string, status: string): Promise<void> {
  await pool().query(
    `UPDATE mos_research_jobs SET status = $3, completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END
      WHERE shop = $1 AND interaction_id = $2`,
    [shop, interactionId, status]
  );
}
