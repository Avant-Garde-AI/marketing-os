/**
 * Provider selection. Returns real adapters when the harness is configured for a
 * live run (a theme server + browser + critic endpoint are available), otherwise
 * the stub providers. Real adapters are lazy-loaded so the package builds and
 * tests run with zero heavy dependencies installed.
 */
import type { DesignLoopConfig } from "../config.js";
import type { DesignLoopProviders } from "../types.js";
import { createStubProviders } from "./stub.js";

export { createStubProviders } from "./stub.js";
export type { StubScenario } from "./stub.js";

export interface BuildProvidersOptions {
  /** Force the stub providers regardless of config (tests, dry runs). */
  stub?: boolean;
}

export async function buildProviders(
  config: DesignLoopConfig,
  options: BuildProvidersOptions = {},
): Promise<DesignLoopProviders> {
  const wantReal = !options.stub && process.env["DESIGN_LOOP_REAL"] === "1";
  if (!wantReal) return createStubProviders();

  // Real adapters are dynamically imported only on a live run.
  const [{ createThemeServer }, { createPlaywrightCapture }, { createVisualDiff }, { createVlmCritic }, { createLlmImplementer }] =
    await Promise.all([
      import("../adapters/theme-dev.js"),
      import("../adapters/playwright-capture.js"),
      import("../adapters/visual-diff.js"),
      import("../adapters/anthropic-critic.js"),
      import("../adapters/llm-implementer.js"),
    ]);

  const themeServer = await createThemeServer(config);

  // Design MCP (PRD §4.1) + capture-bundle ingestion (PRD §4.2) wire in when
  // their endpoints are configured; otherwise conformance stays local.
  let knowledge: DesignLoopProviders["knowledge"];
  if (config.designMcpEndpoint) {
    const { createRemoteDesignMcp } = await import("../design-mcp/remote.js");
    knowledge = await createRemoteDesignMcp(config);
  }
  let uploader: DesignLoopProviders["uploader"];
  if (process.env["CAPTURE_BUNDLE_UPLOAD_URL"]) {
    const { createSignedUrlUploader } = await import("../upload-remote.js");
    uploader = createSignedUrlUploader(config);
  }

  // Pin + pull the design skill-set at session start (PRD §4.3). A remote
  // registry serves versioned artifacts; otherwise the bundled v0 set is used.
  const pin = { version: config.versionVector.skillset };
  const { LocalSkillSetSource, pullSkillSet } = await import("../skills/source.js");
  type Src = import("../skills/types.js").SkillSetSource;
  const source: Src = process.env["DESIGN_SKILLSET_REGISTRY"]
    ? ((await import("../skills/remote.js")).createRemoteSkillSetSource(config) as Src)
    : new LocalSkillSetSource();
  const skillSet = await pullSkillSet(source, pin);

  return {
    themeServer,
    capture: createPlaywrightCapture(config),
    critic: createVlmCritic(config),
    implementer: createLlmImplementer(config),
    diff: createVisualDiff(config),
    knowledge,
    uploader,
    skillSet,
  };
}
