/**
 * What a font's licence file says about itself, read from the file rather
 * than assumed (the licences page states these as facts; Chris decides
 * what they allow). Imports nothing.
 */
export interface LicenceFacts {
  /** The licence the file names, or null when it names none this knows. */
  name: string | null;
  /** The file's first copyright line, exactly, or null when it has none. */
  copyright: string | null;
}

const NAMES: [RegExp, string][] = [
  [/SIL OPEN FONT LICEN[CS]E,? Version 1\.1/i, 'SIL Open Font License 1.1'],
  [/Apache License\s+Version 2\.0/i, 'Apache License 2.0'],
  [/UBUNTU FONT LICEN[CS]E Version 1\.0/i, 'Ubuntu Font Licence 1.0'],
];

export function licenceFacts(text: string): LicenceFacts {
  const name = NAMES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        /^Copyright\b/.test(l) && !/^Copyright (notice|owner|holder)/i.test(l),
    );
  return { name, copyright: line ? line.replace(/\.$/, '') : null };
}
