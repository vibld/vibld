/**
 * Every design in the template catalog by name, and no more: its id, name,
 * one-line summary, kind, use case, format, batch and where it is merged. For code that runs on every page and
 * must not carry the catalog itself (`design-templates.ts` is 6.5 MB).
 * Generated beside it by `bin/import-design-catalog.ts`.
 */
import index from '../data/design-template-index.ts';
import type { DesignFormat, DesignUseCase } from './design-templates.ts';

export interface DesignTemplateName {
  id: string;
  name: string;
  summary: string;
  kind: 'site' | 'app';
  useCase: DesignUseCase;
  format: DesignFormat;
  batch: string;
  addedOn: string;
  /**
   * Where it is shown instead of on its own: one of vibld's examples (D85)
   * or another design (D107).
   */
  mergedInto?: { collection: 'examples' | 'templates'; slug: string };
}

export const DESIGN_TEMPLATE_INDEX: readonly DesignTemplateName[] =
  index as unknown as DesignTemplateName[];
