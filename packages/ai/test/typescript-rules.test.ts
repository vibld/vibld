import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLAN_SYSTEM_PROMPT } from '../src/plan-schema.ts';

/**
 * The two TypeScript rules a generated project cannot be written without.
 *
 * A real generation produced a project that failed `npm run build`; a second
 * run from the identical prompt built cleanly, so the difference was in what
 * the model happened to write. Reproduced without a model against the
 * scaffold's own tsconfig, two settings reject ordinary React:
 *
 *   TS1484  import { ReactNode } from 'react'        (verbatimModuleSyntax)
 *   TS1205  export { CardProps } from './Card.tsx'   (isolatedModules)
 *
 * The first attempt at a fix turned `verbatimModuleSyntax` off in
 * `plan-builder.ts` and told the model an ordinary type import was fine.
 * That was the wrong place (#193 review). `buildProjectFiles` feeds
 * `FakeModelProvider`; in production `RemoteModelProvider` returns the
 * model's own files, tsconfig included, and nothing on that path rewrites
 * them. So loosening our scaffold changed nothing a reader ever sees, while
 * the prompt line actively encouraged the import that fails under the
 * tsconfig `npm create vite@latest` writes.
 *
 * Both rules are therefore the prompt's to carry, and the prompt is the only
 * channel that reaches the files a reader is given. Code written to both
 * compiles under either setting, which is the point: the model picks the
 * tsconfig, so the code has to survive the pick.
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

  it('states the import rule verbatimModuleSyntax enforces', () => {
    // Not cargo cult, which is what the previous round of this test called
    // it: the model writes the tsconfig, and the conventional Vite one turns
    // this on, so an ordinary type import is a build failure the reader
    // inherits. The rule has a compiler reason on the path that ships.
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /verbatimModuleSyntax/,
      'the prompt never names the setting that rejects `import { ReactNode }`',
    );
    assert.match(
      PLAN_SYSTEM_PROMPT,
      /import type \{/,
      'the rule is named but never shown, so the model has to infer the syntax',
    );
  });
});
