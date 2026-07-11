// Deep-research poller (spec 22 D4) — advances in-flight research jobs so a
// completed report lands as research-output.md even if nobody asks. Runs on
// Vercel cron; idempotent; each pass polls the open jobs and saves/marks any
// that finished.
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { getDeepResearch } from "@/src/mastra/brand/deep-research";
import { saveBrandDoc, markResearchJob } from "@/src/mastra/brand/store";

export const runtime = "nodejs";
export const maxDuration = 120;

let _pool: Pool | null = null;
function pool(): Pool {
  if (!_pool) {
    const cs = process.env.SUPABASE_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!cs) throw new Error("database url required");
    _pool = new Pool({ connectionString: cs, max: 2 });
  }
  return _pool;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const jobs = await pool().query(
    `SELECT shop, interaction_id FROM mos_research_jobs WHERE status = 'in_progress' ORDER BY id DESC LIMIT 5`
  );
  const results: Array<{ shop: string; status: string }> = [];
  for (const job of jobs.rows) {
    try {
      const res = await getDeepResearch(job.interaction_id);
      if (res.status === "completed" && res.report) {
        await saveBrandDoc(job.shop, "research-output.md", res.report, {
          changeNote: "Deep research report (auto-saved by cron)",
          updatedBy: "deep-research",
        });
        await markResearchJob(job.shop, job.interaction_id, "completed");
      } else if (res.status === "failed") {
        await markResearchJob(job.shop, job.interaction_id, "failed");
      }
      results.push({ shop: job.shop, status: res.status });
    } catch (e) {
      console.error("[cron-research] poll failed", e);
      results.push({ shop: job.shop, status: "poll-error" });
    }
  }
  return Response.json({ checked: results.length, results });
}
