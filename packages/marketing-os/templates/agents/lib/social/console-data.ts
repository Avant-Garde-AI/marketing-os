/**
 * Read-side helpers for the console's Social pages (spec 24 §6, SM0).
 *
 * Thin composition over the vendored artifact parsers + the tenant repo:
 * everything here degrades to "nothing yet" (null / []) so the calendar view
 * renders its editorial empty states with zero data and never crashes on a
 * malformed artifact.
 */

import { calendarPath, parseCalendar, parsePost, postPath } from "./artifacts";
// Through socialRepo, NOT the free functions: those query mos_social_artifacts
// directly and are blind to STORE_REPO_MODE, so a store whose artifacts have
// moved to git would render empty here without an error anywhere.
import { socialRepo } from "./repo";
import { groupKey, groupPosts } from "./projection";
import type { DesignSurfaceRef, SocialCalendar, SocialPost } from "./types";

const CALENDAR_PATH_RE = /^social\/calendar\/(\d{4}-(?:0[1-9]|1[0-2]))\.md$/;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Months with a calendar artifact, newest first (["2026-08", "2026-07", …]). */
export async function listCalendarMonths(shop: string): Promise<string[]> {
  const paths = await socialRepo.list("social/calendar/");
  return paths
    .map((p) => CALENDAR_PATH_RE.exec(p)?.[1])
    .filter((m): m is string => Boolean(m))
    .sort()
    .reverse();
}

/** A month's parsed calendar, or null (absent or unparseable — logged, not thrown). */
export async function loadCalendar(shop: string, month: string): Promise<SocialCalendar | null> {
  try {
    const raw = await socialRepo.readFile(calendarPath(month));
    return raw === null ? null : parseCalendar(raw);
  } catch (e) {
    console.error(`[social] calendar ${month} unreadable:`, errMsg(e));
    return null;
  }
}

/**
 * A post plus its optional Design Surface binding — the OPTIONAL
 * `designSurface: { teamId, fileId, pageId? }` front-matter key the SM1
 * design-link glue (social_link_design) records when it binds the post's
 * composed surface (spec 24 §3 / spec 23 §2 boundTo). The key is first-class
 * in the vendored post schema, so it's read off the parsed post directly.
 */
export interface PostDetail {
  post: SocialPost;
  /** Console-relative Design Studio link ("/studio?team-id=…"), when bound. */
  studioPath: string | null;
}

function toStudioPath(ds: DesignSurfaceRef | undefined): string | null {
  if (!ds) return null;
  const qs = new URLSearchParams({ "team-id": ds.teamId, "file-id": ds.fileId });
  if (ds.pageId) qs.set("page-id", ds.pageId);
  return `/studio?${qs.toString()}`;
}

/** A post spec by id, or null (absent, bad id, or unparseable — logged). */
export async function loadPost(shop: string, id: string): Promise<PostDetail | null> {
  try {
    const raw = await socialRepo.readFile(postPath(id));
    if (raw === null) return null;
    const post = parsePost(raw);
    return { post, studioPath: toStudioPath(post.designSurface) };
  } catch (e) {
    console.error(`[social] post ${id} unreadable:`, errMsg(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Post groups (spec 26 D3) — the review unit
// ---------------------------------------------------------------------------

/**
 * Every variant in a post group, in the pack's deterministic order.
 *
 * Reads the ARTIFACTS, not the index: the review room shows what would
 * actually ship, and files are truth (spec 22 D1). An index disagreeing with
 * the files must never decide what a reviewer sees.
 *
 * Unreadable variants are SKIPPED WITH A LOG rather than failing the group —
 * one malformed post must not black out a review — but the count is reported
 * so the room can say so instead of quietly showing less (spec 26 §5: empty is
 * indistinguishable from broken).
 */
export async function loadPostGroup(
  shop: string,
  key: string,
): Promise<{ posts: PostDetail[]; unreadable: number }> {
  let paths: string[];
  try {
    paths = await socialRepo.list("social/posts/");
  } catch (e) {
    console.error(`[social] group "${key}": cannot list posts:`, errMsg(e));
    return { posts: [], unreadable: 0 };
  }

  const details: PostDetail[] = [];
  let unreadable = 0;
  for (const path of paths.filter((p) => p.endsWith("/post.md"))) {
    let post: SocialPost;
    try {
      const raw = await socialRepo.readFile(path);
      if (raw === null) continue;
      post = parsePost(raw);
    } catch (e) {
      unreadable++;
      console.error(`[social] group "${key}": ${path} unparseable:`, errMsg(e));
      continue;
    }
    if (groupKey(post) === key) {
      details.push({ post, studioPath: toStudioPath(post.designSurface) });
    }
  }

  const ordered = groupPosts(details.map((d) => d.post))[0]?.posts ?? [];
  const byId = new Map(details.map((d) => [d.post.id, d]));
  return { posts: ordered.map((p) => byId.get(p.id)!).filter(Boolean), unreadable };
}
