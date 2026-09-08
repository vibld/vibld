import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCENARIOS, runScenario } from '../src/scenarios.ts';

describe('injected failures', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: ${scenario.description}`, async () => {
      const result = await runScenario(scenario);
      assert.ok(
        result.checkpointRetained,
        `${scenario.id} lost the accepted checkpoint: ${result.detail}`,
      );
      assert.ok(result.passed, result.detail);
    });
  }

  it("covers the failures that would lose a user's work", () => {
    const ids = SCENARIOS.map((scenario) => scenario.id);
    for (const required of [
      'invalid-edit',
      'interrupted-run',
      'conflicting-revision',
      'sandbox-eviction',
    ]) {
      assert.ok(ids.includes(required), `no scenario covers ${required}`);
    }
  });
});
