import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INSPIRATION_LIMIT,
  catalogInspirationGuidance,
  contentWords,
  inspirationOf,
  matchCatalogDesigns,
} from '../src/catalog-inspiration.ts';
import { DESIGN_TEMPLATE_INDEX } from '../src/design-template-index.ts';
import { designBrief, findDesignTemplate } from '../src/design-templates.ts';
import { buildUserPrompt } from '../src/plan-provider.ts';

/**
 * The catalog as art direction for a typed request (2026-10-09
 * design-quality review, internal issue 4): a wedding site asked for in words was offered
 * none of the catalog's eight wedding designs.
 */

const WEDDING =
  'A wedding website for Chris and Jordan, getting married June 12, 2027 at a mountain estate in Asheville, NC. Our story, the weekend schedule, travel and hotels, RSVP form, registry links and an FAQ.';

const directionsFor = (prompt: string) =>
  matchCatalogDesigns(prompt, DESIGN_TEMPLATE_INDEX).map((id) =>
    inspirationOf(findDesignTemplate(id)!),
  );

describe('matching a request to the catalog', () => {
  it('offers wedding sites for a wedding site, not photographers', () => {
    const ids = matchCatalogDesigns(WEDDING, DESIGN_TEMPLATE_INDEX);
    assert.equal(ids.length, INSPIRATION_LIMIT);
    for (const id of ids) {
      const design = findDesignTemplate(id)!;
      assert.match(design.summary, /wedding/i, id);
      assert.equal(design.useCase, 'events', id);
    }
  });

  it('gives the same request the same designs, and another request others', () => {
    assert.deepEqual(
      matchCatalogDesigns(WEDDING, DESIGN_TEMPLATE_INDEX),
      matchCatalogDesigns(WEDDING, DESIGN_TEMPLATE_INDEX),
    );
    const seen = new Set<string>();
    for (const names of ['Sam and Alex', 'Priya and Dev', 'Mara and Theo']) {
      for (const id of matchCatalogDesigns(
        `A wedding website for ${names}`,
        DESIGN_TEMPLATE_INDEX,
      )) {
        seen.add(id);
      }
    }
    assert.ok(seen.size > INSPIRATION_LIMIT, [...seen].join(', '));
  });

  it('offers nothing for a request with no subject in it', () => {
    assert.deepEqual(matchCatalogDesigns('hello', DESIGN_TEMPLATE_INDEX), []);
  });

  it('offers nothing for a page form with no subject', () => {
    for (const prompt of [
      'A landing page',
      'A dashboard',
      'A modern, minimal landing page with a dark hero',
      'A small website',
      'A tool landing page',
      'A product',
    ]) {
      assert.deepEqual(
        matchCatalogDesigns(prompt, DESIGN_TEMPLATE_INDEX),
        [],
        prompt,
      );
    }
  });

  it('still counts the page form once the request names a subject', () => {
    const ids = matchCatalogDesigns(
      'A landing page for a wedding photographer',
      DESIGN_TEMPLATE_INDEX,
    );
    assert.equal(ids.length, INSPIRATION_LIMIT);
    for (const id of ids) {
      assert.match(findDesignTemplate(id)!.summary, /wedding|photograph/i, id);
    }
  });

  it('keeps short subjects and splits hyphenated labels', () => {
    assert.deepEqual(
      [...contentWords('An AI landing page for a small-business CRM')],
      ['ai', 'landing', 'small', 'business', 'crm'],
    );
    const ids = matchCatalogDesigns(
      'An AI landing page',
      DESIGN_TEMPLATE_INDEX,
    );
    assert.equal(ids.length, INSPIRATION_LIMIT);
    for (const id of ids) {
      const design = findDesignTemplate(id)!;
      assert.match(
        `${design.summary} ${design.category} ${design.useCase}`,
        /\bai\b/i,
        id,
      );
    }
  });

  it('offers designs for a request that names only a category', () => {
    for (const [prompt, category] of [
      ['An ecommerce website', 'ecommerce'],
      ['A music website', 'music'],
    ]) {
      const ids = matchCatalogDesigns(prompt, DESIGN_TEMPLATE_INDEX);
      assert.equal(ids.length, INSPIRATION_LIMIT, prompt);
      for (const id of ids) {
        const design = findDesignTemplate(id)!;
        assert.match(
          `${design.summary} ${design.category} ${design.useCase}`,
          new RegExp(category, 'i'),
          id,
        );
      }
    }
  });

  it('does not take a generic noun for a subject', () => {
    assert.ok(
      !matchCatalogDesigns(
        'An online course platform',
        DESIGN_TEMPLATE_INDEX,
      ).includes('halyard'),
    );
  });

  it('takes a trade and its craft for one subject', () => {
    const ids = matchCatalogDesigns(
      'A wedding photographer website',
      DESIGN_TEMPLATE_INDEX,
    );
    assert.match(findDesignTemplate(ids[0]!)!.summary, /wedding photography/i);
  });

  it('needs every word of a compound label', () => {
    for (const id of matchCatalogDesigns(
      'A cleaning business website',
      DESIGN_TEMPLATE_INDEX,
    )) {
      assert.notEqual(findDesignTemplate(id)!.category, 'business-tools', id);
    }
  });

  it('does not take one shared word of a longer summary for a subject', () => {
    assert.ok(
      !matchCatalogDesigns(
        'A real estate website',
        DESIGN_TEMPLATE_INDEX,
      ).includes('jotworks'),
    );
  });

  it('takes a subject word with the form it asks for', () => {
    assert.equal(
      matchCatalogDesigns(
        'An event tracking dashboard',
        DESIGN_TEMPLATE_INDEX,
      )[0],
      'eventgrain',
    );
  });

  it('takes a domain term as its whole label', () => {
    for (const [prompt, label] of [
      ['A CRM dashboard', 'crm-sales'],
      ['An HR dashboard', 'hr-people'],
      ['A sales app', 'crm-sales'],
    ]) {
      const ids = matchCatalogDesigns(prompt, DESIGN_TEMPLATE_INDEX);
      assert.ok(ids.length > 0, prompt);
      for (const id of ids) {
        const design = findDesignTemplate(id)!;
        assert.ok([design.category, design.useCase].includes(label), id);
      }
    }
  });

  it('offers nothing when the message already carries a design brief', () => {
    const brief = designBrief('fernhollow')!;
    assert.deepEqual(
      matchCatalogDesigns(`${WEDDING}\n\n${brief}`, DESIGN_TEMPLATE_INDEX),
      [],
    );
  });

  it('offers nothing for a pasted build prompt, but reads a Goal heading', () => {
    const { buildPrompt } = findDesignTemplate('fernhollow')!;
    assert.deepEqual(
      matchCatalogDesigns(buildPrompt, DESIGN_TEMPLATE_INDEX),
      [],
    );
    assert.equal(
      matchCatalogDesigns(
        '### Goal\nBuild a wedding website',
        DESIGN_TEMPLATE_INDEX,
      ).length,
      INSPIRATION_LIMIT,
    );
  });

  it('never offers a screen pattern or a merged design', () => {
    for (const prompt of [
      WEDDING,
      'A SaaS dashboard with billing settings',
      'A landing page for a cybersecurity SaaS',
    ]) {
      for (const id of matchCatalogDesigns(prompt, DESIGN_TEMPLATE_INDEX)) {
        const design = findDesignTemplate(id)!;
        assert.equal(design.format, 'design', id);
        assert.equal(design.mergedInto, undefined, id);
      }
    }
  });
});

