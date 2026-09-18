import { z } from 'zod';
import type { ZodType } from 'zod';

import { GenerationPlanSchema } from './plan-schema.ts';
import { MockupSetSchema } from './mockup-schema.ts';

/**
 * What shape a model is being asked to reply in (#189 review, P1).
 *
 * This exists because it did not, and the omission broke a whole feature
 * silently. Every client hard-coded the *plan's* shape: Anthropic put
 * `GenerationPlanSchema` in `output_config`, OpenAI put `planJsonSchema()`
 * in `text.format`, and DeepSeek appended a JSON-mode instruction spelling
 * out `{summary, files}`. A request is a system prompt, a user prompt and a
 * schema, and I had been treating the third as a property of the client
 * rather than of the request.
 *
 * So `/api/mockups` asked two of the three providers for a mockup set in
 * the prompt while the API constrained the reply to a generation plan.
 * Those runs could not succeed: the model returns `{summary, files}`,
 * `MockupSetSchema` rejects it, and the caller is billed for a refusal they
 * did not cause. On DeepSeek it was not structurally impossible, only
 * contradictory -- the mockup prompt asked for `{mockups: [...]}` and the
 * paragraph appended after it demanded a plan.
 *
 * Nothing caught this because the route's tests use a fake client, so the
 * one thing never exercised was whether a real client asks for what the
 * provider was written to produce. The client tests now assert that the
 * schema in the request is the schema the caller asked for, rather than any
 * particular schema.
 */
export interface PlanOutput {
  /** Format name, for the providers that take one. */
  name: string;
  /** The schema a reply has to match, checked again by the provider. */
  schema: ZodType;
  /**
   * The same shape written out, for a client with only JSON mode and no
   * way to enforce a schema.
   */
  instruction: string;
}

/**
 * A JSON Schema the strict structured-output modes will accept.
 *
 * Derived from the Zod schema rather than written twice. The strip pass is
 * `planJsonSchema`'s, generalised: strict mode rejects `$schema` and the
 * `minLength` / `minItems` / `maxLength` / `maxItems` vocabulary, and
 * dropping them loses nothing real because the provider runs the actual Zod
 * schema over whatever comes back. Sending a keyword the API rejects fails
 * every request; sending a looser schema fails none, and the tighter check
 * still happens a layer up.
 */
export function jsonSchemaFor(schema: ZodType): Record<string, unknown> {
  const DROPPED = new Set([
    '$schema',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
  ]);
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (typeof node !== 'object' || node === null) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (DROPPED.has(key)) continue;
      out[key] = strip(value);
    }
    return out;
  };
  return strip(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export const PLAN_JSON_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "summary": "one sentence describing what you built",
  "files": [
    { "path": "package.json", "content": "<the complete file>" }
  ]
}

"files" must contain every file of the project, each with its full content.`;

export const MOCKUP_JSON_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "mockups": [
    {
      "label": "a short name for this direction",
      "rationale": "one sentence on what it is for",
      "html": "<!doctype html><html>...the complete document...</html>"
    }
  ]
}

"mockups" must contain three entries, each a complete self-contained HTML
document.`;

/** A generation plan: what every run asked for before this existed. */
export const PLAN_OUTPUT: PlanOutput = {
  name: 'generation_plan',
  schema: GenerationPlanSchema,
  instruction: PLAN_JSON_INSTRUCTION,
};

/** Three directions to choose between (#185). */
export const MOCKUP_OUTPUT: PlanOutput = {
  name: 'mockup_set',
  schema: MockupSetSchema,
  instruction: MOCKUP_JSON_INSTRUCTION,
};

/**
 * The shape this request asks for, defaulting to a plan.
 *
 * One function rather than `request.output ?? PLAN_OUTPUT` in each client,
 * because three copies of a default are three places that can come to
 * disagree about it -- which is, in miniature, the bug this module exists
 * to fix.
 */
export function outputFor(request: { output?: PlanOutput }): PlanOutput {
  return request.output ?? PLAN_OUTPUT;
}
