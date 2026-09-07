import type { ProjectFile } from '@vibld/core';

export function CodeViewer({ file }: { file: ProjectFile | null }) {
  if (!file) {
    return <p className="empty">Select a file to view its contents.</p>;
  }

  return (
    <figure className="code">
      <figcaption className="code__caption">{file.path}</figcaption>
      <pre
        className="code__body"
        tabIndex={0}
        aria-label={`Contents of ${file.path}`}
      >
        <code>{file.content}</code>
      </pre>
    </figure>
  );
}
