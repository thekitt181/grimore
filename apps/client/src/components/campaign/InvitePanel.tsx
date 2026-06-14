import { useState } from 'react';
import { useCampaignInvite } from './useCampaignInvite';

interface InvitePanelProps {
  campaignId: string;
}

export function InvitePanel({ campaignId }: InvitePanelProps) {
  const [copied, setCopied] = useState(false);
  const { data } = useCampaignInvite(campaignId);

  const handleCopy = async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!data) return null;

  return (
    <div className="panel space-y-3">
      <h3
        className="font-display text-sm font-semibold tracking-wider uppercase"
        style={{ color: 'var(--color-accent-gold)' }}
      >
        Invite Players
      </h3>

      <div
        className="flex items-center gap-2 rounded-md p-3"
        style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}
      >
        <span
          className="font-ui text-base font-bold tracking-[0.3em] flex-1 text-center"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {data.inviteCode}
        </span>
      </div>

      <div
        className="flex items-center gap-2 rounded-md p-2 text-xs font-ui truncate"
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
        }}
      >
        {data.inviteUrl}
      </div>

      <button onClick={handleCopy} className="btn-primary w-full text-sm">
        {copied ? '✓ Copied!' : 'Copy Invite Link'}
      </button>
    </div>
  );
}
