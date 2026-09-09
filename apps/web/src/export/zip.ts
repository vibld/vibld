/**
 * A minimal ZIP writer, so a generated project can leave Vibld.
 *
 * ADR-0002 says the output must be a conventional project that builds with
 * ordinary npm commands and needs no Vibld package, account or service. That
 * claim is only worth something if the files can actually be taken away, and
 * until now the only way to read them was one at a time in the Code tab.
 *
 * Written here rather than pulled in as a dependency: the whole format needed
 * is a few hundred bytes of header per file, it runs on untrusted model
 * output in the browser, and a library would be a third-party surface in the
 * bundle for something this small. Entries are stored, never deflated --
 * compression would add a DEFLATE implementation for a saving nobody waiting
 * on a download of a few dozen text files would notice.
 *
 * Archives are byte-for-byte deterministic: the same files always produce the
 * same bytes, which is what makes the output testable at all.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Store, not deflate. See the note above. */
const METHOD_STORE = 0;

/** Bit 11: names and comments are UTF-8. Anything else mangles a path. */
const FLAG_UTF8 = 0x0800;

/**
 * Fixed timestamp, so an archive depends only on its contents.
 *
 * 1980-01-01 00:00 is the earliest the DOS format can express, and every
 * extractor accepts it. A real clock would make two exports of the same
 * checkpoint differ, which would make this module untestable and would let a
 * download's bytes change without its content changing.
 */
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

/** Beyond these the format needs Zip64, which this deliberately does not do. */
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

export interface ZipEntry {
  path: string;
  content: string;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Little-endian writer over a growing byte array. */
class ByteWriter {
  #parts: Uint8Array[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  bytes(value: Uint8Array): void {
    this.#parts.push(value);
    this.#length += value.length;
  }

  u16(value: number): void {
    this.bytes(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.bytes(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  concat(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.#length);
    let offset = 0;
    for (const part of this.#parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

/**
 * Reject a path the archive should not carry.
 *
 * The paths come from model output. An extractor handed "../.bashrc" or
 * "/etc/passwd" can be made to write outside the directory the user chose --
 * the Zip Slip class of bug. The staged-project validator already refuses
 * these upstream; refusing them here as well means this module is safe to
 * call with any file list, not only one that has already been through it.
 */
function checkPath(path: string): void {
  if (path.length === 0) throw new ZipError('A file path cannot be empty.');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new ZipError(`Absolute path in archive: ${path}`);
  }
  if (path.includes('\\')) {
    throw new ZipError(`Backslash in archive path: ${path}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw new ZipError(`Relative segment in archive path: ${path}`);
  }
  if (segments.some((segment) => segment.length === 0)) {
    throw new ZipError(`Empty path segment: ${path}`);
  }
}

/** Build a ZIP archive. Entry order is preserved. */
export function createZip(
  entries: readonly ZipEntry[],
): Uint8Array<ArrayBuffer> {
  if (entries.length === 0) {
    throw new ZipError('An archive needs at least one file.');
  }
  if (entries.length > MAX_ENTRIES) {
    throw new ZipError(`An archive may hold at most ${MAX_ENTRIES} files.`);
  }

  const encoder = new TextEncoder();
  const seen = new Set<string>();
  const local = new ByteWriter();
  const central = new ByteWriter();

  for (const entry of entries) {
    checkPath(entry.path);
    if (seen.has(entry.path)) {
      // Two entries at one path make the extracted tree depend on the
      // extractor's tie-breaking, so the archive would not mean one thing.
      throw new ZipError(`Duplicate path in archive: ${entry.path}`);
    }
    seen.add(entry.path);

    const name = encoder.encode(entry.path);
    const content = encoder.encode(entry.content);
    if (content.length > MAX_BYTES) {
      throw new ZipError(`File is too large to store: ${entry.path}`);
    }

    const crc = crc32(content);
    const offset = local.length;
    if (offset > MAX_BYTES) {
      throw new ZipError('Archive is too large without Zip64.');
    }

    local.u32(LOCAL_HEADER);
    local.u16(20); // version needed: 2.0
    local.u16(FLAG_UTF8);
    local.u16(METHOD_STORE);
    local.u16(DOS_TIME);
    local.u16(DOS_DATE);
    local.u32(crc);
    local.u32(content.length); // compressed
    local.u32(content.length); // uncompressed
    local.u16(name.length);
    local.u16(0); // extra field length
    local.bytes(name);
    local.bytes(content);

    central.u32(CENTRAL_HEADER);
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(FLAG_UTF8);
    central.u16(METHOD_STORE);
    central.u16(DOS_TIME);
    central.u16(DOS_DATE);
    central.u32(crc);
    central.u32(content.length);
    central.u32(content.length);
    central.u16(name.length);
    central.u16(0); // extra field length
    central.u16(0); // comment length
    central.u16(0); // disk number
    central.u16(0); // internal attributes
    // External attributes: regular file, 0644, in the high 16 bits where
    // Unix extractors look. Without it some tools restore a file with no
    // permission bits at all.
    central.u32((0o100644 << 16) >>> 0);
    central.u32(offset);
    central.bytes(name);
  }

  const out = new ByteWriter();
  out.bytes(local.concat());
  const centralOffset = out.length;
  const centralBytes = central.concat();
  out.bytes(centralBytes);

  out.u32(END_OF_CENTRAL_DIRECTORY);
  out.u16(0); // this disk
  out.u16(0); // disk with the central directory
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(centralBytes.length);
  out.u32(centralOffset);
  out.u16(0); // comment length

  return out.concat();
}

/**
 * A filename for the download.
 *
 * Built from the revision rather than the prompt: a prompt is user text, and
 * putting it in a filename means quoting rules for every operating system the
 * download might land on. The revision is short, unique and already shown.
 */
export function archiveName(revision: string): string {
  // Letters, digits, dash and underscore only -- no dots. A revision never
  // needs one, and allowing them lets "../../etc/passwd" survive as
  // "....etcpasswd", which is not a traversal but is a filename no one should
  // have to reason about.
  const safe = revision.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return `vibld-${safe.length > 0 ? safe : 'project'}.zip`;
}
