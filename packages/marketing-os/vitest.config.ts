import { defineConfig } from "vitest/config";

/**
 * The DEFAULT suite for this package — deliberately empty of the integration
 * test, which has its own config (vitest.integration.config.ts) and its own CI
 * job.
 *
 * Without this file, `vitest run` picked up test/integration.test.ts under
 * default settings: threads pool, 5s timeout, no sequencing. That suite
 * scaffolds a project, runs `npm install` and builds a Next.js app through
 * blocking execSync calls — two minutes of a worker thread unable to answer
 * vitest's RPC heartbeat, which surfaces as `Timeout calling "onTaskUpdate"`
 * and fails a green test run. It also meant every `check` run repeated work the
 * `e2e` job was already doing properly.
 *
 * So: `pnpm test` is the fast unit lane, `pnpm test:integration` is the slow
 * end-to-end lane, and neither pretends to be the other.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration.test.ts", "**/node_modules/**"],
    environment: "node",
    // No test files match today. Vitest exits non-zero on an empty run unless
    // told that is acceptable, and a package whose only suite lives in another
    // config is a legitimate empty run — not a failure.
    passWithNoTests: true,
  },
});
