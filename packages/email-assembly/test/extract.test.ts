import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSkeleton, SkeletonExtractionError } from "../src/extract";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "fixtures", name), "utf8");

const dragDrop = fixture("drag-drop.html");
const handCoded = fixture("hand-coded.html");
const hybridMso = fixture("hybrid-mso.html");
const hostile = fixture("hostile-no-unsubscribe.html");

describe("extractSkeleton — drag-drop-generated style (fixture a)", () => {
  const result = extractSkeleton(dragDrop);

  it("classifies the content regions into named slots", () => {
    expect(result.slots.map((s) => s.name)).toEqual(["hero", "body-1", "products", "cta"]);
  });

  it("emits one {{slot:NAME}} marker per slot in the skeleton", () => {
    for (const slot of result.slots) {
      const marker = `{{slot:${slot.name}}}`;
      expect(result.skeletonHtml.split(marker)).toHaveLength(2);
    }
  });

  it("preserves the doctype, head, and MSO conditionals verbatim", () => {
    expect(result.skeletonHtml.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(result.skeletonHtml).toContain("<!--[if mso]>");
    expect(result.skeletonHtml).toContain("<o:PixelsPerInch>96</o:PixelsPerInch>");
    expect(result.skeletonHtml).toContain("@media only screen and (max-width: 480px)");
  });

  it("preserves the header/logo band and the footer/legal band", () => {
    expect(result.skeletonHtml).toContain("arthaus-logo-charcoal.png");
    expect(result.skeletonHtml).toContain("210 West Elm Street");
  });

  it("preserves Klaviyo unsubscribe merge tags byte-verbatim", () => {
    expect(result.skeletonHtml).toContain('<a href="{% unsubscribe %}"');
    expect(result.skeletonHtml).toContain("{% manage_preferences %}");
  });

  it("strips campaign-specific copy from content regions", () => {
    expect(result.skeletonHtml).not.toContain("The Summer Edit has landed");
    expect(result.skeletonHtml).not.toContain("Fern Study No. 2");
    expect(result.skeletonHtml).not.toContain("Shop the Edit");
  });

  it("strips <script> tags and records a finding", () => {
    expect(result.skeletonHtml).not.toContain("<script");
    expect(result.findings.some((f) => f.type === "script-removed")).toBe(true);
  });

  it("strips foreign tracking pixels and records a finding", () => {
    expect(result.skeletonHtml).not.toContain("trk.legacy-esp.example.com");
    const finding = result.findings.find((f) => f.type === "tracking-pixel-removed");
    expect(finding?.detail).toContain("trk.legacy-esp.example.com");
  });

  it("records a content-replaced finding per slot, with a copy preview", () => {
    const replaced = result.findings.filter((f) => f.type === "content-replaced");
    expect(replaced).toHaveLength(4);
    expect(replaced.find((f) => f.detail.includes("slot body-1"))?.detail).toContain(
      "The Summer Edit has landed",
    );
  });

  it("records slot constraints from the surrounding cells", () => {
    const hero = result.slots.find((s) => s.name === "hero");
    expect(hero).toMatchObject({ maxWidth: 600, backgroundContext: "#ffffff" });
    const body = result.slots.find((s) => s.name === "body-1");
    expect(body?.paddingContext).toBe("32px 32px 8px 32px");
  });

  it("replaces tr bands with a td-wrapped marker (valid tbody context)", () => {
    expect(result.skeletonHtml).toContain("<tr><td>{{slot:hero}}</td></tr>");
  });

  it("is deterministic: double-run produces identical output", () => {
    const again = extractSkeleton(dragDrop);
    expect(again.skeletonHtml).toBe(result.skeletonHtml);
    expect(again.slots).toEqual(result.slots);
    expect(again.findings).toEqual(result.findings);
  });
});

describe("extractSkeleton — hand-coded minimal style (fixture b)", () => {
  const result = extractSkeleton(handCoded);

  it("extracts body slots between the logo band and the unsubscribe band", () => {
    expect(result.slots.map((s) => s.name)).toEqual(["body-1", "body-2"]);
    expect(result.skeletonHtml).toContain("{% unsubscribe %}");
    expect(result.skeletonHtml).toContain("arthaus-logo-charcoal.png");
  });

  it("strips the campaign copy", () => {
    expect(result.skeletonHtml).not.toContain("A note on framing light");
  });
});

describe("extractSkeleton — hybrid MSO style (fixture c)", () => {
  const result = extractSkeleton(hybridMso);

  it("detects the div-based spine and classifies stacked-table bands", () => {
    expect(result.slots.map((s) => s.name)).toEqual(["hero", "body-1", "cta"]);
  });

  it("preserves outer MSO conditional scaffolding verbatim", () => {
    expect(result.skeletonHtml).toContain(
      '<!--[if mso]>\n<table role="presentation" width="600" align="center"',
    );
    expect(result.skeletonHtml).toContain("<!--[if mso]>\n</td></tr></table>\n<![endif]-->");
  });

  it("preserves inlined universal-content comments and frame merge tags", () => {
    expect(result.skeletonHtml).toContain("<!-- universal-content:header");
    expect(result.skeletonHtml).toContain("{% organization.name %}");
    expect(result.skeletonHtml).toContain('{% unsubscribe_url %}');
  });

  it("replaces stacked-table bands with bare markers (already in td/div context)", () => {
    expect(result.skeletonHtml).toContain("\n{{slot:hero}}\n");
  });

  it("strips campaign copy including its merge tags (content is content)", () => {
    expect(result.skeletonHtml).not.toContain("{{ first_name");
    expect(result.skeletonHtml).not.toContain("the wall is the work");
  });
});

describe("extractSkeleton — mechanical invariants (throw)", () => {
  it("hard-fails the hostile fixture: no unsubscribe merge tag", () => {
    expect(() => extractSkeleton(hostile)).toThrowError(SkeletonExtractionError);
    try {
      extractSkeleton(hostile);
      expect.unreachable("hostile fixture must not extract");
    } catch (err) {
      expect((err as SkeletonExtractionError).code).toBe("unsubscribe-missing");
      expect((err as SkeletonExtractionError).message).toContain("compliance incident");
    }
  });

  it("rejects empty input as unparseable", () => {
    expect(() => extractSkeleton("   ")).toThrowError(/empty input/);
  });

  it("rejects non-email HTML with no body/table structure", () => {
    try {
      extractSkeleton("<p>just a paragraph</p>");
      expect.unreachable();
    } catch (err) {
      expect((err as SkeletonExtractionError).code).toBe("unparseable");
    }
  });

  it("rejects a template with no single ≤600px column", () => {
    const wide = handCoded.replace(/600/g, "900");
    try {
      extractSkeleton(wide);
      expect.unreachable();
    } catch (err) {
      expect((err as SkeletonExtractionError).code).toBe("no-single-column");
    }
  });

  it("rejects a template whose structure exceeds 600px", () => {
    // Keep the 600px spine, add an over-wide sibling table.
    const wide = handCoded.replace(
      "</body>",
      '<table width="720"><tr><td>too wide</td></tr></table></body>',
    );
    try {
      extractSkeleton(wide);
      expect.unreachable();
    } catch (err) {
      expect((err as SkeletonExtractionError).code).toBe("column-too-wide");
    }
  });

  it("rejects a frame-only template with zero content regions", () => {
    // Logo band + unsubscribe band only — nothing between.
    const frameOnly = `<!DOCTYPE html><html><head><title>x</title></head><body>
<table width="600">
<tr><td><img src="https://d3k81ch9hvuctc.cloudfront.net/c/logo.png" alt="logo" width="100"></td></tr>
<tr><td><a href="{% unsubscribe %}">Unsubscribe</a></td></tr>
</table></body></html>`;
    try {
      extractSkeleton(frameOnly);
      expect.unreachable();
    } catch (err) {
      expect((err as SkeletonExtractionError).code).toBe("no-slots");
    }
  });
});

describe("extractSkeleton — brand drift (optional palette compare)", () => {
  it("reports frame colors outside the DESIGN.md palette", () => {
    const result = extractSkeleton(handCoded, {
      brandColors: ["#1f1c17", "#3d382f", "#8a6d3b", "#ffffff"],
    });
    const drift = result.findings.filter((f) => f.type === "brand-drift");
    // #e8e2d8 (borders) and #8b8272 (footer text) are not in the palette.
    expect(drift.map((f) => f.detail)).toEqual([
      expect.stringContaining("#e8e2d8"),
      expect.stringContaining("#8b8272"),
    ]);
  });

  it("emits no brand-drift findings when no palette is supplied", () => {
    const result = extractSkeleton(handCoded);
    expect(result.findings.every((f) => f.type !== "brand-drift")).toBe(true);
  });
});
