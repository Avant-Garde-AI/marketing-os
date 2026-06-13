/**
 * Release machine (PRD §7) — bench-gated releases with a regression baseline.
 */
export {
  evaluateGate,
  runReleaseGate,
  baselineFrom,
  formatGateReport,
  type GatePolicy,
  type GateBaseline,
  type GateEvaluation,
  type GateResult,
} from "./gate.js";
export { readBaseline, writeBaseline } from "./baseline.js";
