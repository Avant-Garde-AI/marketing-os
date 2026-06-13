// @ts-nocheck
/**
 * Remote skill-set source — pulls a versioned skill-set artifact (tarball/OCI)
 * from a registry, verifies its manifest, and returns the SkillSet. Loaded only
 * when DESIGN_SKILLSET_REGISTRY is configured. Not typechecked/tested in the
 * core build — exercised against the real registry.
 */
export class RemoteSkillSetSource {
  constructor(registryUrl, apiKey) {
    this.registryUrl = registryUrl;
    this.apiKey = apiKey;
  }

  async pull(pin) {
    const url = `${this.registryUrl}/skillsets/${pin.version}`;
    const res = await fetch(url, {
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
    });
    if (!res.ok) throw new Error(`skill-set ${pin.version} pull failed: ${res.status}`);
    const set = await res.json(); // { manifest, skills }
    if (set?.manifest?.version !== pin.version) {
      throw new Error(`skill-set version mismatch: pinned ${pin.version}, registry returned ${set?.manifest?.version}`);
    }
    return set;
  }
}

export function createRemoteSkillSetSource(config) {
  const registry = process.env.DESIGN_SKILLSET_REGISTRY;
  if (!registry) throw new Error("DESIGN_SKILLSET_REGISTRY not set — cannot pull remote skill-set.");
  return new RemoteSkillSetSource(registry, process.env.DESIGN_SKILLSET_REGISTRY_KEY);
}
