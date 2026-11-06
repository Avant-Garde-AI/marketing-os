/** Fast owner-only status; never reconciles artifacts or starts work on a GET. */
import { NextRequest, NextResponse } from "next/server";
import { socialReviewOperator } from "../../../../lib/social/review-operator";
import { apiBase, brokerHeaders } from "../../../../lib/broker-client";
export const dynamic = "force-dynamic";
export async function GET(req:NextRequest) {
  if (!(await socialReviewOperator())) return NextResponse.json({ error: "Sign in to view automation" }, {status:401});
  const selected=req.nextUrl.searchParams.get("channel");
  const channels=selected==="social"||selected==="email"?[selected]:["social","email"];
  const entries = await Promise.all(channels.map(async channel => {
    try {
      const r = await fetch(`${apiBase()}/api/broker/${channel}-autopilot`, {headers:brokerHeaders(),cache:"no-store",signal:AbortSignal.timeout(8000)});
      if (!r.ok) throw Error(`Status unavailable (${r.status})`);
      const b = await r.json();
      return [channel, {grant:b.grant,worker:b.worker,batches:(b.batches ?? []).map((x:{id:string;phase:string;window_from:string;window_through:string;detail?:string;scheduled?:string[];held_post_ids?:string[];staged?:{state:string}[];updated_at?:string;progress?:Record<string,number>}) => ({id:x.id,phase:x.phase,from:x.window_from,through:x.window_through,detail:x.phase === "attention" ? x.detail?.slice(0,250) : undefined,scheduled:x.scheduled?.length ?? x.staged?.filter(y=>y.state === "scheduled").length ?? 0,held:x.held_post_ids?.length??0,progress:x.progress,updatedAt:x.updated_at}))}];
    } catch(e) { return [channel,{error:e instanceof Error ? e.message : "Status unavailable"}]; }
  }));
  return NextResponse.json(Object.fromEntries(entries),{headers:{"Cache-Control":"no-store"}});
}
