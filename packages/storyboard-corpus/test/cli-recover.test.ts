import { describe, expect, it, vi } from "vitest";

import { mainRecover, parseRecoveryArgs } from "../src/cli-recover";

const args = [
  "--source",
  "slice.json",
  "--prefix",
  "gs://private-bucket/research/storyboard",
  "--cache-dir",
  "/tmp/storyboard-cache",
  "--out",
  "/tmp/ready.json",
  "--start-index",
  "0",
  "--max-posts",
  "1",
  "--max-charge-usd",
  "0.5",
];

describe("bounded recovery CLI", () => {
  it("requires explicit caps and refuses an oversized batch", () => {
    expect(parseRecoveryArgs(args).execute).toBe(false);
    expect(() => parseRecoveryArgs(args.map((x) => (x === "1" ? "4" : x)))).toThrow();
    expect(() => parseRecoveryArgs([...args, "--unknown"])).toThrow();
  });

  it("dry-runs the frozen slice without provider auth or writes", async () => {
    const token = vi.fn(() => undefined);
    const print = vi.fn();
    const result = await mainRecover(args, {
      readSources: async () => [
        {
          shortcode: "DTbusF1GO7X",
          accountHandle: "kevinruss",
          postUrl: "https://www.instagram.com/p/DTbusF1GO7X/",
          expectedChildren: 3,
          metadataCapturedAt: "2026-08-31T22:38:33Z",
        },
      ],
      token,
      print,
    });
    expect(result).toMatchObject({ selected: 1, ready: 0 });
    expect(token).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledWith(expect.stringContaining("3 expected children"));
  });
});
