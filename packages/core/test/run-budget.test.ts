import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BudgetExceededError,
  RunBudgetLedger,
} from '../src/index.ts';

test('enforces configured limits without built-in defaults', () => {
  const ledger = new RunBudgetLedger({ toolCalls: 2 });

  ledger.consume({ toolCalls: 1 });
  ledger.consume({ toolCalls: 1 });

  assert.throws(
    () => ledger.consume({ toolCalls: 1 }),
    (error: unknown) =>
      error instanceof BudgetExceededError &&
      error.resource === 'toolCalls' &&
      error.remaining === 0,
  );
});

test('reservations prevent concurrent work from double-spending remaining budget', () => {
  const ledger = new RunBudgetLedger({ modelInputTokens: 100 });

  const first = ledger.reserve({ modelInputTokens: 80 });

  assert.throws(
    () => ledger.reserve({ modelInputTokens: 30 }),
    BudgetExceededError,
  );

  first.release();
  const second = ledger.reserve({ modelInputTokens: 30 });
  second.commit();

  assert.equal(ledger.report().used.modelInputTokens, 30);
  assert.equal(ledger.report().reserved.modelInputTokens, 0);
});

test('committing less than reserved charges actual usage and releases the remainder', () => {
  const ledger = new RunBudgetLedger({ sandboxMilliseconds: 1000 });
  const reservation = ledger.reserve({ sandboxMilliseconds: 800 });

  reservation.commit({ sandboxMilliseconds: 250 });

  const report = ledger.report();
  assert.equal(report.used.sandboxMilliseconds, 250);
  assert.equal(report.reserved.sandboxMilliseconds, 0);
});

test('failed work can still be charged explicitly', () => {
  const ledger = new RunBudgetLedger({ modelCostMicros: 5000 });
  const reservation = ledger.reserve({ modelCostMicros: 3000 });

  reservation.commit({ modelCostMicros: 1200 });

  assert.equal(ledger.report().used.modelCostMicros, 1200);
});

test('usage reports separate committed and reserved resources', () => {
  const ledger = new RunBudgetLedger({ toolCalls: 5 });
  ledger.consume({ toolCalls: 1 });
  const pending = ledger.reserve({ toolCalls: 2 });

  const report = ledger.report();
  assert.equal(report.used.toolCalls, 1);
  assert.equal(report.reserved.toolCalls, 2);
  assert.equal(report.limits.toolCalls, 5);

  pending.release();
});

test('rejects invalid negative or non-finite budget values', () => {
  assert.throws(() => new RunBudgetLedger({ toolCalls: -1 }), RangeError);
  assert.throws(
    () => new RunBudgetLedger({ elapsedMilliseconds: Number.POSITIVE_INFINITY }),
    RangeError,
  );
});
