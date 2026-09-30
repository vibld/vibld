/** Types for scripts/us-english.mjs, for the TypeScript that imports it. */
export const INCLUDE: RegExp[];
export const EXCLUDE: RegExp[];
export const MAP: Record<string, string>;
export const PROPER_NOUNS: string[];
export function toUsEnglish(text: string): string;
export function ukWords(text: string): string[];
export function readableRanges(
  source: string,
  file: string,
): [number, number][];
export function convert(source: string, file: string): string;
export function findings(
  source: string,
  file: string,
): { line: number; word: string; us: string }[];
