/**
 * Provenance — every claim a pack artifact carries knows where it came from
 * (spec 22 §2's provenance model, inherited by spec 24 §1 and every pack
 * since). `owner` is stated by the human (highest authority), `agent` is
 * proposed by an agent and owner-approved, `data` is derived from the store's
 * own connected analytics/commerce.
 */
export type ProvenanceOrigin = "owner" | "agent" | "data";

export interface ProvenanceClaim {
  claim: string;
  origin: ProvenanceOrigin;
}
