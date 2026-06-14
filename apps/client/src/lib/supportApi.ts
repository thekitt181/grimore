import { api } from '@/lib/axios';

export interface SupportConfig {
  enabled: boolean;
  monthly: boolean;
  oneTime: boolean;
  oneTimeAmountCents: number;
  currency: string;
}

export interface SupportStatus {
  supporterActive: boolean;
  supporterPlan: 'monthly' | 'one_time' | null;
  supporterSince: string | null;
  hasSubscription: boolean;
}

export async function fetchSupportConfig(): Promise<SupportConfig> {
  const { data } = await api.get<SupportConfig>('/support/config');
  return data;
}

export async function fetchSupportStatus(): Promise<SupportStatus> {
  const { data } = await api.get<SupportStatus>('/support/status');
  return data;
}

export async function startSupportCheckout(mode: 'payment' | 'subscription'): Promise<string> {
  const { data } = await api.post<{ url: string }>('/support/checkout', { mode });
  return data.url;
}

export async function openSupportPortal(): Promise<string> {
  const { data } = await api.post<{ url: string }>('/support/portal');
  return data.url;
}

export function formatSupportAmount(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
