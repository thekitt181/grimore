import type Stripe from 'stripe';
import { prisma } from '../lib/prisma';
import { getStripe } from '../lib/stripe';

export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      stripeCustomerId: true,
      authUserId: true,
    },
  });
  if (!user) throw new Error('User not found');
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const authUser = await prisma.authUser.findUnique({
    where: { id: user.authUserId },
    select: { email: true, name: true },
  });

  const customer = await getStripe().customers.create({
    email: authUser?.email ?? undefined,
    name: authUser?.name ?? user.username,
    metadata: { userId: user.id, authUserId: user.authUserId },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

export async function clearStripeCustomerId(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: null },
  });
}

export async function applyCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId ?? session.client_reference_id;
  if (!userId) {
    console.warn('[Support] checkout.session.completed without userId metadata');
    return;
  }

  const customerId = typeof session.customer === 'string'
    ? session.customer
    : session.customer?.id ?? null;

  const subscriptionId = typeof session.subscription === 'string'
    ? session.subscription
    : session.subscription?.id ?? null;

  const isSubscription = session.mode === 'subscription';

  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      ...(isSubscription && subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
      supporterActive: true,
      supporterPlan: isSubscription ? 'monthly' : 'one_time',
      supporterSince: new Date(),
    },
  });
}

export async function applySubscriptionChange(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;
    const user = await prisma.user.findFirst({
      where: { stripeCustomerId: customerId },
      select: { id: true },
    });
    if (!user) {
      console.warn('[Support] subscription event for unknown customer', customerId);
      return;
    }
    await syncSubscriptionForUser(user.id, subscription);
    return;
  }
  await syncSubscriptionForUser(userId, subscription);
}

async function syncSubscriptionForUser(userId: string, subscription: Stripe.Subscription): Promise<void> {
  const active = subscription.status === 'active' || subscription.status === 'trialing';
  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeSubscriptionId: subscription.id,
      supporterActive: active,
      supporterPlan: active ? 'monthly' : null,
      ...(active ? { supporterSince: new Date(subscription.start_date * 1000) } : {}),
    },
  });
}

export async function clearSubscription(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeSubscriptionId: null,
      supporterActive: false,
      supporterPlan: null,
    },
  });
}
