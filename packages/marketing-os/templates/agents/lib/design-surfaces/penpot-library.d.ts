/**
 * Vendored from marketing-os packages/design-surfaces @ 2026-07-16 — npm
 * publish blocked (no auth); replace with @avant-garde/design-surfaces when
 * published. Do not edit here without porting back.
 *
 * Hand-written declarations for @penpot/library 1.2.0-RC2 (ships untyped —
 * a compiled ClojureScript bundle). Surface verified by runtime introspection
 * and exercised by the canary suite; revisit on library upgrades.
 */
declare module "@penpot/library" {
  export interface BuildContext {
    addFile(opts: { name: string }): void;
    closeFile(): void;
    addPage(opts: { name: string }): void;
    closePage(): void;
    addBoard(opts: Record<string, unknown>): void;
    closeBoard(): void;
    addGroup(opts: Record<string, unknown>): void;
    closeGroup(): void;
    addRect(opts: Record<string, unknown>): void;
    addCircle(opts: Record<string, unknown>): void;
    addPath(opts: Record<string, unknown>): void;
    addText(opts: Record<string, unknown>): void;
    addBool(opts: Record<string, unknown>): void;
    addComponent(opts: Record<string, unknown>): void;
    addLibraryColor(opts: { name: string; color: string; opacity?: number }): string;
    addLibraryTypography(opts: Record<string, unknown>): string;
    addFileMedia(opts: { name: string; width: number; height: number }, blob: Blob): string;
    getMediaAsImage(mediaId: string): unknown;
    addTokensLib(tokens: Record<string, unknown>): void;
    addRelation(opts: Record<string, unknown>): void;
    genId(): string;
    getInternalState(): unknown;
  }

  export function createBuildContext(): BuildContext;
  export function exportAsBytes(context: BuildContext): Promise<Uint8Array>;
  export function exportAsBlob(context: BuildContext): Promise<Blob>;
  export function exportStream(context: BuildContext, stream: WritableStream): Promise<void>;
  export class BuilderError extends Error {}
}
