#!/usr/bin/env node
/**
 * Fails if an em-dash has got into the repository.
 *
 * A house rule (CLAUDE.md), enforced rather than remembered: the character
 * is easy to type by accident, impossible to spot in review, and it reaches
 * users directly through the marketing site's copy and through the prompt
 * that tells generated projects how to write.
 *
 * The double hyphen this repository uses in prose is a different character
 * and is fine. Only U+2014 is rejected here; en-dashes and hyphens are not
 * this rule's business.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Built from its code point: Prettier rewrites a \u escape back to the
// character, and a literal one here would make this file fail its own check.
const EM_DASH = String.fromCharCode(0x2014);

// git ls-files rather than a directory walk: it already honours .gitignore,
// so node_modules, build output and caches never reach the check.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // unreadable or binary; nothing to check
  }
  if (!text.includes(EM_DASH)) continue;
  text.split('\n').forEach((line, index) => {
    if (line.includes(EM_DASH))
      hits.push(`${file}:${index + 1}: ${line.trim()}`);
  });
}

if (hits.length > 0) {
  console.error(
    `Found ${hits.length} em-dash${hits.length === 1 ? '' : 'es'}. Use a comma, a colon, parentheses, two sentences, or the double hyphen this repo already uses.\n`,
  );
  for (const hit of hits.slice(0, 40)) console.error(`  ${hit}`);
  if (hits.length > 40) console.error(`  ... and ${hits.length - 40} more`);
  process.exit(1);
}

console.log(`No em-dashes in ${files.length} tracked files.`);
