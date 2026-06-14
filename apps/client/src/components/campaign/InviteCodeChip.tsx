import { useState } from 'react';
import { useCampaignInvite } from './useCampaignInvite';

export function InviteCodeChip({ campaignId }: { campaignId: string }) {
  const { data } = useCampaignInvite(campaignId);
  const [copied, setCopied] = useState(false);

  if (!data) return null;

  async function copyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.inviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <button
      type="button"
      className="flex items-center gap-1.5 rounded px-2 py-0.5 font-ui text-[10px] shrink-0 transition-colors"
      style={{
        background: 'var(--color-bg-primary)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
      }}
      title={copied ? 'Copied!' : 'Copy invite code'}
      onClick={() => void copyCode()}
    >
      <span className="uppercase tracking-wide opacity-70">Invite</span>
      <span
        className="font-bold tracking-[0.2em] text-xs"
        style={{ color: 'var(--color-accent-gold)' }}
      >
        {data.inviteCode}
      </span>
      <span style={{ color: copied ? '#4ade80' : 'var(--color-text-secondary)' }}>
        {copied ? '✓' : '⎘'}
      </span>
    </button>
  );
}
