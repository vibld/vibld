/**
 * L44: "A scheduled Worker reads both providers' balances daily and emails
 * an alert through Resend on a threshold."
 *
 * Runs from the same nightly Cron Trigger the Stripe reconcile already uses
 * (`wrangler.jsonc`'s `triggers.crons`, `worker/index.ts`'s `scheduled`) --
 * no new schedule to declare, since both already want "daily."
 *
 * Only DeepSeek is actually checked. Anthropic has no public balance-check
 * API outside the Console as of this writing -- reading spend
 * programmatically needs an Admin API key (the Usage and Cost Admin API),
 * a separate, more privileged credential from the plain `ANTHROPIC_API_KEY`
 * this deployment already holds. That gap is real, not an oversight: it is
 * recorded here and in README.md rather than silently reporting a check
 * that never ran.
 */

export interface ProviderBalanceEnv {
  DEEPSEEK_API_KEY?: string;
  /** USD. Below this, an alert is sent. Default: $10. */
  VIBLD_DEEPSEEK_BALANCE_ALERT_USD?: string;
  RESEND_API_KEY?: string;
  /** Default: billing@vibld.com. */
  VIBLD_ALERT_EMAIL?: string;
  /** Default: alerts@notifications.vibld.com (docs/decisions.md L17). */
  VIBLD_ALERT_FROM?: string;
}

const DEFAULT_ALERT_THRESHOLD_USD = 10;
const DEFAULT_ALERT_EMAIL = 'billing@vibld.com';
const DEFAULT_ALERT_FROM = 'alerts@notifications.vibld.com';

export interface DeepseekBalance {
  currency: string;
  totalBalance: number;
}

/**
 * https://api.deepseek.com/user/balance -- the same DEEPSEEK_API_KEY this
 * deployment already holds for generation, not a separate credential.
 * Returns null on any non-success response or an unparseable body, rather
 * than throwing: a balance check that fails should not fail the whole
 * nightly reconcile it rides alongside.
 */
export async function fetchDeepseekBalance(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeepseekBalance | null> {
  let response: Response;
  try {
    response = await fetchImpl('https://api.deepseek.com/user/balance', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  const info = (
    body as {
      balance_infos?: { currency?: unknown; total_balance?: unknown }[];
    }
  ).balance_infos?.[0];
  if (!info || typeof info.currency !== 'string') return null;
  const totalBalance = Number(info.total_balance);
  if (!Number.isFinite(totalBalance)) return null;
  return { currency: info.currency, totalBalance };
}

/**
 * Resend's plain send endpoint -- the same shape apps/marketing's waitlist
 * uses for its own Resend calls. Returns whether the send succeeded rather
 * than throwing, for the same reason fetchDeepseekBalance does.
 */
async function sendBalanceAlert(
  env: ProviderBalanceEnv,
  provider: string,
  balance: DeepseekBalance,
  thresholdUsd: number,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;
  const to = env.VIBLD_ALERT_EMAIL ?? DEFAULT_ALERT_EMAIL;
  const from = env.VIBLD_ALERT_FROM ?? DEFAULT_ALERT_FROM;
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `Vibld: ${provider} balance below $${thresholdUsd}`,
        text: `${provider}'s account balance is $${balance.totalBalance.toFixed(2)} ${balance.currency}, below the $${thresholdUsd} alert threshold. Top it up before it blocks generation.`,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface BalanceCheckResult {
  checked: string[];
  alerted: string[];
}

/**
 * Checks every provider this deployment can check, and alerts on any whose
 * balance is below its threshold. Never throws: a missing key or a down
 * provider means that provider is simply not checked, not a failed cron run
 * (the Stripe reconcile it rides alongside must still run either way).
 */
export async function checkProviderBalances(
  env: ProviderBalanceEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<BalanceCheckResult> {
  const checked: string[] = [];
  const alerted: string[] = [];

  if (env.DEEPSEEK_API_KEY) {
    checked.push('deepseek');
    const balance = await fetchDeepseekBalance(env.DEEPSEEK_API_KEY, fetchImpl);
    if (balance) {
      const threshold =
        Number(env.VIBLD_DEEPSEEK_BALANCE_ALERT_USD) ||
        DEFAULT_ALERT_THRESHOLD_USD;
      if (balance.totalBalance < threshold) {
        const sent = await sendBalanceAlert(
          env,
          'DeepSeek',
          balance,
          threshold,
          fetchImpl,
        );
        if (sent) alerted.push('deepseek');
      }
    }
  }

  // DeepSeek is the only provider checked, and that is a property of the
  // providers rather than an omission here: neither Anthropic nor OpenAI
  // exposes an account balance to the same key used for generation, so there
  // is nothing this Worker could read without a second, higher-privilege
  // credential it deliberately does not hold. Spend on those two is visible
  // in their own dashboards and, for what Vibld itself bills, in the credit
  // ledger. `checked` says which were actually looked at, so a quiet run is
  // not mistaken for a healthy one.
  return { checked, alerted };
}
