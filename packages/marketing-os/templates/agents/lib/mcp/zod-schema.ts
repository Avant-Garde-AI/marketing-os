/**
 * Zod → JSON Schema, for mirroring Mastra tools onto the MCP endpoint.
 *
 * ## Why this exists rather than a hand-written schema per tool
 *
 * The email block on /api/mcp hand-writes a JSON Schema beside every tool, under
 * a comment that says "JSON Schema mirrors the Mastra tools". Mirrors drift.
 * A hand-written schema that forgets a field does not fail — the tool just
 * quietly cannot be called with it from MCP, and the only symptom is an agent
 * that never uses a capability the store paid for. Deriving the schema from the
 * tool's own zod means the mirror cannot fall out of step, because there is no
 * mirror.
 *
 * ## Why not `zod-to-json-schema`
 *
 * It is present in the tree only as a transitive dependency of Mastra. Promoting
 * it to a direct dependency means regenerating pnpm-lock.yaml, and Vercel builds
 * with --frozen-lockfile: adding `sharp` without the lockfile is exactly how a
 * deploy broke before. The subset of zod these tools actually use is small and
 * closed, so covering it here costs less than the dependency does.
 *
 * ## Scope, stated honestly
 *
 * This covers the constructs the agent tools use. Anything it does not recognise
 * degrades to `{}` — "any JSON" — rather than throwing or, far worse, emitting a
 * confidently wrong constraint that would make a valid call fail validation at
 * the client. A permissive schema still reaches the tool, whose zod then does
 * the real validation and returns a precise error. That asymmetry is the whole
 * design: this file decides how a call is DESCRIBED, never whether it is VALID.
 */

/**
 * Structural view of a zod schema.
 *
 * Deliberately `unknown` at every entry point rather than a zod type: Mastra
 * types `Tool.inputSchema` as `StandardSchemaWithJSON<T>`, which at RUNTIME is
 * the zod object (`_def.typeName === "ZodObject"`) but at compile time shares
 * no structure with it — and carries no JSON Schema of its own, so there is
 * nothing better to read. Narrowing happens here, once, instead of forcing a
 * cast at every call site.
 */
interface ZodLike {
  _def?: Record<string, unknown> & { typeName?: string };
  description?: string;
}

function asZod(schema: unknown): ZodLike {
  return (schema ?? {}) as ZodLike;
}

type Json = Record<string, unknown>;

function def(schema: ZodLike): Record<string, unknown> & { typeName?: string } {
  return schema?._def ?? {};
}

/** Constructs that wrap another type without changing its JSON shape. */
const TRANSPARENT = new Set([
  "ZodOptional",
  "ZodNullable",
  "ZodDefault",
  "ZodCatch",
  "ZodBranded",
  "ZodReadonly",
  "ZodLazy",
]);

/** Unwrap wrappers to the type that actually describes the value. */
function inner(schema: ZodLike): ZodLike {
  let cur = schema;
  for (let depth = 0; depth < 20; depth++) {
    const d = def(cur);
    if (!d.typeName || !TRANSPARENT.has(d.typeName)) return cur;
    const next =
      d.typeName === "ZodLazy"
        ? (d.getter as (() => ZodLike) | undefined)?.()
        : (d.innerType as ZodLike | undefined);
    if (!next) return cur;
    cur = next;
  }
  return cur;
}

function isOptional(schema: ZodLike): boolean {
  const d = def(schema);
  if (d.typeName === "ZodOptional" || d.typeName === "ZodDefault") return true;
  // A nullable wrapper is NOT optional — null is a value, absence is not.
  if (d.typeName === "ZodNullable" || d.typeName === "ZodReadonly" || d.typeName === "ZodBranded") {
    return isOptional((d.innerType as ZodLike) ?? {});
  }
  return false;
}

/**
 * The description nearest the value. `.describe()` on a wrapper and on the
 * wrapped type are both common — `z.string().describe(…).optional()` puts it
 * inside, `z.string().optional().describe(…)` puts it outside — and losing
 * either would strip the guidance the tool author wrote for the agent.
 */
function describe(schema: ZodLike): string | undefined {
  if (schema?.description) return schema.description;
  const d = def(schema);
  if (d.typeName && TRANSPARENT.has(d.typeName)) {
    const next =
      d.typeName === "ZodLazy"
        ? (d.getter as (() => ZodLike) | undefined)?.()
        : (d.innerType as ZodLike | undefined);
    if (next) return describe(next);
  }
  return undefined;
}

/** String checks worth carrying across: they tell the caller the FORMAT. */
function stringConstraints(d: Record<string, unknown>): Json {
  const out: Json = {};
  const checks = (d.checks as Array<Record<string, unknown>> | undefined) ?? [];
  for (const c of checks) {
    if (c.kind === "min") out.minLength = c.value;
    else if (c.kind === "max") out.maxLength = c.value;
    else if (c.kind === "regex" && c.regex instanceof RegExp) out.pattern = c.regex.source;
    else if (c.kind === "url") out.format = "uri";
    else if (c.kind === "uuid") out.format = "uuid";
    else if (c.kind === "datetime") out.format = "date-time";
    else if (c.kind === "email") out.format = "email";
  }
  return out;
}

