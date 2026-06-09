import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/axios';
import type { CampaignWithMembers } from '@grimoire/shared';

interface CreateCampaignModalProps {
  onClose: () => void;
}

export function CreateCampaignModal({ onClose }: CreateCampaignModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ campaign: CampaignWithMembers }>('/campaigns', {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      return res.data.campaign;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
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
        className="panel-gold w-full max-w-md animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2
            className="font-display text-xl font-bold tracking-wide"
            style={{ color: 'var(--color-accent-gold)' }}
          >
            New Campaign
          </h2>
          <button
            onClick={onClose}
            className="font-ui text-xl leading-none transition-colors duration-200"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.color = 'var(--color-text-primary)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color = 'var(--color-text-secondary)')
            }
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) createMutation.mutate();
          }}
          className="space-y-4"
        >
          <div>
            <label
              className="block font-ui text-xs font-medium mb-1.5 uppercase tracking-wider"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Campaign Name *
            </label>
            <input
              className="input-dark"
              placeholder="The Lost Mines of Phandelver"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              required
            />
          </div>

          <div>
            <label
              className="block font-ui text-xs font-medium mb-1.5 uppercase tracking-wider"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Description
            </label>
            <textarea
              className="input-dark resize-none"
              placeholder="A brief description of your campaign..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>

          {createMutation.error && (
            <p className="font-ui text-sm" style={{ color: 'var(--color-accent-red-hot)' }}>
              Failed to create campaign. Please try again.
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost flex-1"
              disabled={createMutation.isPending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={!name.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
