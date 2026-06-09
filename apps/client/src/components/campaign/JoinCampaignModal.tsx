import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { api } from '@/lib/axios';
import type { ActiveSessionSummary, CampaignWithMembers } from '@grimoire/shared';

interface JoinCampaignModalProps {
  onClose: () => void;
  prefillCode?: string;
}

export function JoinCampaignModal({ onClose, prefillCode = '' }: JoinCampaignModalProps) {
  const [code, setCode] = useState(prefillCode.toUpperCase());
  const qc = useQueryClient();
  const navigate = useNavigate();

  const joinMutation = useMutation({
    mutationFn: async () => {
      try {
        const res = await api.post<{
          campaign: CampaignWithMembers;
          activeSession: ActiveSessionSummary | null;
        }>('/campaigns/join', {
          inviteCode: code.trim().toUpperCase(),
        });
        return res.data;
      } catch (err) {
        if (
          isAxiosError(err) &&
          err.response?.status === 409 &&
          err.response.data?.campaign
        ) {
          return {
            campaign: err.response.data.campaign as CampaignWithMembers,
            activeSession: (err.response.data.activeSession as ActiveSessionSummary | null) ?? null,
            alreadyMember: true,
          };
        }
        throw err;
      }
    },
    onSuccess: ({ campaign, activeSession }) => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      if (activeSession?.isActive) {
        navigate(`/session/${activeSession.id}`);
      } else {
        navigate(`/campaigns/${campaign.id}`);
      }
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="panel-gold w-full max-w-sm animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            className="font-display text-xl font-bold tracking-wide"
            style={{ color: 'var(--color-accent-gold)' }}
          >
            Join Campaign
          </h2>
          <button onClick={onClose} className="font-ui text-xl leading-none" style={{ color: 'var(--color-text-secondary)' }}>
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) joinMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label
              className="block font-ui text-xs font-medium mb-1.5 uppercase tracking-wider"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Invite Code
            </label>
            <input
              className="input-dark text-center text-lg font-ui tracking-widest uppercase"
              placeholder="XXXXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
              maxLength={8}
              autoFocus
              required
            />
          </div>

          {joinMutation.error && (
            <p className="font-ui text-sm" style={{ color: 'var(--color-accent-red-hot)' }}>
              Invalid invite code or you're already a member.
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost flex-1">
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={code.trim().length < 4 || joinMutation.isPending}
            >
              {joinMutation.isPending ? 'Joining...' : 'Join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
