import { Router, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getPrimaryClientUrl } from '../lib/clientOrigins';
import {
  getStripe,
  isMissingStripeCustomerError,
  isStripeConfigured,
  stripeErrorMessage,
  stripeMonthlyPriceId,
  stripeOneTimeAmountCents,
  stripeOneTimePriceId,
  stripeWebhookSecret,
  validateSupportPrice,
} from '../lib/stripe';
import {
  applyCheckoutCompleted,
  applySubscriptionChange,
  clearStripeCustomerId,
  getOrCreateStripeCustomer,
} from '../services/supportStripe';
import { prisma } from '../lib/prisma';

const router = Router();

const checkoutBody = z.object({
  mode: z.enum(['payment', 'subscription']),
});

function supportReturnUrl(): string {
  return `${getPrimaryClientUrl()}/support`;
}

async function createCheckoutSession(opts: {
  stripe: ReturnType<typeof getStripe>;
  userId: string;
  mode: 'payment' | 'subscription';
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
  successUrl: string;
  cancelUrl: string;
  retryMissingCustomer?: boolean;
}): Promise<Stripe.Checkout.Session> {
  const { stripe, userId, mode, lineItems, successUrl, cancelUrl } = opts;
  const customerId = await getOrCreateStripeCustomer(userId);

  try {
    return await stripe.checkout.sessions.create({
      mode,
      customer: customerId,
      client_reference_id: userId,
      metadata: { userId, mode },
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      ...(mode === 'subscription'
        ? { subscription_data: { metadata: { userId } } }
        : {}),
    });
  } catch (err) {
    if (opts.retryMissingCustomer !== false && isMissingStripeCustomerError(err)) {
      console.warn('[Support] stale Stripe customer — recreating for user', userId);
      await clearStripeCustomerId(userId);
      return createCheckoutSession({ ...opts, retryMissingCustomer: false });
    }
    throw err;
  }
}

// GET /api/support/config — what payment options are available
router.get('/config', (_req, res) => {
  const enabled = isStripeConfigured();
  const monthlyPriceId = stripeMonthlyPriceId();
  const oneTimePriceId = stripeOneTimePriceId();
  res.json({
    enabled,
    monthly: enabled && Boolean(monthlyPriceId),
    oneTime: enabled && (Boolean(oneTimePriceId) || stripeOneTimeAmountCents() >= 100),
    oneTimeAmountCents: stripeOneTimeAmountCents(),
    currency: 'usd',
  });
});

// GET /api/support/status — current user's supporter state
router.get('/status', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: {
        supporterActive: true,
        supporterPlan: true,
        supporterSince: true,
        stripeSubscriptionId: true,
      },
    });
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      supporterActive: user.supporterActive,
      supporterPlan: user.supporterPlan,
      supporterSince: user.supporterSince,
      hasSubscription: Boolean(user.stripeSubscriptionId),
    });
  } catch (err) {
    console.error('[Support] status error:', err);
    res.status(500).json({ error: 'Failed to load support status' });
  }
});

// POST /api/support/checkout — Stripe Checkout (one-time or subscription)
router.post('/checkout', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: 'Support payments are not configured yet' });
    return;
  }

  const parsed = checkoutBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const { mode } = parsed.data;
  const userId = req.userId!;

  try {
    const stripe = getStripe();
    const successUrl = `${supportReturnUrl()}?thanks=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${supportReturnUrl()}?canceled=1`;

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (mode === 'subscription') {
      const priceId = stripeMonthlyPriceId();
      if (!priceId) {
        res.status(503).json({ error: 'Monthly support is not configured (STRIPE_PRICE_SUPPORT_MONTHLY)' });
        return;
      }
      await validateSupportPrice(stripe, priceId, 'monthly');
      lineItems = [{ price: priceId, quantity: 1 }];
    } else {
      const priceId = stripeOneTimePriceId();
      if (priceId) {
        await validateSupportPrice(stripe, priceId, 'one_time');
        lineItems = [{ price: priceId, quantity: 1 }];
      } else {
        lineItems = [{
          price_data: {
            currency: 'usd',
            unit_amount: stripeOneTimeAmountCents(),
            product_data: {
              name: 'Support Grimoire VTT',
              description: 'One-time thank-you to the developer',
            },
          },
          quantity: 1,
        }];
      }
    }

    const session = await createCheckoutSession({
      stripe,
      userId,
      mode,
      lineItems,
      successUrl,
      cancelUrl,
    });

    if (!session.url) {
      res.status(500).json({ error: 'Failed to create checkout session' });
      return;
    }

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Support] checkout error:', err);
    res.status(500).json({ error: stripeErrorMessage(err, 'Failed to start checkout') });
  }
});

// POST /api/support/portal — manage/cancel subscription
router.post('/portal', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!isStripeConfigured()) {
    res.status(503).json({ error: 'Support payments are not configured yet' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { stripeCustomerId: true },
    });

    const customerId = user?.stripeCustomerId ?? await getOrCreateStripeCustomer(req.userId!);
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: supportReturnUrl(),
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Support] portal error:', err);
    res.status(500).json({ error: 'Failed to open billing portal' });
  }
});

export default router;

/** Stripe webhook — mount with express.raw() before express.json() */
export async function handleSupportWebhook(req: Request, res: Response): Promise<void> {
  const secret = stripeWebhookSecret();
  if (!secret || !isStripeConfigured()) {
    res.status(503).send('Stripe webhooks not configured');
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    res.status(400).send('Missing stripe-signature');
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[Support] webhook signature failed:', err);
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await applyCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await applySubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    console.error('[Support] webhook handler error:', err);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
}
