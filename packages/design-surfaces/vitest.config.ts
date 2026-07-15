import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    // The Penpot builder's zip writer breaks under the default threads/forks
    // pools ("corruptedEntry" TypeError); vmThreads is the pool it survives.
    pool: "vmThreads",
    server: {
      deps: {
        // The Penpot builder is a large compiled ClojureScript bundle that
        // breaks under vitest's module transform; load it natively.
        external: [/@penpot\/library/],
      },
    },
  },
});
