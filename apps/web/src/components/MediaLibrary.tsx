import { useEffect, useId, useState } from 'react';
import {
  MEDIA_ACCEPT,
  extractPoster,
  fetchMedia,
  formatBytes,
  removeMedia,
  uploadMedia,
} from '../generation/media-client.ts';
import type { MediaLibraryState } from '../generation/media-client.ts';

/**
 * The images and video a generated page can use.
 *
 * Everything here is used by the next build without being asked: the build
 * is told what exists and at which path, and the design checks refuse a
 * page that references anything else. Alt text is asked for at upload
 * because it is what the page will say about the image to someone who
 * cannot see it, and the build uses it as given.
 *
 * A video gets a poster frame taken in this browser, so the page has a
 * still to show before the video loads and in its place for anyone who
 * asked their system to reduce motion.
 */
export function MediaLibrary({ disabled }: { disabled: boolean }) {
  const [library, setLibrary] = useState<MediaLibraryState | null | 'loading'>(
    'loading',
  );
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileId = useId();
  const altId = useId();

  const refresh = () =>
    fetchMedia().then((result) => {
      setLibrary(result);
    });

  useEffect(() => {
    void refresh();
  }, []);

  if (library === 'loading') return null;

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    const uploaded = await uploadMedia(file, { name: file.name, alt });
    if (!uploaded.ok) {
      setMessage(uploaded.error);
      setBusy(false);
      return;
    }
    let note = `Added /${uploaded.item.path}.`;
    if (uploaded.item.kind === 'video') {
      const still = await extractPoster(file);
      const poster = still
        ? await uploadMedia(still, {
            name: `${file.name.replace(/\.[^.]*$/, '')}-poster.jpg`,
            alt,
            posterFor: uploaded.item.id,
          })
        : null;
      note = poster?.ok
        ? `Added /${uploaded.item.path} with a poster frame.`
        : `Added /${uploaded.item.path}. A poster frame could not be taken from it in this browser.`;
    }
    setMessage(note);
    setFile(null);
    setAlt('');
    setBusy(false);
    await refresh();
  };

  const remove = async (id: string, path: string) => {
    setBusy(true);
    const removed = await removeMedia(id);
    setMessage(
      removed ? `Removed /${path}.` : `/${path} could not be removed.`,
    );
    setBusy(false);
    await refresh();
  };

  const blocked = disabled || busy;

  return (
    <fieldset className="media" disabled={blocked}>
      <legend className="prompt__label">Images and video (optional)</legend>
      {library === null ? (
        <p className="pane-note">
          Your media library is unavailable right now.
        </p>
      ) : (
        <>
          {library.media.length > 0 ? (
            <ul className="media__list">
              {library.media.map((item) => (
                <li key={item.id} className="media__item">
                  <code className="media__path">/{item.path}</code>
                  <span className="media__meta">
                    {item.kind}, {formatBytes(item.bytes)}
                    {item.posterPath ? ', with poster' : ''}
                  </span>
                  {item.alt ? (
                    <span className="media__alt">{item.alt}</span>
                  ) : null}
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => void remove(item.id, item.path)}
                    aria-label={`Remove /${item.path}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="pane-note">
            {library.usage.files} of {library.usage.maxFiles} files,{' '}
            {formatBytes(library.usage.bytes)} of{' '}
            {formatBytes(library.usage.maxBytes)}. The next build can use
            anything here.
          </p>
          <label className="prompt__label" htmlFor={fileId}>
            File
          </label>
          <input
            id={fileId}
            type="file"
            accept={MEDIA_ACCEPT}
            className="prompt__input"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <label className="prompt__label" htmlFor={altId}>
            What it shows (alt text)
          </label>
          <input
            id={altId}
            type="text"
            className="prompt__input"
            maxLength={300}
            value={alt}
            placeholder="Waves breaking at dusk, seen from the pier"
            onChange={(event) => setAlt(event.target.value)}
          />
          <button
            type="button"
            className="button"
            onClick={() => void upload()}
            disabled={blocked || file === null}
          >
            {busy ? 'Uploading…' : 'Add to library'}
          </button>
        </>
      )}
      {message ? (
        <p className="pane-note" role="status">
          {message}
        </p>
      ) : null}
    </fieldset>
  );
}
