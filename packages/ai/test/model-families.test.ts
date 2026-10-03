import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions,
  familyDefaultFor,
  familyOf,
  groupByFamily,
} from '../src/model-families.ts';
import { MODEL_CATALOGUE, findModel } from '../src/model-catalogue.ts';
import { DEFAULT_MODELS } from '../src/select-client.ts';

describe('model families', () => {
  it('reads the family and version out of a Claude id', () => {
    assert.deepEqual(familyOf(findModel('claude-opus-5-5')!), {
      key: 'claude-opus',
      label: 'Claude Opus',
      version: [5, 5],
      versionLabel: '5.5',
    });
    assert.equal(familyOf(findModel('claude-opus-4-8')!).key, 'claude-opus');
    assert.equal(familyOf(findModel('claude-haiku-4-5')!).versionLabel, '4.5');
  });

  it('reads the tier as the family of an OpenAI id', () => {
    // GPT-6 Sol and GPT-5.6 Sol are versions of one tier, the way Opus 5.5
    // and Opus 5 are.
    assert.equal(familyOf(findModel('gpt-6-sol')!).key, 'gpt-sol');
    assert.equal(familyOf(findModel('gpt-5.6-sol')!).key, 'gpt-sol');
    assert.equal(familyOf(findModel('gpt-5.6-sol')!).versionLabel, '5.6');
  });

  it('leaves an id it cannot read as a family of one', () => {
    const flash = familyOf(findModel('deepseek-flash')!);
    assert.equal(flash.key, 'deepseek-flash');
    assert.equal(flash.label, 'DeepSeek Flash');
  });

  it('orders versions numerically, newest first', () => {
    assert.ok(compareVersions([5, 5], [5]) < 0);
    assert.ok(compareVersions([5], [4, 8]) < 0);
    assert.ok(compareVersions([4, 10], [4, 8]) < 0, 'not a string compare');
    assert.equal(compareVersions([5], [5, 0]), 0);
  });
});

describe('the version a family opens on', () => {
  const groups = groupByFamily(MODEL_CATALOGUE);
  const defaults = Object.fromEntries(
    groups.map((group) => [group.family.key, group.defaultId]),
  );

  it('opens Opus on 5.5, and every family on its newest version', () => {
    assert.equal(defaults['claude-opus'], 'claude-opus-5-5');
    assert.equal(defaults['claude-fable'], 'claude-fable-5-1');
    assert.equal(defaults['claude-sonnet'], 'claude-sonnet-5-5');
    assert.equal(defaults['gpt-sol'], 'gpt-6-sol');
    assert.equal(defaults['gpt-luna'], 'gpt-6-luna');
  });

  it('never opens a family on a version dearer than an older one', () => {
    // Newest has also been best value for every family offered. If a newer
    // version ever costs more, which one a family should open on is a
    // decision for a person, and this is where it surfaces.
    for (const group of groups) {
      const chosen = findModel(group.defaultId)!;
      for (const member of group.members) {
        const other = findModel(member.id)!;
        assert.ok(
          chosen.inputMicroUsd <= other.inputMicroUsd &&
            chosen.outputMicroUsd <= other.outputMicroUsd,
          `${group.family.label} opens on ${chosen.id}, dearer than ${other.id}`,
        );
      }
    }
  });

  it('keeps every version selectable', () => {
    const members = groups.flatMap((group) => group.members.map((m) => m.id));
    assert.deepEqual(
      [...members].sort(),
      MODEL_CATALOGUE.map((model) => model.id).sort(),
    );
  });

  it('defaults each provider to the version its family opens on', () => {
    for (const id of Object.values(DEFAULT_MODELS)) {
      assert.equal(familyDefaultFor(id, MODEL_CATALOGUE), id, id);
    }
  });

  it('opens on the newest version granted, not the newest that exists', () => {
    // A policy that withholds Opus 5.5 leaves Opus 5 as the family's
    // newest, and the picker must not open on a model it cannot run.
    const granted = MODEL_CATALOGUE.filter((m) => m.id !== 'claude-opus-5-5');
    assert.equal(familyDefaultFor('claude-opus-4-6', granted), 'claude-opus-5');
  });
});
