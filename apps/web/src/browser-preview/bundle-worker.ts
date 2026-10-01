/// <reference lib="webworker" />
import * as esbuild from 'esbuild-wasm';
import wasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import tailwindIndex from 'tailwindcss/index.css?raw';
import tailwindPreflight from 'tailwindcss/preflight.css?raw';
import tailwindTheme from 'tailwindcss/theme.css?raw';
import tailwindUtilities from 'tailwindcss/utilities.css?raw';
import twAnimate from '../../node_modules/tw-animate-css/dist/tw-animate.css?raw';
import type { ProjectFile } from '@vibld/core';

import { BundleError, bundleProject } from './bundle.ts';
import { declaredRanges } from './import-map.ts';
import { compileStyles, StylesError } from './styles.ts';
import type { BundleReply, BundleRequest } from './protocol.ts';

/**
 * The in-browser preview's bundler (D125), off the page's main thread:
 * esbuild-wasm for the code and Tailwind's compiler for the styles. The
 * project's code is only read and transformed here, never run; it runs in
 * the preview's sandboxed iframe.
 */

const BUILTIN_STYLESHEETS = {
  tailwindcss: tailwindIndex,
  'tailwindcss/index.css': tailwindIndex,
  'tailwindcss/preflight': tailwindPreflight,
  'tailwindcss/preflight.css': tailwindPreflight,
  'tailwindcss/theme': tailwindTheme,
  'tailwindcss/theme.css': tailwindTheme,
  'tailwindcss/utilities': tailwindUtilities,
  'tailwindcss/utilities.css': tailwindUtilities,
  'tw-animate-css': twAnimate,
};

let ready: Promise<void> | null = null;

function initialize(): Promise<void> {
  ready ??= esbuild.initialize({ wasmURL: wasmUrl, worker: false });
  // A failed start is not kept: the next request tries again.
  ready.catch(() => {
    ready = null;
  });
  return ready;
}

async function fetchText(url: string): Promise<{ text: string; url: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return { text: await response.text(), url: response.url || url };
}

async function handle(files: ProjectFile[]): Promise<BundleReply> {
  try {
    await initialize();
  } catch (error) {
    return {
      ok: false,
      error: `The bundler did not start in this browser: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  try {
    const bundle = await bundleProject(esbuild, files);
    const projectAssets = new Set(bundle.projectAssets);
    const css = await compileStyles({
      stylesheets: bundle.stylesheets,
      files,
      builtin: BUILTIN_STYLESHEETS,
      ranges: declaredRanges(
        files.find((file) => file.path === 'package.json')?.content,
      ),
      fetchText,
      assets: projectAssets,
    });
    return {
      ok: true,
      bundle: { ...bundle, projectAssets: [...projectAssets] },
      css,
    };
  } catch (error) {
    if (error instanceof BundleError || error instanceof StylesError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: `The project could not be bundled: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.addEventListener('message', (event: MessageEvent<BundleRequest>) => {
  const { id, files } = event.data;
  void handle(files).then((reply) => scope.postMessage({ id, ...reply }));
});
