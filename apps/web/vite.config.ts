import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

import { writeStyleGalleryAssets } from './scripts/style-gallery-assets.ts';

/**
 * Writes the style gallery's files into the build output for the Worker to
 * read (D142, D144). After the bundle, so they are never part of it.
 */
function styleGallery(): Plugin {
  let outDir = 'dist';
  return {
    name: 'vibld-style-gallery',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const count = writeStyleGalleryAssets(outDir);
      this.info?.(`style gallery: ${count} styles`);
    },
  };
}

export default defineConfig({
  plugins: [react(), styleGallery()],
  server: {
    port: 5173,
  },
});
