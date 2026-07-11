// Visual exploration candidates (spec 22 stage 4 / BS2b).
//
// Generation fan-out: each candidate = one Gemini image-generation call whose
// prompt varies along a diversity axis (the exploration notes made literal).
// Candidates persist in mos_brand_candidates and are served publicly by
// /api/brand-image/[id] (unguessable UUID), so Slack image blocks and the
// console gallery can render them. Selection is the owner's move (Slack
// button / console), recorded via markCandidateSelected.

import { Pool } from "pg";

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) {
    const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!cs) throw new Error("SUPABASE_DATABASE_URL required for brand candidates");
    _pool = new Pool({ connectionString: cs, max: 3 });
  }
  return _pool;
}

let _inited = false;
async function ensureTable(): Promise<void> {
  if (_inited) return;
  await pool().query(
    `CREATE TABLE IF NOT EXISTS mos_brand_candidates (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       shop text NOT NULL,
       surface text NOT NULL,
       axis text,
       prompt text NOT NULL,
       png bytea NOT NULL,
       selected boolean NOT NULL DEFAULT false,
       created_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  _inited = true;
}

const IMAGE_API = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** One image-generation call (Interactions API, gemini-3.1-flash-image). */
async function generateImage(prompt: string): Promise<Buffer | null> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY required for image generation");
  try {
    const res = await fetch(IMAGE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        model: "gemini-3.1-flash-image",
        input: [{ type: "text", text: prompt }],
        response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "3:4", image_size: "1K" },
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) {
      console.error(`[brand-candidates] image gen failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { steps?: Array<{ content?: Array<{ data?: string; type?: string }> }> };
    for (const step of data.steps ?? []) {
      for (const block of step.content ?? []) {
        if (block.data) return Buffer.from(block.data, "base64");
      }
    }
    return null;
  } catch (e) {
    console.error("[brand-candidates] image gen error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export interface Candidate {
  id: string;
  surface: string;
  axis: string;
}

/** Fan out N diverse generations for a surface; returns saved candidate ids. */
export async function generateCandidates(
  shop: string,
  surface: string,
  variations: Array<{ axis: string; prompt: string }>
): Promise<Candidate[]> {
  await ensureTable();
  const results = await Promise.all(
    variations.map(async (v) => {
      const png = await generateImage(v.prompt);
      if (!png) return null;
      const r = await pool().query(
        `INSERT INTO mos_brand_candidates (shop, surface, axis, prompt, png) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [shop, surface, v.axis, v.prompt, png]
      );
      return { id: r.rows[0].id as string, surface, axis: v.axis };
    })
  );
  return results.filter((c): c is Candidate => !!c);
}

export async function getCandidatePng(id: string): Promise<Buffer | null> {
  await ensureTable();
  const r = await pool().query(`SELECT png FROM mos_brand_candidates WHERE id = $1`, [id]);
  return r.rows[0]?.png ?? null;
}

export interface CandidateListing {
  id: string;
  surface: string;
  axis: string | null;
  selected: boolean;
  createdAt: string;
}

/** List a shop's exploration candidates, newest first (optionally selected-only). */
export async function listCandidates(shop: string, selectedOnly = false): Promise<CandidateListing[]> {
  await ensureTable();
  const r = await pool().query(
    `SELECT id, surface, axis, selected, created_at FROM mos_brand_candidates
      WHERE shop = $1 ${selectedOnly ? "AND selected = true" : ""}
      ORDER BY created_at DESC LIMIT 24`,
    [shop]
  );
  return r.rows.map((row) => ({
    id: row.id,
    surface: row.surface,
    axis: row.axis,
    selected: row.selected,
    createdAt: String(row.created_at),
  }));
}

export async function markCandidateSelected(id: string): Promise<{ shop: string; surface: string; axis: string | null } | null> {
  await ensureTable();
  const r = await pool().query(
    `UPDATE mos_brand_candidates SET selected = true WHERE id = $1 RETURNING shop, surface, axis`,
    [id]
  );
  return r.rows[0] ?? null;
}
