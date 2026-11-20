/**
 * @avant-garde/design-craft (spec 35): the DTC design-craft vocabulary,
 * perception labeling pipeline, and open label dataset.
 *
 * Logic only. The I/O adapters (`adapters/openai-vision`, `adapters/playwright-capture`)
 * are imported explicitly by callers or the CLI, so consumers like design-loop
 * can use the vocabulary without pulling in a browser.
 */
export * from "./vocabulary.js";
export * from "./ontology.js";
export * from "./corpus.js";
export * from "./labels.js";
export * from "./labeler.js";
export * from "./debrand.js";
export * from "./dataset.js";
export * from "./merge.js";
export { createOpenAIVisionModel, type OpenAIVisionConfig } from "./adapters/openai-vision.js";
export { createOpenAIEmbedder, createOpenAIMergeJudge, parseVerdicts, type OpenAIEndpointConfig } from "./adapters/openai-text.js";
