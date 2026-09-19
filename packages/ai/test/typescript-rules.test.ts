import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLAN_SYSTEM_PROMPT } from '../src/plan-schema.ts';

/**
 * The one TypeScript rule a generated project cannot be written without.
 *
 * A real generation produced a project that failed `npm run build`; a second
 * run from the identical prompt built cleanly, so the difference was in what
 * the model happened to write. Reproduced without a model against the
 * scaffold's own tsconfig, two settings rejected ordinary React:
 *
 *   TS1484  import { ReactNode } from 'react'        (verbatimModuleSyntax)
 *   TS1205  export { CardProps } from './Card.tsx'   (isolatedModules)
 *
 * The first was a preference and `plan-builder.ts` dropped it: it rejects
 * the most ordinary import in React with TypeScript, and a project that
 * cannot compile cannot be published or exported, which is ADR-0002's whole
 * promise.
 *
 * The second cannot be dropped. Vite compiles one file at a time through
 * esbuild and needs `isolatedModules` to be correct. So the rule it imposes
 * has to reach the model, and the only channel is the prompt. A prompt that
 * describes the stack without describing what the stack rejects leaves the
 * model to discover it one failed build at a time, at the reader's expense.
 */
describe('what the prompt tells the model about TypeScript', () => {
  it('states the re-export rule isolatedModules enforces', () => {
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /isolatedModules/,
      'the prompt never names the setting whose rule it has to follow',
    );
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /export type \{/,
      'the rule is named but never shown, so the model has to infer the syntax',
    );
  });

  it('does not ask for a type-only import it no longer needs', () => {
    // Asking for `import type` everywhere would be cargo cult now that
    // verbatimModuleSyntax is gone: it constrains the model for no compiler
    // reason, and an instruction with no consequence teaches the model that
    // instructions here have no consequences.
    assert.doesNotMatch(PLAN_SYSTEM_PROMPT, /verbatimModuleSyntax/);
  });
});
