import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useGrimoireUser } from '@/hooks/useGrimoireAuth';
import { api } from '@/lib/axios';
import { AppShell } from '@/components/layout/AppShell';
import { CampaignCard } from '@/components/campaign/CampaignCard';
import { CreateCampaignModal } from '@/components/campaign/CreateCampaignModal';
import { JoinCampaignModal } from '@/components/campaign/JoinCampaignModal';
import type { CampaignWithMembers } from '@grimoire/shared';

export function Dashboard() {
  const { user } = useGrimoireUser();
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await api.get<{ campaigns: (CampaignWithMembers & { myRole: string })[] }>(
        '/campaigns'
      );
      return res.data.campaigns;
    },
    refetchInterval: (query) =>
      query.state.data?.some((c) => c.activeSession?.isActive) ? 5000 : false,
  });

  const campaigns = data ?? [];
  const gmCampaigns = campaigns.filter((c) => c.myRole === 'GM');
  const playerCampaigns = campaigns.filter((c) => c.myRole !== 'GM');

  return (
    <AppShell>
      <div className="flex-1 p-6 md:p-10 max-w-7xl mx-auto w-full">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
          <div>
            <p className="font-ui text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>
              Welcome back,
            </p>
            <h1
              className="font-display text-3xl md:text-4xl font-bold tracking-wide"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {user?.firstName ?? user?.username ?? 'Adventurer'}
            </h1>
            <p className="font-body text-base mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              Your campaigns await.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setShowJoin(true)} className="btn-ghost">
              Join Campaign
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              + New Campaign
            </button>
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg overflow-hidden" style={{ height: 240 }}>
                <div className="skeleton w-full h-36" />
                <div className="p-4 space-y-2" style={{ background: 'var(--color-bg-secondary)' }}>
                  <div className="skeleton h-4 w-3/4" />
                  <div className="skeleton h-3 w-full" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && campaigns.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-7xl mb-6 opacity-40">🐉</div>
            <h2
              className="font-display text-2xl font-bold mb-3"
              style={{ color: 'var(--color-text-primary)' }}
            >
              No campaigns yet
            </h2>
            <p className="font-body text-base mb-8 max-w-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Create your first campaign as Game Master, or join one with an invite code.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowJoin(true)} className="btn-ghost">
                Join with Code
              </button>
              <button onClick={() => setShowCreate(true)} className="btn-primary">
                Create Campaign
              </button>
            </div>
          </div>
        )}

        {/* GM Campaigns */}
        {gmCampaigns.length > 0 && (
          <section className="mb-10">
            <div className="flex items-center gap-3 mb-5">
              <h2
                className="font-display text-lg font-semibold tracking-wider"
                style={{ color: 'var(--color-accent-gold)' }}
              >
                As Game Master
              </h2>
              <div className="gold-divider flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {gmCampaigns.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              ))}
            </div>
          </section>
        )}

        {/* Player Campaigns */}
        {playerCampaigns.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-5">
              <h2
                className="font-display text-lg font-semibold tracking-wider"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                As Player
              </h2>
              <div className="gold-divider flex-1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {playerCampaigns.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              ))}
            </div>
          </section>
        )}
      </div>

      {showCreate && <CreateCampaignModal onClose={() => setShowCreate(false)} />}
      {showJoin && <JoinCampaignModal onClose={() => setShowJoin(false)} />}
    </AppShell>
  );
}
