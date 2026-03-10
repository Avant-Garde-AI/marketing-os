import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 240000, // 4 minutes for E2E tests
    hookTimeout: 60000, // 1 minute for setup/teardown
    globals: true,
    isolate: true,
    pool: "forks",
    // Run tests sequentially for E2E (avoid conflicts in temp directories)
    maxConcurrency: 1,
    // Disable file parallelization for integration tests
    fileParallelism: false,
  },
});
