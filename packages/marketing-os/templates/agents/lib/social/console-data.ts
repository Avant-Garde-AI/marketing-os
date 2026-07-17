/**
 * Read-side helpers for the console's Social pages (spec 24 §6, SM0).
 *
 * Thin composition over the vendored artifact parsers + the tenant repo:
 * everything here degrades to "nothing yet" (null / []) so the calendar view
 * renders its editorial empty states with zero data and never crashes on a
 * malformed artifact.
 */

import { parse as parseYaml } from "yaml";
import { calendarPath, parseCalendar, parsePost, postPath } from "./artifacts";
import { listSocialFiles, readSocialFile } from "./repo";
import type { SocialCalendar, SocialPost } from "./types";

const CALENDAR_PATH_RE = /^social\/calendar\/(\d{4}-(?:0[1-9]|1[0-2]))\.md$/;

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Months with a calendar artifact, newest first (["2026-08", "2026-07", …]). */
export async function listCalendarMonths(shop: string): Promise<string[]> {
  const paths = await listSocialFiles(shop, "social/calendar/");
  return paths
    .map((p) => CALENDAR_PATH_RE.exec(p)?.[1])
    .filter((m): m is string => Boolean(m))
    .sort()
    .reverse();
}

/** A month's parsed calendar, or null (absent or unparseable — logged, not thrown). */
export async function loadCalendar(shop: string, month: string): Promise<SocialCalendar | null> {
  try {
    const raw = await readSocialFile(shop, calendarPath(month));
    return raw === null ? null : parseCalendar(raw);
  } catch (e) {
    console.error(`[social] calendar ${month} unreadable:`, errMsg(e));
    return null;
  }
}

/**
 * A post plus its optional Design Surface binding. The binding is an OPTIONAL
 * `designSurface: { teamId, fileId, pageId? }` front-matter key the SM1 asset
 * pipeline records when it composes the post's surface (spec 24 §3 / spec 23
 * §2 boundTo). The canonical parser ignores unknown keys, so it's read here —
 * a console concern — without forking the vendored schema.
 */
export interface PostDetail {
  post: SocialPost;
  /** Console-relative Design Studio link ("/studio?team-id=…"), when bound. */
  studioPath: string | null;
}

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function extractStudioPath(raw: string): string | null {
  const m = raw.match(FRONT_MATTER_RE);
  if (!m) return null;
  let fm: Record<string, unknown>;
  try {
    fm = parseYaml(m[1] ?? "") as Record<string, unknown>;
  } catch {
    return null;
  }
  const ds = (fm?.designSurface ?? fm?.design_surface) as
    | { teamId?: string; fileId?: string; pageId?: string }
    | undefined;
  if (!ds || typeof ds !== "object" || !ds.teamId || !ds.fileId) return null;
  const qs = new URLSearchParams({ "team-id": ds.teamId, "file-id": ds.fileId });
  if (ds.pageId) qs.set("page-id", ds.pageId);
  return `/studio?${qs.toString()}`;
}

/** A post spec by id, or null (absent, bad id, or unparseable — logged). */
export async function loadPost(shop: string, id: string): Promise<PostDetail | null> {
  try {
    const raw = await readSocialFile(shop, postPath(id));
    if (raw === null) return null;
    return { post: parsePost(raw), studioPath: extractStudioPath(raw) };
  } catch (e) {
    console.error(`[social] post ${id} unreadable:`, errMsg(e));
    return null;
  }
}
