export interface RunResources {
  modelInputTokens: number;
  modelOutputTokens: number;
  modelCostMicros: number;
  toolCalls: number;
  sandboxMilliseconds: number;
  elapsedMilliseconds: number;
}

export type RunBudget = Partial<RunResources>;

export interface RunUsageReport {
  used: RunResources;
  reserved: RunResources;
  limits: RunBudget;
}

export interface BudgetReservation {
  readonly resources: RunResources;
  commit(actual?: Partial<RunResources>): void;
  release(): void;
}

export class BudgetExceededError extends Error {
  readonly resource: keyof RunResources;
  readonly requested: number;
  readonly remaining: number;

  constructor(
    resource: keyof RunResources,
    requested: number,
    remaining: number,
  ) {
    super(`Run budget exceeded for ${resource}`);
    this.name = 'BudgetExceededError';
    this.resource = resource;
    this.requested = requested;
    this.remaining = remaining;
  }
}

const RESOURCE_KEYS: (keyof RunResources)[] = [
  'modelInputTokens',
  'modelOutputTokens',
  'modelCostMicros',
  'toolCalls',
  'sandboxMilliseconds',
  'elapsedMilliseconds',
];

function emptyResources(): RunResources {
  return {
    modelInputTokens: 0,
    modelOutputTokens: 0,
    modelCostMicros: 0,
    toolCalls: 0,
    sandboxMilliseconds: 0,
    elapsedMilliseconds: 0,
  };
}

function normalize(resources: Partial<RunResources>): RunResources {
  const normalized = emptyResources();
  for (const key of RESOURCE_KEYS) {
    const value = resources[key] ?? 0;
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${key} must be a finite non-negative number`);
    }
    normalized[key] = value;
  }
  return normalized;
}

export class RunBudgetLedger {
  private readonly used = emptyResources();
  private readonly reserved = emptyResources();
  private readonly limits: RunBudget;

  constructor(limits: RunBudget) {
    normalize(limits);
    this.limits = structuredClone(limits);
  }

  reserve(resources: Partial<RunResources>): BudgetReservation {
    const requested = normalize(resources);

    for (const key of RESOURCE_KEYS) {
      const limit = this.limits[key];
      if (limit === undefined) continue;

      const remaining = limit - this.used[key] - this.reserved[key];
      if (requested[key] > remaining) {
        throw new BudgetExceededError(
          key,
          requested[key],
          Math.max(0, remaining),
        );
      }
    }

    for (const key of RESOURCE_KEYS) {
      this.reserved[key] += requested[key];
    }

    let settled = false;
    return {
      resources: structuredClone(requested),
      commit: (actual = requested) => {
        if (settled) return;
        const consumed = normalize(actual);
        for (const key of RESOURCE_KEYS) {
          if (consumed[key] > requested[key]) {
            throw new RangeError(
              `${key} actual usage cannot exceed the reserved amount`,
            );
          }
        }
        for (const key of RESOURCE_KEYS) {
          this.reserved[key] -= requested[key];
          this.used[key] += consumed[key];
        }
        settled = true;
      },
      release: () => {
        if (settled) return;
        for (const key of RESOURCE_KEYS) {
          this.reserved[key] -= requested[key];
        }
        settled = true;
      },
    };
  }

  consume(resources: Partial<RunResources>): void {
    this.reserve(resources).commit();
  }

  report(): RunUsageReport {
    return {
      used: structuredClone(this.used),
      reserved: structuredClone(this.reserved),
      limits: structuredClone(this.limits),
    };
  }
}
