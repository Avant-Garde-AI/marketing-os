/** Read-only dashboard projection. Never reads a GitHub artifact or grants consent. */
import {safeQuery,tenantIdForShop} from "../platform-db";
import {getTenant} from "../tenant-context";
import {socialWorkflow,type SocialStage} from "./workflow";
import type {SocialPost} from "./types";
export interface DashboardRow {
  id:string;channel:string;status:string;copy:string|null;scheduled_at:Date|string|null;
  planned_at:Date|string|null;published_at:Date|string|null;platform_id:string|null;
  platform_permalink:string|null;failure:string|null;thumbnail_url:string|null;post_snapshot?:SocialPost|null;inactive_automation?:boolean;
}
const iso=(v:Date|string|null)=>v instanceof Date?v.toISOString():v??undefined;
export function dashboardPost(row:DashboardRow,now=Date.now()) {
  const post:SocialPost=row.post_snapshot??{id:row.id,channel:row.channel as SocialPost["channel"],status:row.status as SocialPost["status"],
    copy:row.copy??"",assetRefs:[],provenance:[],targetLink:"",body:"",
    scheduledAt:iso(row.scheduled_at),plannedAt:iso(row.planned_at),failure:row.failure??undefined,
    ...(row.platform_id?{platform:{id:row.platform_id,permalink:row.platform_permalink??"",publishedAt:iso(row.published_at)??""}}:{})};
  const workflow=row.inactive_automation && !["published","measured"].includes(row.status)
    ? {stage:"closed" as SocialStage,label:"Previous batch",explanation:"This unfinished draft belongs to a replaced automation policy and is not queued.",variant:"outline" as const}
    :(["published","measured"].includes(row.status)&&!row.platform_id)
    ? {stage:"attention" as SocialStage,label:"Publication needs checking",explanation:"No Instagram publication receipt is recorded.",variant:"attention" as const}
    :socialWorkflow(post,now);
  return {post,workflow,thumbnail:row.thumbnail_url};
}
// Mirrors the display lifecycle, including overdue schedules and absent receipts.
const inactiveSql=`(p.post_snapshot->'automation'->>'grantId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM mos_standing_grants g WHERE g.tenant_id=p.tenant_id AND g.id::text=p.post_snapshot->'automation'->>'grantId' AND g.status IN ('active','paused')))`;
const stageSql=`CASE WHEN p.status IN ('published','measured') AND p.platform_id IS NOT NULL THEN 'published'
 WHEN ${inactiveSql} THEN 'closed'
 WHEN p.status IN ('published','measured','failed') OR (p.status='scheduled' AND (p.scheduled_at IS NULL OR p.scheduled_at<now()-interval '15 minutes')) THEN 'attention'
 WHEN p.status='scheduled' THEN 'scheduled' WHEN p.status='asset_ready' THEN 'ready'
 WHEN p.status IN ('cancelled','declined') THEN 'closed' ELSE 'draft' END`;
export async function readSocialDashboard(month:string,stage:string,page=1) {
  const t=getTenant(),id=await tenantIdForShop(t.shop,t.tenantId);
  if(!id)return null;
  const [summary,rows]=await Promise.all([
    safeQuery<{month:string;stage:SocialStage;n:number;last_published:Date|string|null}>("social dashboard totals",
      `SELECT p.calendar_month AS month,${stageSql} AS stage,COUNT(*)::int AS n,MAX(p.published_at) AS last_published
       FROM pack_social.posts p WHERE p.tenant_id=$1 GROUP BY p.calendar_month,${stageSql}`,[id]),
    safeQuery<DashboardRow>("social dashboard posts",`SELECT p.id,p.channel,p.status,p.copy,p.scheduled_at,p.published_at,p.platform_id,p.platform_permalink,p.failure,p.post_snapshot,${inactiveSql} AS inactive_automation,
       c.scheduled_at AS planned_at,c.thumbnail_url FROM pack_social.posts p
       LEFT JOIN mos_calendar_items c ON c.tenant_id=p.tenant_id AND c.channel='social' AND c.item_id=p.id
       WHERE p.tenant_id=$1 AND p.calendar_month=$2 AND ($3='all' OR ($3='active' AND ${stageSql}<>'closed') OR ${stageSql}=$3)
       ORDER BY COALESCE(p.published_at,p.scheduled_at,c.scheduled_at,p.created_at) DESC,p.id LIMIT 24 OFFSET $4`,[id,month,stage,(page-1)*24])
  ]);
  if(!summary||!rows)return null;
  return {summary,rows};
}