describe('the directions a build is given', () => {
  it('names each design with its mood, type and palette', () => {
    const entries = directionsFor(WEDDING);
    const section = catalogInspirationGuidance(entries)!;
    assert.match(section, /^ART DIRECTION FROM THE TEMPLATE CATALOG/);
    for (const entry of entries) {
      assert.ok(section.includes(entry.name), entry.name);
      assert.ok(section.includes(entry.mood), entry.name);
      assert.ok(section.includes(entry.palette[0]!.hex), entry.name);
      assert.ok(section.includes(entry.type[0]!.family), entry.name);
    }
    assert.match(section, /Do not copy a design's name or sample content/);
  });

  it('is nothing when nothing matched', () => {
    assert.equal(catalogInspirationGuidance([]), null);
  });

  it('stands in for the product-type palette, and gives way to a style', () => {
    const section = catalogInspirationGuidance(
      directionsFor('A landing page for a fintech SaaS'),
    )!;
    const withIt = buildUserPrompt(
      { prompt: 'A landing page for a fintech SaaS' },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      section,
    );
    assert.ok(withIt.includes(section));
    assert.doesNotMatch(
      withIt,
      /This looks like a .* product\. In the absence/,
    );

    const without = buildUserPrompt({
      prompt: 'A landing page for a fintech SaaS',
    });
    assert.match(without, /This looks like a .* product\. In the absence/);

    const styled = buildUserPrompt(
      { prompt: 'A landing page for a fintech SaaS' },
      'brutalism',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      section,
    );
    assert.ok(!styled.includes(section));
  });
});
