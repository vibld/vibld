/**
 * Every design in the template catalog by name, and no more: its id, name,
 * one-line summary, kind and use case. For code that runs on every page and
 * must not carry the catalog itself (`design-templates.ts` is 2.6 MB).
 * Generated beside it by `bin/import-design-catalog.ts`.
 */
import index from '../data/design-template-index.ts';
import type { DesignUseCase } from './design-templates.ts';

export interface DesignTemplateName {
  id: string;
  name: string;
  summary: string;
  kind: 'site' | 'app';
  useCase: DesignUseCase;
  /** The example slug, when this design is shown on one of vibld's examples. */
  mergedInto?: string;
}

export const DESIGN_TEMPLATE_INDEX: readonly DesignTemplateName[] =
  index as unknown as DesignTemplateName[];
