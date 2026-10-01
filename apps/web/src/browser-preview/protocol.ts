import type { ProjectFile } from '@vibld/core';

import type { ProjectBundle } from './bundle.ts';

/** What the builder asks the bundler worker (`bundle-worker.ts`). */
export interface BundleRequest {
  id: number;
  files: ProjectFile[];
}

/** What the bundler worker answers. */
export type BundleReply =
  | { ok: true; bundle: ProjectBundle; css: string }
  | { ok: false; error: string };
