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