function numberConstraints(d: Record<string, unknown>): Json {
  const out: Json = {};
  const checks = (d.checks as Array<Record<string, unknown>> | undefined) ?? [];
  for (const c of checks) {
    if (c.kind === "min") out.minimum = c.value;
    else if (c.kind === "max") out.maximum = c.value;
    else if (c.kind === "int") out.type = "integer";
  }
  return out;
}

/** JSON Schema for one zod type. Unknown constructs become `{}` — see the header. */
export function jsonSchemaFromZod(schema: unknown): Json {
  const target = inner(asZod(schema));
  const d = def(target);
  const description = describe(asZod(schema));
  const withDescription = (body: Json): Json =>
    description ? { ...body, description } : body;

  switch (d.typeName) {
    case "ZodObject": {
      const shapeFn = d.shape as (() => Record<string, ZodLike>) | undefined;
      const shape = typeof shapeFn === "function" ? shapeFn() : {};
      const properties: Json = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = jsonSchemaFromZod(value);
        if (!isOptional(value)) required.push(key);
      }
      return withDescription({
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
      });
    }

    case "ZodArray":
      return withDescription({
        type: "array",
        items: jsonSchemaFromZod((d.type as ZodLike) ?? {}),
      });

    case "ZodString":
      return withDescription({ type: "string", ...stringConstraints(d) });

    case "ZodNumber":
      return withDescription({ type: "number", ...numberConstraints(d) });

    case "ZodBoolean":
      return withDescription({ type: "boolean" });

    case "ZodEnum":
      return withDescription({ type: "string", enum: (d.values as string[]) ?? [] });

    case "ZodNativeEnum": {
      const values = Object.values((d.values as Record<string, unknown>) ?? {});
      return withDescription({ enum: values });
    }

    case "ZodLiteral":
      return withDescription({ const: d.value });

    case "ZodUnion": {
      const options = ((d.options as ZodLike[]) ?? []).map(jsonSchemaFromZod);
      return withDescription(options.length ? { anyOf: options } : {});
    }

    case "ZodDiscriminatedUnion": {
      const raw = d.options as ZodLike[] | Map<unknown, ZodLike> | undefined;
      const options = Array.isArray(raw) ? raw : raw ? [...raw.values()] : [];
      return withDescription(options.length ? { anyOf: options.map(jsonSchemaFromZod) } : {});
    }

    case "ZodRecord":
      return withDescription({
        type: "object",
        additionalProperties: jsonSchemaFromZod((d.valueType as ZodLike) ?? {}),
      });

    case "ZodTuple":
      return withDescription({
        type: "array",
        items: ((d.items as ZodLike[]) ?? []).map(jsonSchemaFromZod),
      });

    case "ZodNull":
      return withDescription({ type: "null" });

    default:
      // ZodAny, ZodUnknown, ZodEffects (.refine/.transform), and anything a
      // future zod adds. Permissive on purpose — see the header.
      return withDescription({});
  }
}

/**
 * A Mastra/pack tool, as far as MCP mirroring cares.
 *
 * `execute` is variadic because Mastra's real signature is
 * `(inputData, context)` while the MCP dispatch only ever has the input —
 * the same shape the route's existing `runMastra` helper casts its way past.
 */
export interface MirrorableTool {
  id?: string;
  description?: string;
  inputSchema?: unknown;
  execute?: (...args: never[]) => Promise<unknown>;
}

export interface MirroredTool {
  name: string;
  description: string;
  inputSchema: Json;
  run: (args: unknown) => Promise<unknown>;
}

/**
 * Mirror a registry of Mastra tools onto MCP tool definitions.
 *
 * `only` narrows the set, because not every runtime tool belongs on a store's
 * public endpoint. It is an allow-list rather than a deny-list deliberately:
 * a tool added to the runtime later must be chosen for MCP, not exposed by
 * forgetting to exclude it.
 *
 * A name in `only` that the registry does not have THROWS, rather than being
 * skipped. A silently-missing tool is the exact failure this file exists to
 * prevent, and a rename upstream should break the build, not the endpoint.
 */
export function mirrorTools(
  // `unknown` values, narrowed below: Mastra's Tool type is generic over its
  // input, output and execution context, so a registry of them has no useful
  // common supertype to name here.
  registry: Record<string, unknown>,
  only: string[],
): MirroredTool[] {
  return only.map((name) => {
    const tool = registry[name] as MirrorableTool | undefined;
    if (!tool?.execute) {
      throw new Error(
        `mirrorTools: "${name}" is not in this registry (have: ${Object.keys(registry).sort().join(", ")})`,
      );
    }
    return {
      name,
      description: tool.description ?? name,
      inputSchema: tool.inputSchema
        ? jsonSchemaFromZod(tool.inputSchema)
        : { type: "object", properties: {} },
      run: (args: unknown) => (tool.execute as (i: unknown) => Promise<unknown>)(args),
    };
  });
}
