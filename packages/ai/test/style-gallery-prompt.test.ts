import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { STYLE_GALLERY_FILE } from '../bin/import-style-gallery.ts';
import { BoundedBuilder } from '../src/bounded-build.ts';
import { paletteGuidance } from '../src/palettes.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';
import {
  parseStyleGallery,
  styleGalleryCss,
  styleGalleryFontUtility,
  styleGalleryGuidance,
} from '../src/style-gallery.ts';
import { styleDirection } from '../src/style-presets.ts';

/**
 * Generating in a gallery style (D146): the model is sent the gallery's
 * baseline rules, then the style's build prompt, and told about the tokens
 * file it already has.
 */

const stored = existsSync(STYLE_GALLERY_FILE);
const catalog = stored
  ? parseStyleGallery(readFileSync(STYLE_GALLERY_FILE, 'utf8'))
  : null;

describe('the guidance for a gallery style', { skip: !stored }, () => {
  const entry = catalog!.entries.find((e) => e.id === 'amberbrae')!;
  const guidance = styleGalleryGuidance(
    catalog!.baseline_rules_markdown,
    entry,
  );

  it('sends the baseline rules, then the build prompt, whole', () => {
    const baseline = guidance.indexOf(catalog!.baseline_rules_markdown.trim());
    const prompt = guidance.indexOf(entry.build_prompt.trim());
    assert.ok(baseline > 0, 'the baseline is missing');
    assert.ok(prompt > baseline, 'the build prompt does not follow it');
  });

  it('names only utilities the tokens file declares', () => {
    const css = styleGalleryCss(entry.design_tokens);
    const listed = (label: string) =>
      new RegExp(`^- ${label}[^:]*: (.*)$`, 'm')
        .exec(guidance)![1]!
        .split(', ');
    for (const color of listed('colors')) {
      assert.match(css, new RegExp(`--color-${color}: `), color);
    }
    for (const listing of listed('type steps')) {
      const [step, font] = listing.split(' in ');
      assert.match(css, new RegExp(`--${step}: `), step);
      assert.match(css, new RegExp(`--${font}: `), font);
    }
    for (const font of listed('fonts')) {
      assert.match(css, new RegExp(`--${font}: `), font);
    }
    for (const corner of listed('corners')) {
      assert.match(css, new RegExp(`--radius-${corner.slice(8)}: `), corner);
    }
  });

  it('keeps decorative colors from behind text', () => {
    assert.match(
      guidance,
      /Decorative colors never sit behind text, at any size: supporting-accent\./,
    );
  });

  it('sets a step in a family only it uses through its own utility', () => {
    const amberford = catalog!.entries.find((e) => e.id === 'amberford')!;
    const css = styleGalleryCss(amberford.design_tokens);
    const said = styleGalleryGuidance('', amberford);
    for (const step of amberford.design_tokens.type_scale) {
      const utility = styleGalleryFontUtility(
        amberford.design_tokens,
        step.font,
      );
      assert.match(css, new RegExp(`--${utility}: '${step.font}';`));
      assert.ok(
        said.includes(`${step.token.slice(2)} in ${utility}`),
        `${step.token} in ${utility}`,
      );
    }
    assert.match(css, /--font-archivo-black: 'Archivo Black';/);
  });

  it('has a guidance for every style', () => {
    for (const each of catalog!.entries) {
      assert.ok(
        styleGalleryGuidance(catalog!.baseline_rules_markdown, each).includes(
          each.build_prompt.trim(),
        ),
        each.id,
      );
    }
  });
});

describe('a build prompt in a gallery style', () => {
  const ask = 'A SaaS dashboard for a fintech startup';
  const gallery = 'GALLERY GUIDANCE';

  it('replaces the color, preference and preset guidance, and comes last', () => {
    assert.ok(paletteGuidance(ask), 'the request should have a palette');
    const prompt = buildUserPrompt(
      { prompt: ask },
      'brutalism',
      null,
      null,
      { corners: 'sharp' },
      null,
      null,
      null,
      gallery,
    );
    assert.ok(prompt.startsWith(ask));
    assert.ok(prompt.endsWith(gallery));
    assert.ok(!prompt.includes(paletteGuidance(ask)!));
    assert.ok(!prompt.includes(styleDirection('brutalism')!));
  });

  it('is in every call a bounded build makes', () => {
    const builder = new BoundedBuilder({ id: 'test' } as never, {
      galleryGuidance: gallery,
    });
    assert.ok(builder.requestContext(ask).endsWith(gallery));
  });
});
