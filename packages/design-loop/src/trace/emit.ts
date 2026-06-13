/**
 * Trace sinks — where de-identified traces go (PRD §5/§6). Trace emission is
 * consented and configurable per client; a disabled sink is a no-op.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { DesignTrace } from "./types.js";

export interface TraceSink {
  emit(trace: DesignTrace): Promise<void>;
}

/** In-memory sink for tests / dry runs. */
export function collectingSink(): TraceSink & { traces: DesignTrace[] } {
  const traces: DesignTrace[] = [];
  return {
    traces,
    emit: async (trace) => {
      traces.push(trace);
    },
  };
}

/** Appends one JSON line per trace to a local file (until the ingestion endpoint exists). */
export function jsonlSink(path: string): TraceSink {
  return {
    emit: async (trace) => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify(trace) + "\n", "utf-8");
    },
  };
}

/** No-op sink — used when consent is off. */
export const nullSink: TraceSink = { emit: async () => undefined };
