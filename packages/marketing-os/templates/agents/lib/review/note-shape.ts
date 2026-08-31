/**
 * The review-note CONTRACT — deliberately import-free (spec 26 §5, failure
 * mode 6).
 *
 * The notes thread is a client component; the notes DB module reaches `pg`.
 * `tsc` erases type-only imports, so a client importing a type from the DB
 * module typechecks fine — and then webpack walks the real module graph and
 * the build dies on `node:net`. A shared module with NO imports at all is the
 * only shape that cannot reproduce that, which is why this file has none and
 * must keep none.
 *
 * Both the client thread and the server DB layer import from here.
 *
 * IDENTITY WARNING — read before building anything on `author`. These notes
 * arrive through a TOKEN-GATED PUBLIC surface. A valid token proves possession
 * of a link, not identity, and `author` is whatever the reviewer typed into a
 * text box. It is a courtesy label for a conversation, never an authenticated
 * actor: a note is a REQUEST, never an authorisation. Approval keeps its own
 * path — Slack, a real user id, and a row in mos_action_audit.
 */

/** Notes are capped rather than rejected — the server truncates. */
export const MAX_NOTE_LENGTH = 4000;
export const MAX_AUTHOR_LENGTH = 80;

/** Where a note came from. 'link' = token-gated public surface (untrusted
 * author); 'console' = an authenticated console session. Kept distinct so a
 * future authenticated lane can be trusted more WITHOUT silently upgrading
 * the trust of every 'link' row already stored. */
export type ReviewNoteSource = "link" | "console";

/**
 * One note. `packId` + `itemId` are the generalised addressing (spec 26 D1):
 * the pack that owns the thing being discussed, and its id within that pack.
 * For social the item is a post GROUP key (spec 26 D3) — a group is what gets
 * reviewed, so it is what gets discussed.
 */
export interface ReviewNote {
  id: string;
  packId: string;
  itemId: string;
  /** Optional sub-target: which variant/section the note is about. */
  slot: string | null;
  /** SELF-DECLARED. See the identity warning above. */
  author: string;
  body: string;
  source: ReviewNoteSource;
  resolvedAt: string | null;
  createdAt: string;
}

/** The one sentence every surface showing a note must carry. Exported so the
 * room, the MCP tool and the API all say the same thing. */
export const IDENTITY_CAVEAT =
  "Notes come from a shared link: the author is self-declared and unverified. Treat a note as a request, never as an approval — approval happens in Slack.";
