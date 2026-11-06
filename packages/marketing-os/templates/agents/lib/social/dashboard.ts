/** Read-only dashboard projection. Never reads a GitHub artifact or grants consent. */
import {safeQuery,tenantIdForShop} from "../platform-db";
import {getTenant} from "../tenant-context";
import {apiBase,brokerHeaders} from "../broker-client";
import {socialWorkflow,type SocialStage} from "./workflow";
import type {SocialPost} from "./types";
export interface DashboardRow {
  id:string;channel:string;status:string;copy:string|null;scheduled_at:Date|string|null;
  planned_at:Date|string|null;published_at:Date|string|null;platform_id:string|null;
  platform_permalink:string|null;failure:string|null;thumbnail_url:string|null;post_snapshot?:SocialPost|null;inactive_automation?:boolean;held_automation?:boolean;unverified_automation?:boolean;
}
const iso=(v:Date|string|null)=>v instanceof Date?v.toISOString():v??undefined;
export function dashboardPost(row:DashboardRow,now=Date.now()) {
  const post:SocialPost=row.post_snapshot??{id:row.id,channel:row.channel as SocialPost["channel"],status:row.status as SocialPost["status"],
    copy:row.copy??"",assetRefs:[],provenance:[],targetLink:"",body:"",
    scheduledAt:iso(row.scheduled_at),plannedAt:iso(row.planned_at),failure:row.failure??undefined,
    ...(row.platform_id?{platform:{id:row.platform_id,permalink:row.platform_permalink??"",publishedAt:iso(row.published_at)??""}}:{})};
  const workflow=row.inactive_automation && !["published","measured"].includes(row.status)
    ? {stage:"closed" as SocialStage,label:"Previous batch",explanation:"This unfinished draft belongs to a replaced automation policy and is not queued.",variant:"outline" as const}
    :(row.held_automation && !(["published","measured"].includes(row.status)&&row.platform_id))
    ? {stage:"attention" as SocialStage,label:"Held · won’t publish",explanation:"Automatic production has held this post. Other posts can continue. Open production controls for the held item and reason.",variant:"attention" as const}
    :(["published","measured"].includes(row.status)&&!row.platform_id)
    ? {stage:"attention" as SocialStage,label:"Publication needs checking",explanation:"No Instagram publication receipt is recorded.",variant:"attention" as const}
    :row.unverified_automation?{stage:"attention" as SocialStage,label:"Automation status unavailable",explanation:"Current holds could not be verified. Check production controls before relying on this schedule.",variant:"attention" as const}:socialWorkflow(post,now);
  return {post,workflow,thumbnail:row.thumbnail_url};
}
// Mirrors the display lifecycle, including overdue schedules and absent receipts.
export interface DashboardAuthority {currentGrant:string|null;heldIds:string[]}
/** Client-owned projection databases do not contain the platform grant tables. */
async function readAuthority():Promise<DashboardAuthority|null> {
 try {
  const r=await fetch(`${apiBase()}/api/broker/social-autopilot`,{headers:brokerHeaders(),cache:"no-store",signal:AbortSignal.timeout(8000)});
  if(!r.ok)return null;const data=await r.json();
  if(!("grant" in data)||!Array.isArray(data.batches))return null;
  const currentGrant=data.grant && ["active","paused"].includes(data.grant.status) && typeof data.grant.id==="string"?data.grant.id:null;
  const heldIds=[...new Set<string>(data.batches.flatMap((b:{held_post_ids?:unknown[]})=>(b.held_post_ids??[]).filter((id):id is string=>typeof id==="string"&&id.length<=120)))];
  return {currentGrant,heldIds};
 }catch{return null;}
}
const inactiveSql=`($2::boolean AND p.post_snapshot->'automation'->>'grantId' IS NOT NULL AND p.post_snapshot->'automation'->>'grantId' IS DISTINCT FROM $3::text)`;
const heldSql=`p.id=ANY($4::text[])`;
const unverifiedSql=`(NOT $2::boolean AND p.post_snapshot->'automation'->>'grantId' IS NOT NULL)`;
const stageSql=`CASE WHEN p.status IN ('published','measured') AND p.platform_id IS NOT NULL THEN 'published'
 WHEN ${inactiveSql} THEN 'closed' WHEN ${heldSql} OR ${unverifiedSql} THEN 'attention'
 WHEN p.status IN ('published','measured','failed') OR (p.status='scheduled' AND (p.scheduled_at IS NULL OR p.scheduled_at<now()-interval '15 minutes')) THEN 'attention'
 WHEN p.status='scheduled' THEN 'scheduled' WHEN p.status='asset_ready' THEN 'ready'
 WHEN p.status IN ('cancelled','declined') THEN 'closed' ELSE 'draft' END`;
export async function readSocialDashboard(month:string,stage:string,page=1,providedAuthority?:DashboardAuthority|null) {
  const t=getTenant(),[id,authority]=await Promise.all([tenantIdForShop(t.shop,t.tenantId),providedAuthority===undefined?readAuthority():Promise.resolve(providedAuthority)]);
  if(!id)return null;
  const authorityParams=[id,authority!==null,authority?.currentGrant??null,authority?.heldIds??[]];
  const [summary,rows]=await Promise.all([
    safeQuery<{month:string;stage:SocialStage;n:number;last_published:Date|string|null}>("social dashboard totals",
      `SELECT p.calendar_month AS month,${stageSql} AS stage,COUNT(*)::int AS n,MAX(p.published_at) AS last_published
       FROM pack_social.posts p WHERE p.tenant_id=$1 GROUP BY p.calendar_month,${stageSql}`,authorityParams),
    safeQuery<DashboardRow>("social dashboard posts",`SELECT p.id,p.channel,p.status,p.copy,p.scheduled_at,p.published_at,p.platform_id,p.platform_permalink,p.failure,p.post_snapshot,${inactiveSql} AS inactive_automation,${heldSql} AS held_automation,${unverifiedSql} AS unverified_automation,
       c.scheduled_at AS planned_at,c.thumbnail_url FROM pack_social.posts p
       LEFT JOIN mos_calendar_items c ON c.tenant_id=p.tenant_id AND c.channel='social' AND c.item_id=p.id
       WHERE p.tenant_id=$1 AND p.calendar_month=$5 AND ($6='all' OR ($6='active' AND ${stageSql}<>'closed') OR ${stageSql}=$6)
       ORDER BY COALESCE(p.published_at,p.scheduled_at,c.scheduled_at,p.created_at) DESC,p.id LIMIT 24 OFFSET $7`,[...authorityParams,month,stage,(page-1)*24])
  ]);
  if(!summary||!rows)return null;
  return {summary,rows,authorityAvailable:authority!==null};
}
