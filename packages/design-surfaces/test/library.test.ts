import { describe, expect, it } from "vitest";
import {
  composeLibraryFile,
  sourceDigest,
  validateLibrary,
  type LibrarySource,
} from "../src/library";

const arthaus: LibrarySource = {
  name: "arthaus-design-library",
  version: "0.1.0",
  colors: [
    { name: "warm-parchment", color: "#F5F2ED" },
    { name: "charcoal", color: "#2D2D2D" },
  ],
  typographies: [
    { name: "display/headline", fontFamily: "Lora", fontSize: "64", fontWeight: "500", lineHeight: "1.15" },
    { name: "supporting/eyebrow", fontFamily: "Inter", fontSize: "22", letterSpacing: "1.4" },
  ],
  components: [
    {
      name: "caption-band",
      width: 1080,
      height: 216,
      elements: [
        { type: "rect", name: "ground", x: 0, y: 0, width: 1080, height: 216, fills: [{ fillColor: "#F5F2ED", fillOpacity: 1 }] },
        { type: "rect", name: "rule", x: 64, y: 0, width: 952, height: 2, fills: [{ fillColor: "#2D2D2D", fillOpacity: 1 }] },
        {
          type: "text",
          name: "eyebrow",
          x: 64,
          y: 78,
          width: 700,
          height: 40,
          characters: "Eyebrow",
          fontFamily: "Inter",
          fontSize: "22",
          fills: [{ fillColor: "#6B6560", fillOpacity: 1 }],
        },
      ],
    },
  ],
};

describe("validateLibrary", () => {
  it("accepts a well-formed library", () => {
    expect(validateLibrary(arthaus)).toEqual([]);
  });

  it("rejects duplicate asset names — Penpot resolves by name", () => {
    const problems = validateLibrary({
      ...arthaus,
      components: [...arthaus.components!, { ...arthaus.components![0]! }],
    });
    expect(problems.some((p) => p.detail.includes("duplicate component"))).toBe(true);
  });

  it("rejects an empty component", () => {
    const problems = validateLibrary({
      ...arthaus,
      components: [{ name: "empty", width: 100, height: 100, elements: [] }],
    });
    expect(problems.some((p) => p.detail.includes("no elements"))).toBe(true);
  });

  it("rejects an element that escapes its component bounds", () => {
    const problems = validateLibrary({
      ...arthaus,
      components: [
        {
          name: "overflowing",
          width: 100,
          height: 100,
          elements: [{ type: "rect", x: 60, y: 0, width: 80, height: 10 }],
        },
      ],
    });
    expect(problems.some((p) => p.detail.includes("outside the component bounds"))).toBe(true);
  });
});

describe("sourceDigest", () => {
  it("is stable for the same library", () => {
    expect(sourceDigest(arthaus)).toEqual(sourceDigest({ ...arthaus }));
  });

  it("moves when the design changes", () => {
    const changed = { ...arthaus, colors: [{ name: "warm-parchment", color: "#FFFFFF" }] };
    expect(sourceDigest(changed)).not.toEqual(sourceDigest(arthaus));
  });

  it("moves when a version is bumped", () => {
    expect(sourceDigest({ ...arthaus, version: "0.2.0" })).not.toEqual(sourceDigest(arthaus));
  });
});

describe("composeLibraryFile", () => {
  it("refuses to publish an invalid library rather than shipping a broken one", async () => {
    await expect(
      composeLibraryFile({ ...arthaus, components: [{ name: "x", width: 0, height: 0, elements: [] }] }),
    ).rejects.toThrow(/not publishable/);
  });

  it("produces a real .penpot carrying colours, typographies and components", async () => {
    const bytes = await composeLibraryFile(arthaus);
    expect(bytes.byteLength).toBeGreaterThan(1000);

    // A .penpot is a zip. Read the central directory filenames rather than
    // fully inflating: what matters is that the library ASSET directories
    // exist, which is exactly what makes the file a shared library rather
    // than an ordinary design file.
    const names = zipEntryNames(Buffer.from(bytes));
    expect(names.some((n) => n.includes("/colors/"))).toBe(true);
    expect(names.some((n) => n.includes("/typographies/"))).toBe(true);
    expect(names.some((n) => n.includes("/components/"))).toBe(true);
    expect(names).toContain("manifest.json");
  });

  it("is deterministic in structure — republishing an unchanged library changes nothing meaningful", async () => {
    const a = zipEntryNames(Buffer.from(await composeLibraryFile(arthaus)));
    const b = zipEntryNames(Buffer.from(await composeLibraryFile(arthaus)));
    // Ids are generated per build, so compare SHAPE: same number of entries in
    // the same directories. A structural change here means a real change.
    const shape = (names: string[]) =>
      names.map((n) => n.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")).sort();
    expect(shape(a)).toEqual(shape(b));
  });
});

/** Filenames from a zip's local file headers. */
function zipEntryNames(buf: Buffer): string[] {
  const names: string[] = [];
  let i = 0;
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) === 0x04034b50) {
      const nameLen = buf.readUInt16LE(i + 26);
      const extraLen = buf.readUInt16LE(i + 28);
      names.push(buf.subarray(i + 30, i + 30 + nameLen).toString("utf8"));
      i += 30 + nameLen + extraLen;
    } else {
      i++;
    }
  }
  return names;
}
