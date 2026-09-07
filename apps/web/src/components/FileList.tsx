import type { ProjectFile } from '@vibld/core';

export interface FileListProps {
  files: ProjectFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function FileList({ files, selectedPath, onSelect }: FileListProps) {
  if (files.length === 0) {
    return <p className="empty">No files generated yet.</p>;
  }

  return (
    <ul className="filelist" aria-label="Generated files">
      {files.map((file) => {
        const selected = file.path === selectedPath;
        return (
          <li key={file.path}>
            <button
              type="button"
              className={`filelist__item${selected ? ' filelist__item--selected' : ''}`}
              aria-current={selected ? 'true' : undefined}
              onClick={() => onSelect(file.path)}
            >
              <span className="filelist__path">{file.path}</span>
              <span className="filelist__size">
                {file.content.split('\n').length} lines
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
