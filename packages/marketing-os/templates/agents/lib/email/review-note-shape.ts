/**
 * The shape of a review note, and the limits on one — separated from
 * review-notes.ts on purpose.
 *
 * review-notes.ts reaches the database, so it imports platform-db, which
 * imports `pg`, which imports node:net/tls. The review room's note thread is a
 * CLIENT component; importing even a type from that module drags the whole
 * chain into the browser bundle and the build fails with "Can't resolve 'net'".
 * A type-only import is erased by tsc but webpack still walks the graph.
 *
 * So the contract lives here, in a module with no imports at all, and both
 * sides depend on it.
 */

/** Hard ceiling on a note. Generous for prose, small enough that a public
 *  endpoint can't be used to park data in the tenant's database. */
export const MAX_NOTE_LENGTH = 4000;
export const MAX_AUTHOR_LENGTH = 80;

export interface ReviewNote {
  id: string;
  campaignId: string;
  slot: string | null;
  /** SELF-DECLARED by whoever held the review link. Not an authenticated
   *  identity — a note is a request, never an approval. */
  author: string;
  body: string;
  /** 'link' = arrived through a shared review link; 'console' = authenticated. */
  source: string;
  resolvedAt: string | null;
  createdAt: string;
}
