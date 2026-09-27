import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { ZipError, archiveName, createZip, crc32 } from '../src/export/zip.ts';

const FILES = [
  { path: 'package.json', content: '{\n  "name": "demo"\n}\n' },
  {
    path: 'src/App.tsx',
    content: 'export function App() {\n  return null;\n}\n',
  },
  { path: 'src/styles.css', content: ':root {\n  --navy: #0b1b3a;\n}\n' },
];

/** Read the central directory back, independently of how it was written. */
function readCentralDirectory(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end-of-central-directory record is last, and has no comment here.
  const eocd = zip.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, 'EOCD signature');
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  assert.equal(offset + size, eocd, 'the central directory must end at EOCD');

  const decoder = new TextDecoder();
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(view.getUint32(offset, true), 0x02014b50, 'central signature');
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entry = {
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      crc: view.getUint32(offset + 16, true),
      compressedSize: view.getUint32(offset + 20, true),
      size: view.getUint32(offset + 24, true),
      externalAttributes: view.getUint32(offset + 38, true),
      localOffset: view.getUint32(offset + 42, true),
      path: decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength)),
    };
    entries.push(entry);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Pull one entry's bytes out via its local header. */
function readStored(zip: Uint8Array, localOffset: number): string {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(
    view.getUint32(localOffset, true),
    0x04034b50,
    'local signature',
  );
  const size = view.getUint32(localOffset + 18, true);
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  return new TextDecoder().decode(zip.subarray(start, start + size));
}

describe('crc32', () => {
  it('agrees with the platform implementation', () => {
    // Node's zlib.crc32 is an independent implementation, so this checks the
    // table above rather than checking it against itself.
    for (const sample of [
      '',
      'a',
      'hello world',
      FILES[1]!.content,
      '✓ ünïcode',
    ]) {
      const bytes = new TextEncoder().encode(sample);
      assert.equal(crc32(bytes), nodeCrc32(Buffer.from(bytes)), sample);
    }
  });
});

describe('createZip', () => {
  const zip = createZip(FILES);

  it('records every file in the central directory, in order', () => {
    const entries = readCentralDirectory(zip);
    assert.deepEqual(
      entries.map((entry) => entry.path),
      FILES.map((file) => file.path),
    );
  });

  it('round-trips the contents through the local headers', () => {
    for (const entry of readCentralDirectory(zip)) {
      const expected = FILES.find((file) => file.path === entry.path)!.content;
      assert.equal(readStored(zip, entry.localOffset), expected);
    }
  });

  it('stores rather than deflates, and says the names are UTF-8', () => {
    for (const entry of readCentralDirectory(zip)) {
      assert.equal(entry.method, 0, 'stored');
      assert.equal(entry.compressedSize, entry.size);
      assert.equal(entry.flags & 0x0800, 0x0800, 'UTF-8 name flag');
    }
  });

  it('carries the checksum an extractor will verify', () => {
    for (const entry of readCentralDirectory(zip)) {
      const content = FILES.find((file) => file.path === entry.path)!.content;
      assert.equal(entry.crc, nodeCrc32(Buffer.from(content, 'utf8')));
    }
  });

  it('restores a readable regular file on Unix', () => {
    for (const entry of readCentralDirectory(zip)) {
      assert.equal(entry.externalAttributes >>> 16, 0o100644);
    }
  });

  it('is byte-for-byte deterministic', () => {
    // Same checkpoint, same bytes. Without a fixed timestamp two exports of
    // one project would differ, and none of the above could be asserted.
    assert.deepEqual(createZip(FILES), createZip(FILES));
  });

  it('handles non-ASCII paths and contents', () => {
    const archive = createZip([
      { path: 'src/café.tsx', content: 'const x = "✓";' },
    ]);
    const [entry] = readCentralDirectory(archive);
    assert.equal(entry!.path, 'src/café.tsx');
    assert.equal(readStored(archive, entry!.localOffset), 'const x = "✓";');
    assert.equal(
      entry!.size,
      new TextEncoder().encode('const x = "✓";').length,
      'sizes are byte counts, not character counts',
    );
  });

  it('stores an empty file without corrupting the archive', () => {
    const archive = createZip([
      { path: 'a.txt', content: '' },
      { path: 'b.txt', content: 'x' },
    ]);
    const entries = readCentralDirectory(archive);
    assert.equal(entries[0]!.size, 0);
    assert.equal(readStored(archive, entries[1]!.localOffset), 'x');
  });
});

describe('paths the archive refuses', () => {
  it('refuses anything that could write outside the extraction directory', () => {
    // Zip Slip. The staged-project validator rejects these upstream, but this
    // module runs on model output and must be safe called on its own.
    for (const path of [
      '../.bashrc',
      'src/../../etc/passwd',
      '/etc/passwd',
      'C:/Windows/system32',
      './hidden',
      'src\\App.tsx',
      'src//App.tsx',
      '',
    ]) {
      assert.throws(
        () => createZip([{ path, content: 'x' }]),
        ZipError,
        `accepted ${JSON.stringify(path)}`,
      );
    }
  });

  it('refuses two entries at the same path', () => {
    // Otherwise the extracted tree depends on the extractor's tie-breaking,
    // and the archive does not mean one thing.
    assert.throws(
      () =>
        createZip([
          { path: 'a.txt', content: 'first' },
          { path: 'a.txt', content: 'second' },
        ]),
      /Duplicate path/,
    );
  });

  it('refuses an empty archive', () => {
    assert.throws(() => createZip([]), /at least one file/);
  });
});

describe('archiveName', () => {
  it('names the download after the revision', () => {
    assert.equal(archiveName('r0a1b2c3'), 'vibld-r0a1b2c3.zip');
  });

  it('never lets a revision become a path or a shell surprise', () => {
    assert.equal(archiveName('../../etc/passwd'), 'vibld-etcpasswd.zip');
    assert.equal(archiveName('a b;rm -rf /'), 'vibld-abrm-rf.zip');
    assert.equal(archiveName(''), 'vibld-project.zip');
    assert.equal(archiveName('✓✓✓'), 'vibld-project.zip');
  });
});
