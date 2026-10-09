import { z } from 'zod';
import type { ZodType } from 'zod';

import {
  BuildOutlineSchema,
  FileGroupSchema,
  GenerationPlanSchema,
  KeptSpecOutlineSchema,
} from './plan-schema.ts';
import { DraftMockupSetSchema, MockupSetSchema } from './mockup-schema.ts';
import { ChatDecisionSchema } from './chat-schema.ts';

/**
 * What shape a model is being asked to reply in (internal PR 189 review, P1).
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
  /**
   * False where Anthropic cannot constrain the reply to `schema`.
   *
   * Anthropic compiles a strict schema into a grammar and refuses one past
   * its size limit with a 400, "The compiled grammar is too large". The two
   * shapes that carry a design spec are past it: try-generation run
   * 37950953797 failed its outline in half a second, so every Claude build
   * failed at its first step. For these the client asks for JSON in the
   * system prompt with `instruction` instead, as DeepSeek's JSON mode does,
   * and the caller's read schema checks the reply as it always did.
   */
  strict?: boolean;
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

/**
 * The spec as the JSON-mode instructions spell it out, shared by the plan's
 * and the outline's so the two cannot come to describe different specs.
 */
const SPEC_JSON_EXAMPLE = `{
    "intent": "one sentence: subject, audience, the page's single job",
    "tokens": {
      "colors": [{ "name": "background", "value": "#07121c", "use": "page background" }],
      "fonts": [{ "role": "display", "family": "Playfair Display", "fallback": "Georgia, serif", "weights": [400] }],
      "type": [{ "name": "hero", "size": "clamp(4.3rem, 8.8vw, 8.3rem)", "lineHeight": "0.99", "letterSpacing": "-0.065em" }],
      "space": [{ "name": "gutter", "value": "24px" }],
      "radii": [{ "name": "pill", "value": "999px" }],
      "effects": [{ "name": "glass", "value": "backdrop-filter: blur(18px)" }]
    },
    "sections": [
      {
        "id": "hero",
        "purpose": "what this section is for",
        "layout": "measurements: max width, alignment, spacing",
        "copy": [{ "role": "heading", "text": "every visible string, verbatim" }]
      }
    ],
    "breakpoints": [{ "maxWidth": 650, "changes": ["what changes at this width"] }],
    "motion": [{ "element": "hero h1, per word", "trigger": "load", "behaviour": "rise 110% and fade in, 70ms stagger", "timing": "spring stiffness 120 damping 20" }],
    "do": ["a rule naming a real token"],
    "avoid": ["what not to add, and what it would break"],
    "checks": ["an observable fact a reviewer can confirm"],
    "sample": ["where sample content is and what it stands in for"]
  }`;

export const PLAN_JSON_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "summary": "one sentence describing what you built",
  "spec": ${SPEC_JSON_EXAMPLE},
  "files": [
    { "path": "package.json", "content": "<the complete file>" }
  ]
}

"spec" comes before "files". "files" must contain every file of the
project, each with its full content.`;

/** The first step of a bounded build (`bounded-build.ts`). */
export const OUTLINE_JSON_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "summary": "one sentence describing what you will build",
  "title": "the site's name, a few words",
  "description": "one sentence for search results",
  "spec": ${SPEC_JSON_EXAMPLE},
  "manifest": [
    {
      "path": "src/pages/Services.tsx",
      "purpose": "what the file is for, what it exports, what it shows",
      "dependsOn": ["src/components/SiteLayout.tsx"],
      "size": "small, medium or large"
    }
  ],
  "dependencies": [],
  "delete": []
}

"spec" comes before "manifest". "manifest" plans files and holds no file
content. "dependencies" lists { "name", "version" } for each package outside
the stack a planned file imports, and is usually empty.`;

/**
 * The first step of a bounded build that keeps its spec (a repair): the
 * outline without a spec, a title or a description.
 */
export const KEPT_SPEC_OUTLINE_JSON_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "summary": "one sentence describing the change",
  "manifest": [
    {
      "path": "src/pages/Services.tsx",
      "purpose": "what changes in the file and what stays",
      "dependsOn": ["src/components/SiteLayout.tsx"],
      "size": "small, medium or large"
    }
  ],
  "dependencies": [],
  "delete": []
}

There is no "spec": the design is fixed. "manifest" plans files and holds no
file content.`;

/** Each later step of a bounded build: only the files it was asked for. */
export const FILE_GROUP_JSON_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "files": [
    { "path": "src/pages/Services.tsx", "content": "<the complete file>" }
  ]
}

"files" holds exactly the files you were asked to write, each with its full
content.`;

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

export const DRAFT_MOCKUP_JSON_INSTRUCTION = `OUTPUT FORMAT
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

"mockups" must contain exactly one entry, a complete self-contained HTML
document.`;

export const CHAT_JSON_INSTRUCTION = `OUTPUT FORMAT
Reply with a single json object and nothing else. No prose, no markdown, no
code fence. It must match this shape exactly:

{
  "action": "reply" or "build",
  "message": "what the person sees in the conversation",
  "brief": "the complete build instruction, or null for a reply"
}

"brief" is a string when "action" is "build" and null when it is "reply".`;

/** A generation plan: what every run asked for before this existed. */
export const PLAN_OUTPUT: PlanOutput = {
  name: 'generation_plan',
  schema: GenerationPlanSchema,
  instruction: PLAN_JSON_INSTRUCTION,
  strict: false,
};

/**
 * A bounded build's first step: the spec and a manifest of files, no file
 * content (`bounded-build.ts`).
 */
export const OUTLINE_OUTPUT: PlanOutput = {
  name: 'build_outline',
  schema: BuildOutlineSchema,
  instruction: OUTLINE_JSON_INSTRUCTION,
  strict: false,
};

/**
 * The first step of a bounded build that keeps its spec: a repair's
 * outline, which asks for no spec because the spec it has is kept
 * (`BoundedBuilderOptions.keepSpec`).
 */
export const KEPT_SPEC_OUTLINE_OUTPUT: PlanOutput = {
  name: 'patch_outline',
  schema: KeptSpecOutlineSchema,
  instruction: KEPT_SPEC_OUTLINE_JSON_INSTRUCTION,
};

/** Each later step of a bounded build: the few files it was asked for. */
export const FILE_GROUP_OUTPUT: PlanOutput = {
  name: 'file_group',
  schema: FileGroupSchema,
  instruction: FILE_GROUP_JSON_INSTRUCTION,
};

/** Three directions to choose between (internal issue 185). */
export const MOCKUP_OUTPUT: PlanOutput = {
  name: 'mockup_set',
  schema: MockupSetSchema,
  instruction: MOCKUP_JSON_INSTRUCTION,
};

/**
 * One direction, shown as a draft while a build runs (docs/decisions.md,
 * 2026-09-28, the draft preview).
 */
export const DRAFT_MOCKUP_OUTPUT: PlanOutput = {
  name: 'mockup_draft',
  schema: DraftMockupSetSchema,
  instruction: DRAFT_MOCKUP_JSON_INSTRUCTION,
};

/**
 * One chat turn's decision: a reply in words, or a brief to build from
 * (docs/decisions.md, "Resolved 2026-09-28").
 */
export const CHAT_OUTPUT: PlanOutput = {
  name: 'chat_turn',
  schema: ChatDecisionSchema,
  instruction: CHAT_JSON_INSTRUCTION,
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
