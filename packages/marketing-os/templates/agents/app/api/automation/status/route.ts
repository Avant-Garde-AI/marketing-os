/** Fast owner-only status; never reconciles artifacts or starts work on a GET. */
import { NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../lib/social/review-operator";
import { apiBase, brokerHeaders } from "../../../../lib/broker-client";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!(await socialReviewOperator())) return NextResponse.json({ error: "Sign in to view automation" }, {status:401});
  const entries = await Promise.all(["social", "email"].map(async channel => {
    try {
      const r = await fetch(`${apiBase()}/api/broker/${channel}-autopilot`, {headers:brokerHeaders(),cache:"no-store",signal:AbortSignal.timeout(8000)});
      if (!r.ok) throw Error(`Status unavailable (${r.status})`);
      const b = await r.json();
      return [channel, {grant:b.grant,worker:b.worker,batches:(b.batches ?? []).map((x:{id:string;phase:string;window_from:string;window_through:string;detail?:string;scheduled?:string[];staged?:{state:string}[];updated_at?:string}) => ({id:x.id,phase:x.phase,from:x.window_from,through:x.window_through,detail:x.phase === "attention" ? x.detail?.slice(0,250) : undefined,scheduled:x.scheduled?.length ?? x.staged?.filter(y=>y.state === "scheduled").length ?? 0,updatedAt:x.updated_at}))}];
    } catch(e) { return [channel,{error:e instanceof Error ? e.message : "Status unavailable"}]; }
  }));
  return NextResponse.json(Object.fromEntries(entries),{headers:{"Cache-Control":"no-store"}});
}
