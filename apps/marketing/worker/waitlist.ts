/**
 * The waitlist submission, with no Workers runtime behind it.
 *
 * Validation and the Resend request are pure functions so they are testable
 * without deploying anything -- the same reason apps/web keeps its spend
 * arithmetic out of the Durable Object that applies it.
 */

/**
 * Deliberately permissive. This gates what reaches Resend, not what counts as
 * a valid email address in general -- rejecting a real address here loses a
 * signup, while a slightly-too-permissive check only means Resend's own
 * validation (or a bounced confirmation, once double opt-in exists) catches
 * the rest.
 */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export interface WaitlistSubmission {
  email: string;
  /**
   * Honeypot field. A real visitor never sees or fills it -- it is hidden
   * from sighted and screen-reader users alike (see the form component) --
   * so any value here means a bot filled every field it could find.
   */
  company: string;
}

export type WaitlistResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'invalid-email' | 'spam-honeypot' | 'invalid-body' };

/** Reads and validates a submission from either an HTML form post or JSON. */
export async function parseWaitlistSubmission(
  request: Request,
): Promise<WaitlistSubmission | null> {
  const contentType = request.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      return {
        email: typeof body.email === 'string' ? body.email : '',
        company: typeof body.company === 'string' ? body.company : '',
      };
    }
    const form = await request.formData();
    return {
      email: String(form.get('email') ?? ''),
      company: String(form.get('company') ?? ''),
    };
  } catch {
    return null;
  }
}

export function validateSubmission(
  submission: WaitlistSubmission | null,
): WaitlistResult {
  if (!submission) return { ok: false, reason: 'invalid-body' };
  // A filled honeypot fails closed but still looks like success to the
  // caller (see the Worker) -- telling a bot which field gave it away only
  // teaches it to stop filling that one.
  if (submission.company.trim().length > 0) {
    return { ok: false, reason: 'spam-honeypot' };
  }
  if (!isPlausibleEmail(submission.email)) {
    return { ok: false, reason: 'invalid-email' };
  }
  return { ok: true, email: submission.email.trim().toLowerCase() };
}

/**
 * Builds the Resend request. Returned rather than sent so the shape of the
 * call is testable without a network -- see the Resend contacts API:
 * https://resend.com/docs/api-reference/contacts/create-contact
 */
export function resendContactRequest(
  email: string,
  segmentId: string,
  apiKey: string,
): { url: string; init: RequestInit } {
  return {
    url: 'https://api.resend.com/contacts',
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, segments: [segmentId] }),
    },
  };
}
