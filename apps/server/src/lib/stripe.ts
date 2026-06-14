import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env['STRIPE_SECRET_KEY']?.trim());
}

export function getStripe(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY']?.trim();
  if (!key) {
    throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  }
  return stripeClient;
}

export function stripeMonthlyPriceId(): string | null {
  return process.env['STRIPE_PRICE_SUPPORT_MONTHLY']?.trim() || null;
}

export function stripeOneTimePriceId(): string | null {
  return process.env['STRIPE_PRICE_SUPPORT_ONETIME']?.trim() || null;
}

/** Fallback one-time amount in cents when no price ID is set (default $5). */
export function stripeOneTimeAmountCents(): number {
  const raw = process.env['STRIPE_SUPPORT_ONETIME_AMOUNT_CENTS']?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 500;
  return Number.isFinite(n) && n >= 100 ? n : 500;
}

export function stripeWebhookSecret(): string | null {
  return process.env['STRIPE_WEBHOOK_SECRET']?.trim() || null;
}

export function stripeErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'type' in err && (err as { type?: string }).type === 'StripeInvalidRequestError') {
    const message = (err as { message?: string }).message;
    if (message) return message;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function isMissingStripeCustomerError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const stripeErr = err as { code?: string; param?: string; message?: string };
  return (
    stripeErr.code === 'resource_missing'
    && (stripeErr.param === 'customer' || /no such customer/i.test(stripeErr.message ?? ''))
  );
}

/** Ensure monthly vs one-time price IDs are not swapped in env vars. */
export async function validateSupportPrice(
  stripe: Stripe,
  priceId: string,
  kind: 'monthly' | 'one_time',
): Promise<void> {
  const price = await stripe.prices.retrieve(priceId);
  if (kind === 'monthly' && !price.recurring) {
    throw new Error(
      'STRIPE_PRICE_SUPPORT_MONTHLY must be a recurring price. Swap the monthly and one-time price IDs in Render if needed.',
    );
  }
  if (kind === 'one_time' && price.recurring) {
    throw new Error(
      'STRIPE_PRICE_SUPPORT_ONETIME must be a one-time price. Swap the monthly and one-time price IDs in Render if needed.',
    );
  }
}
