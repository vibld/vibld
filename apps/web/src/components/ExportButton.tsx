import { useState } from 'react';
import type { ProjectSnapshot } from '@vibld/core';
import { ZipError, archiveName, createZip } from '../export/zip.ts';

/**
 * Take the project away.
 *
 * ADR-0002's promise -- a conventional project that builds with ordinary npm
 * commands and needs no Vibld package, account or service -- is only worth
 * something if the files can actually leave. Until this, the only way to read
 * them was one at a time in the Code tab.
 *
 * Offered for an accepted checkpoint only. Staged files have not been
 * validated yet, and handing someone a download of a project that was about
 * to be rejected would be worse than offering nothing.
 */
export function ExportButton({ snapshot }: { snapshot: ProjectSnapshot }) {
  const [problem, setProblem] = useState<string | null>(null);

  function download() {
    setProblem(null);
    let url: string | null = null;
    try {
      const blob = new Blob([createZip(snapshot.files)], {
        type: 'application/zip',
      });
      url = URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = archiveName(snapshot.revision);
      link.click();
    } catch (error) {
      setProblem(
        error instanceof ZipError
          ? error.message
          : 'The project could not be packaged for download.',
      );
    } finally {
      // Revoking in the same tick can cancel the download in some browsers,
      // so the handle is released once the click has been dispatched.
      if (url !== null) {
        const handle = url;
        setTimeout(() => URL.revokeObjectURL(handle), 0);
      }
    }
  }

  return (
    <>
      <button type="button" className="chip" onClick={download}>
        Download .zip
      </button>
      {problem ? (
        <p className="pane-note pane-note--error" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}
