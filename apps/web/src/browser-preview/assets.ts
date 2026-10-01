import { referencedMedia } from '@vibld/core';
import type { ProjectFile } from '@vibld/core';

import { normalizePath } from './bundle.ts';
import { rootedImports } from './css-paths.ts';
import type { PreviewAsset } from './document.ts';

/**
 * The files an in-browser preview (D125) serves besides its code: the
 * media its code references, from the owner's library, and the project's
 * public/ files, which Vite serves from the root.
 */

/** A file the page asks for, with its bytes. */
export interface LoadedAsset extends PreviewAsset {
  blob: Blob;
}

const TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  json: 'application/json',
  txt: 'text/plain',
  xml: 'application/xml',
  webmanifest: 'application/manifest+json',
  css: 'text/css',
  js: 'text/javascript',
  html: 'text/html',
};

function typeOf(path: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
  return TYPES[ext] ?? 'application/octet-stream';
}

/** What the page will ask for, from the project's files. */
export function previewAssets(files: readonly ProjectFile[]): PreviewAsset[] {
  const assets: PreviewAsset[] = referencedMedia(files).map((path) => ({
    path,
    kind: 'media',
  }));
  for (const file of files) {
    const path = normalizePath(file.path);
    if (path.startsWith('public/') && path.length > 'public/'.length) {
      assets.push({ path: path.slice('public/'.length), kind: 'public' });
    }
  }
  return assets;
}

/**
 * The project files the code names by URL, with their bytes: the bundle
 * says which (`ProjectBundle.projectAssets`), and each is served at its
 * own path, `/src/logo.svg`.
 */
export function projectAssets(
  files: readonly ProjectFile[],
  paths: readonly string[],
): LoadedAsset[] {
  const byPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  return paths.flatMap((path) => {
    const file = byPath.get(path);
    return file
      ? [
          {
            path,
            kind: 'project' as const,
            blob: new Blob(
              [
                typeOf(path) === 'text/css'
                  ? rootedImports(file.content, path)
                  : file.content,
              ],
              { type: typeOf(path) },
            ),
          },
        ]
      : [];
  });
}

type Fetch = typeof fetch;
type GetToken = () => Promise<string | null>;

/**
 * Each asset's bytes. A public file is the project's own text; a media file
 * is read from the owner's library (`GET /api/media/file`). One that cannot
 * be read is left out, so the page shows it missing, as a sandbox would
 * for a file that is not in the library.
 */
export async function loadAssets(
  files: readonly ProjectFile[],
  assets: readonly PreviewAsset[],
  fetchImpl: Fetch,
  getToken: GetToken,
): Promise<LoadedAsset[]> {
  const byPath = new Map(files.map((file) => [normalizePath(file.path), file]));
  const token = assets.some((asset) => asset.kind === 'media')
    ? await getToken().catch(() => null)
    : null;
  const loaded = await Promise.all(
    assets.map(async (asset): Promise<LoadedAsset | null> => {
      if (asset.kind === 'public') {
        const file = byPath.get(`public/${asset.path}`);
        // A stylesheet's own references (`url(./hero.png)`) are named from
        // the root, where the page serves them, since it is read from an
        // object URL.
        const content =
          file && typeOf(asset.path) === 'text/css'
            ? rootedImports(file.content, asset.path)
            : file?.content;
        return file
          ? {
              ...asset,
              blob: new Blob([content!], { type: typeOf(asset.path) }),
            }
          : null;
      }
      try {
        const response = await fetchImpl(
          `/api/media/file?path=${encodeURIComponent(asset.path)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} },
        );
        return response.ok ? { ...asset, blob: await response.blob() } : null;
      } catch {
        return null;
      }
    }),
  );
  return loaded.filter((asset): asset is LoadedAsset => asset !== null);
}
