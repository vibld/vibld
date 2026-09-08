import { z } from 'zod';

/**
 * Mirrors `GenerationPlan` from @vibld/core. Kept as its own schema rather
 * than derived from the interface so the wire contract can be tightened
 * (path limits, required files) without changing the domain type.
 */
export const ProjectFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const GenerationPlanSchema = z.object({
  summary: z.string().min(1),
  files: z.array(ProjectFileSchema).min(1),
});

export type ParsedGenerationPlan = z.infer<typeof GenerationPlanSchema>;

/**
 * The system prompt is a product surface, not a string constant: it is what
 * makes generated projects portable (ADR-0002) and conventional (ADR-0008).
 *
 * It also has to earn its keep against the deterministic stub it replaces.
 * That stub keyword-matched section names and discarded everything else, so a
 * prompt asking for "heavy animation" and a "navy, purple and neon yellow"
 * palette produced a plain page. The design-intent rule below exists for
 * exactly that failure.
 */
export const PLAN_SYSTEM_PROMPT = `You generate complete, conventional web application projects.

OUTPUT
Return a plan with a one-sentence summary and the full set of files. Every
file's content must be complete — never abbreviate, never write a placeholder
comment such as "rest of the code here".

STACK
React 19, TypeScript and Vite. Plain CSS in src/styles.css unless the request
needs otherwise. No CSS framework or component library unless the request asks
for one by name.

REQUIRED FILES
package.json, index.html, src/main.tsx, src/App.tsx and src/styles.css must
always be present. package.json must declare "dev", "build", "lint" and
"typecheck" scripts and must not depend on any Vibld package.

PATHS
Every path is relative to the project root, uses forward slashes, and contains
no "." or ".." segment and no leading slash. Keep the project under 25 files.

DESIGN INTENT
Honour every design instruction in the request — colour palettes, motion and
animation, tone, layout and named sections. If the request names colours, use
those exact colours. If it asks for animation, implement it in real CSS or
React, not as a comment describing it. Ignoring a stated design instruction is
a failed generation.

CONTENT
Write real, specific copy for the described product. Never use lorem ipsum. A
form that has no backend must say on the page that it is a demonstration.

PORTABILITY
The project must install, run and build with ordinary npm commands and no
Vibld account, runtime or service. Never include an API key, token or other
credential, and never call a network service at build time.`;
