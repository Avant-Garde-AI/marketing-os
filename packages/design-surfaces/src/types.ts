/**
 * Design Surface layer types — spec 23 §2.
 *
 * The layer is domain-agnostic by rule: `kind` and `boundTo` are opaque
 * strings owned by the consuming capability pack (spec 24 social is the
 * first). Nothing in this package interprets them.
 */

export type SurfaceStatus =
  | "composing"
  | "ready"
  | "in_review"
  | "edited"
  | "exported";

export interface ExportArtifact {
  format: ExportFormat;
  width: number;
  height: number;
  scale: number;
  sha256: string;
  /** Repo-relative path the consuming pack designated; recorded, not enforced. */
  path?: string;
}

export interface DesignSurface {
  id: string;
  tenantId: string;
  kind: string;
  boundTo: { type: string; id: string };
  penpot: { fileId: string; pageId: string; teamId: string; projectId: string };
  brandLineage: {
    designMdVersion?: number;
    templateId?: string;
    tokensVersion?: number;
  };
  status: SurfaceStatus;
  exports: ExportArtifact[];
  createdBy: "agent" | "user";
}

export type ExportFormat = "png" | "jpeg" | "webp" | "svg" | "pdf";

/** A solid fill in Penpot's builder shape. */
export interface Fill {
  fillColor: string;
  fillOpacity?: number;
}

/** One element on a composed board. Deliberately small: rich structure comes
 * from templates (spec 23 §4 — templates absorb complexity), composition
 * fills content. */
export type ComposeElement =
  | {
      type: "text";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      characters: string;
      /** Penpot font id, e.g. "gfont-lora"; derived from fontFamily if omitted. */
      fontId?: string;
      fontFamily?: string;
      fontSize?: string;
      fontWeight?: string;
      fontStyle?: string;
      lineHeight?: string;
      textAlign?: "left" | "center" | "right" | "justify";
      fills?: Fill[];
    }
  | {
      type: "rect";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fills?: Fill[];
      rx?: number;
      ry?: number;
    }
  | {
      type: "image";
      name?: string;
      x: number;
      y: number;
      width: number;
      height: number;
      /** Raw image bytes; uploaded as file media and placed as an image fill. */
      data: Uint8Array;
      mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
    };

/** DTCG tokens object (W3C Design Tokens Community Group JSON), as produced
 * by @avant-garde/brand-md's compiler. Embedded verbatim via addTokensLib. */
export type DtcgTokens = Record<string, unknown>;

/**
 * One board of a composed surface, owning its elements (WS2-R1 multi-board).
 *
 * Element coordinates are BOARD-RELATIVE: (0,0) is the board's own top-left,
 * regardless of where the board lands on the page. The compose layer places
 * boards in a vertical column and translates element coordinates to page
 * space itself — Penpot's file format stores every shape in absolute page
 * coordinates (see the coordinate-semantics note in compose.ts).
 *
 * `name` is the addressing key for per-board export (exportSurfaceBoards) —
 * consuming packs use it as the slot name (e.g. email section slots), so keep
 * names unique within a spec.
 */
export interface BoardSpec {
  name: string;
  width: number;
  height: number;
  background?: Fill;
  elements: ComposeElement[];
}

export interface ComposeSpec {
  fileName: string;
  pageName?: string;
  /**
   * Single-board sugar (the original shipped shape): `board` + top-level
   * `elements` is exactly equivalent to `boards: [{ ...board, elements }]`.
   * Provide either this pair OR `boards`, never both.
   */
  board?: {
    name: string;
    width: number;
    height: number;
    background?: Fill;
  };
  /** Elements of the single-board sugar form; board-relative coordinates. */
  elements?: ComposeElement[];
  /**
   * Multi-board form (WS2-R1): boards lay out vertically on ONE page in
   * declaration order — board N at x=0, y = sum of previous board heights
   * + N × BOARD_GUTTER (compose.ts). Tokens/libraryColors stay file-level.
   */
  boards?: BoardSpec[];
  /** Brand token sets embedded into the file (Penpot design-tokens/v1). */
  tokens?: DtcgTokens;
  /** Library colors registered on the file, e.g. from DESIGN.md palette. */
  libraryColors?: { name: string; color: string; opacity?: number }[];
}

export interface PenpotConfig {
  /** e.g. http://localhost:9001 — the public URI of the managed instance. */
  baseUrl: string;
  /** Access token of the platform service account (spec 23 §3). */
  accessToken: string;
  /**
   * Service-account credentials for the export lane: the exporter's render
   * protocol authenticates with a SESSION (auth-token cookie), not an access
   * token, so the client mints one via login-with-password (spec 23 §3's
   * session-minting seam). Optional — everything except exportObject works
   * with the access token alone.
   */
  serviceAccount?: { email: string; password: string };
}
