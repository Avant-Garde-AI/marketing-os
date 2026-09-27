/** Test-only: production model calls must be explicitly mocked. */
export class Agent {
  constructor(_config: unknown) {}
  async generate(_messages: unknown, _options: unknown): Promise<unknown> {
    throw new Error("Unexpected model call in a unit test");
  }
}
