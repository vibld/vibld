/**
 * What one run may ask its model for, and what that will cost if it uses all
 * of it.
 *
 * These are one question, and the bug this file exists to prevent is asking
 * it twice. The reservation (`handlePlan`) and the request itself
 * (`GenerationWorkflow`) each need a token ceiling and each need a price, and
 * for a while they derived them separately: the reservation priced a flat
 * 64000 while the provider was free to emit whatever its own constant said,
 * which is a run permitted to outspend its own reservation. Deriving both
 * from one call means a caller cannot take one without the other, so they
 * cannot drift apart again.
 *
 * The price is the one actually in force, not the catalogue's. An operator
 * may correct a stale rate with `VIBLD_USD_MICRO_PER_OUTPUT_TOKEN`, and a
 * ceiling derived from the catalogue while the reservation charges the
 * override is the same divergence wearing different clothes.
 */

import {
  cacheRatesFor,
  findModel,
  maxTokensFor,
  providerForRequest,
} from '@vibld/ai';
import type { ProviderEnv } from '@vibld/ai';

import { parsePrices } from './spend.ts';
import type { TokenPrices } from './spend.ts';

export interface RunCeilingEnv extends ProviderEnv {
  VIBLD_USD_MICRO_PER_INPUT_TOKEN?: string;
  VIBLD_USD_MICRO_PER_OUTPUT_TOKEN?: string;
}

export interface RunCeiling {
  /** What a token costs, after any operator override. */
  prices: TokenPrices;
  /** The output ceiling to reserve against and to ask the model for. */
  maxTokens: number;
}

export function runCeilingFor(env: RunCeilingEnv, model: string): RunCeiling {
  const chosen = findModel(model);
  const prices = parsePrices(
    env,
    providerForRequest(env, model),
    chosen
      ? {
          inputMicroUsd: chosen.inputMicroUsd,
          outputMicroUsd: chosen.outputMicroUsd,
          // The cached rates follow the model rather than the provider
          // default, for the same reason the input rate does: a run on Opus
          // must not be priced at DeepSeek's rate because the deployment
          // happens to default to DeepSeek.
          ...cacheRatesFor(chosen),
        }
      : undefined,
  );
  return { prices, maxTokens: maxTokensFor(model, prices.outputMicroUsd) };
}
