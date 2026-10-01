import { useEffect, useRef, useState } from 'react';
import type { ProjectFile } from '@vibld/core';

import { getClerkToken } from '../auth/clerk-token.ts';
import {
  loadAssets,
  previewAssets,
  projectAssets,
} from '../browser-preview/assets.ts';
import type { LoadedAsset } from '../browser-preview/assets.ts';
import { previewDocument } from '../browser-preview/document.ts';
import type {
  BundleReply,
  BundleRequest,
} from '../browser-preview/protocol.ts';
import type { PreviewStatus } from './preview-client.ts';
import type { PreviewSandbox } from './use-preview-sandbox.ts';

/**
 * The preview as the viewer's own browser runs it (D125), for a deployment
 * with no sandbox containers: Cloudflare's free plan, where nothing can run
 * npm or Vite.
 *
 * The same shape as `usePreviewSandbox`, so `Workspace` and `PreviewPanel`
 * drive either one: run, update in place, stop. A run bundles the files in
 * a Web Worker (`browser-preview/bundle-worker.ts`) and builds the page
 * the panel shows in a sandboxed iframe; an update is a run that keeps the
 * page up until the next one is ready. There is nothing to share or to
 * expire: the page exists only in this tab.
 */

/** The page a ready in-browser preview shows, and the files it asks for. */
export interface BrowserPreviewPage {
  document: string;
  assets: LoadedAsset[];
  /** Changes with every page, so the frame is rebuilt rather than reused. */
  key: number;
}

/** The status a ready in-browser preview reports, for code that reads `status`. */
function readyStatus(revision: string): PreviewStatus {
  return { status: 'ready', url: 'about:srcdoc', expiresAt: 0, revision };
}

export function useBrowserPreview(): PreviewSandbox {
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [page, setPage] = useState<BrowserPreviewPage | null>(null);
  const [ranRevision, setRanRevision] = useState<string | null>(null);
  const [ranProjectId, setRanProjectId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  /** The run in charge: a later run, an update or a stop supersedes it. */
  const token = useRef(0);
  const replies = useRef(new Map<number, (reply: BundleReply) => void>());

  useEffect(
    () => () => {
      token.current += 1;
      worker.current?.terminate();
      worker.current = null;
      for (const resolve of replies.current.values()) {
        resolve({ ok: false, error: 'The preview was closed.' });
      }
      replies.current.clear();
    },
    [],
  );

  function bundler(): Worker {
    if (!worker.current) {
      const created = new Worker(
        new URL('../browser-preview/bundle-worker.ts', import.meta.url),
        { type: 'module' },
      );
      created.addEventListener(
        'message',
        (event: MessageEvent<BundleReply & { id: number }>) => {
          const { id, ...reply } = event.data;
          replies.current.get(id)?.(reply as BundleReply);
          replies.current.delete(id);
        },
      );
      created.addEventListener('error', (event) => {
        event.preventDefault();
        for (const resolve of replies.current.values()) {
          resolve({
            ok: false,
            error: 'The bundler stopped working in this browser.',
          });
        }
        replies.current.clear();
        worker.current?.terminate();
        worker.current = null;
      });
      worker.current = created;
    }
    return worker.current;
  }

  function bundle(id: number, files: ProjectFile[]): Promise<BundleReply> {
    return new Promise((resolve) => {
      replies.current.set(id, resolve);
      const request: BundleRequest = { id, files };
      bundler().postMessage(request);
    });
  }

  async function build(
    files: ProjectFile[],
    revision: string,
    projectId: string | null,
    inPlace: boolean,
  ) {
    const mine = ++token.current;
    setPending(true);
    setUpdateNote(null);
    if (inPlace) setUpdating(true);
    else {
      setStatus({ status: 'starting' });
      setPage(null);
    }
    const [reply, assets] = await Promise.all([
      bundle(mine, files),
      loadAssets(
        files,
        previewAssets(files),
        globalThis.fetch.bind(globalThis),
        getClerkToken,
      ),
    ]);
    if (mine !== token.current) return;
    setPending(false);
    setUpdating(false);
    if (!reply.ok) {
      // A change that does not bundle leaves the page that was showing,
      // and says why; a first run has nothing to leave.
      if (inPlace) {
        setUpdateNote(`This change did not bundle: ${reply.error}`);
        // Tried, so not tried again on its own: the next revision is.
        setRanRevision(revision);
      } else {
        setStatus({ status: 'failed', error: reply.error });
      }
      return;
    }
    const served = [
      ...assets,
      ...projectAssets(files, reply.bundle.projectAssets),
    ];
    setPage({
      document: previewDocument({
        indexHtml: reply.bundle.indexHtml,
        importMap: reply.bundle.importMap,
        js: reply.bundle.js,
        css: reply.css,
        assets: served.map(({ path, kind }) => ({ path, kind })),
        workers: reply.bundle.workers,
      }),
      assets: served,
      key: mine,
    });
    setStatus(readyStatus(revision));
    setRanRevision(revision);
    setRanProjectId(projectId);
  }

  function stop() {
    token.current += 1;
    setStatus(null);
    setPage(null);
    setPending(false);
    setUpdating(false);
    setUpdateNote(null);
    setRanRevision(null);
    setRanProjectId(null);
  }

  return {
    mode: 'browser',
    page,
    status,
    ranRevision,
    ranProjectId,
    pending,
    run: (files, revision, projectId = null) =>
      void build(files, revision, projectId, false),
    update: (files, revision, projectId = null) =>
      void build(files, revision, projectId, true),
    updating,
    updateNote,
    stop,
    stopError: null,
    shares: [],
    sharePending: false,
    shareError: null,
    share: () => undefined,
    revokeShare: () => undefined,
  };
}
