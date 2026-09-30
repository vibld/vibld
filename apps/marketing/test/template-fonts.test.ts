import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';

import { DESIGN_TEMPLATES } from '@vibld/ai/design-templates';

import { TEMPLATE_FONTS } from '../app/template-fonts.gen.ts';

const PUBLIC = new URL('../public', import.meta.url).pathname;

describe('the templates’ self-hosted typefaces (D104)', () => {
  it('has every family a template uses', () => {
    const missing = [
      ...new Set(
        DESIGN_TEMPLATES.flatMap((t) => t.style.typeSet.map((f) => f.family)),
      ),
    ].filter((family) => !TEMPLATE_FONTS[family]);
    assert.deepEqual(missing, [], 'run scripts/template-fonts.ts');
  });

  it('serves each file it names, with its licence beside it', () => {
    for (const [family, font] of Object.entries(TEMPLATE_FONTS)) {
      assert.ok(font.files.length > 0, family);
      for (const file of font.files) {
        assert.ok(existsSync(PUBLIC + file.file), `${family}: ${file.file}`);
        assert.ok(file.file.endsWith('.woff2'), file.file);
      }
      assert.ok(
        existsSync(PUBLIC + font.licence),
        `${family}: ${font.licence}`,
      );
      assert.ok(
        statSync(PUBLIC + font.licence).size > 200,
        `${family}: licence`,
      );
    }
  });

  it('keeps only the Latin subset, so the page stays light', () => {
    for (const font of Object.values(TEMPLATE_FONTS)) {
      for (const file of font.files) {
        assert.match(file.file, /-latin-/, file.file);
        assert.ok(statSync(PUBLIC + file.file).size < 400_000, file.file);
      }
    }
  });

  it('declares every face in one stylesheet, under its own name', () => {
    const css = readFileSync(`${PUBLIC}/fonts/templates/faces.css`, 'utf8');
    for (const family of Object.keys(TEMPLATE_FONTS)) {
      assert.ok(css.includes(`font-family:"tf-${family}"`), family);
    }
    assert.doesNotMatch(css, /googleapis|gstatic/);
  });
});

describe('their licences, as the licences page states them', () => {
  it('names a licence the file itself names, for every family', async () => {
    const { licenceFacts } = await import('../app/font-licence.ts');
    const unnamed: string[] = [];
    for (const [family, font] of Object.entries(TEMPLATE_FONTS)) {
      const text = readFileSync(PUBLIC + font.licence, 'utf8');
      const facts = licenceFacts(text);
      if (!facts.name) unnamed.push(family);
      if (facts.copyright) assert.ok(text.includes(facts.copyright), family);
    }
    assert.deepEqual(unnamed, []);
  });

  it('reads the three licences the families use', async () => {
    const { licenceFacts } = await import('../app/font-licence.ts');
    assert.deepEqual(
      licenceFacts(
        'Copyright 2019 The Lexend Project Authors (https://github.com/x)\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.',
      ),
      {
        name: 'SIL Open Font License 1.1',
        copyright:
          'Copyright 2019 The Lexend Project Authors (https://github.com/x)',
      },
    );
    assert.deepEqual(
      licenceFacts(
        '  Apache License\n  Version 2.0, January 2004\n "Licensor" shall mean the copyright owner',
      ),
      { name: 'Apache License 2.0', copyright: null },
    );
    assert.equal(
      licenceFacts('UBUNTU FONT LICENCE Version 1.0\nPREAMBLE').name,
      'Ubuntu Font Licence 1.0',
    );
  });
});
