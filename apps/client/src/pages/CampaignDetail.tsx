import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { api } from '@/lib/axios';
import { AppShell } from '@/components/layout/AppShell';
import { InvitePanel } from '@/components/campaign/InvitePanel';
import { DdbLinkPanelEmbedded } from '@/systems/ddb/DdbLinkPanel';
import type { CampaignWithMembers, CampaignMember } from '@grimoire/shared';

interface MemberWithUser extends CampaignMember {
  user: { id: string; username: string; avatarUrl: string | null };
}

interface CampaignDetailResponse {
  campaign: CampaignWithMembers;
  myRole: 'GM' | 'PLAYER';
}

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['campaign', id],
    queryFn: async () => {
      const res = await api.get<CampaignDetailResponse>(`/campaigns/${id}`);
      return res.data;
    },
    enabled: !!id,
    refetchInterval: (query) =>
      query.state.data?.campaign.activeSession?.isActive ? 5000 : false,
    retry: (failureCount, err) => {
      if (axios.isAxiosError(err) && err.response?.status === 503) return failureCount < 5;
      return failureCount < 2;
    },
    retryDelay: (attempt) => Math.min(2000 * attempt, 8000),
  });

  const startSessionMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ session: { id: string } }>(`/campaigns/${id}/sessions`);
      return res.data.session;
    },
    onSuccess: (session) => {
      void qc.invalidateQueries({ queryKey: ['campaign', id] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      navigate(`/session/${session.id}`);
    },
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/campaigns/${id}`);
    },
    retry: (failureCount, err) => {
      if (axios.isAxiosError(err) && err.response?.status === 503) return failureCount < 3;
      return false;
    },
    retryDelay: (attempt) => Math.min(2000 * attempt, 8000),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.removeQueries({ queryKey: ['campaign', id] });
      navigate('/');
    },
  });

  const handleDeleteCampaign = () => {
    if (!data) return;
    const { campaign } = data;
    const liveWarning = campaign.activeSession
      ? ' There is a live session — anyone in it will be disconnected.'
      : '';
    const confirmed = window.confirm(
      `Delete "${campaign.name}" permanently? All scenes, maps, sessions, and members will be removed.${liveWarning} This cannot be undone.`,
    );
    if (confirmed) deleteCampaignMutation.mutate();
  };

  const joinLiveSession = (sessionId: string) => {
    navigate(`/session/${sessionId}`);
  };

  if (isLoading || (isFetching && !data)) {
    const dbBusy = axios.isAxiosError(error) && error.response?.status === 503;
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <div className="font-display text-lg animate-torch" style={{ color: 'var(--color-accent-gold)' }}>
            {dbBusy ? 'Database busy — retrying…' : 'Loading campaign...'}
          </div>
        </div>
      </AppShell>
    );
  }

  if (!data) {
    const dbBusy = axios.isAxiosError(error) && error.response?.status === 503;
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {isError && dbBusy
              ? 'Database is busy — retrying…'
              : isError
                ? 'Could not load this campaign.'
                : 'Campaign not found.'}
          </p>
        </div>
      </AppShell>
    );
  }

  const { campaign, myRole } = data;
  const isGM = myRole === 'GM';
  const liveSession = campaign.activeSession;

  return (
    <AppShell>
      <div className="flex-1 p-6 md:p-10 max-w-5xl mx-auto w-full">
        {liveSession && (
          <div
            className="mb-6 rounded-lg p-4 md:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            style={{
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12), rgba(212, 175, 55, 0.08))',
              border: '1px solid rgba(34, 197, 94, 0.35)',
            }}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-block w-2 h-2 rounded-full animate-pulse"
                  style={{ background: 'var(--color-accent-green, #22c55e)' }}
                />
                <span className="font-ui text-xs font-semibold uppercase tracking-widest" style={{ color: '#22c55e' }}>
                  Live session
                </span>
              </div>
              <p className="font-display text-lg font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                The table is open — jump into the map and play.
              </p>
              <p className="font-ui text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Started {new Date(liveSession.startedAt).toLocaleString()}
              </p>
            </div>
            <button className="btn-primary shrink-0" onClick={() => joinLiveSession(liveSession.id)}>
              ▶ Join Live Game
            </button>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col md:flex-row gap-6 mb-8">
          {/* Cover art */}
          <div
            className="w-full md:w-48 h-48 rounded-lg overflow-hidden shrink-0"
            style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
          >
            {campaign.coverImageUrl ? (
              <img src={campaign.coverImageUrl} alt={campaign.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-6xl opacity-30">🐉</div>
            )}
          </div>

          <div className="flex-1">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h1
                  className="font-display text-3xl font-bold tracking-wide mb-2"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {campaign.name}
                </h1>
                <p className="font-ui text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                  {campaign.system} · {campaign._count.members} members · {campaign._count.scenes} scenes
                </p>
                {campaign.description && (
                  <p className="font-body text-base" style={{ color: 'var(--color-text-secondary)' }}>
                    {campaign.description}
                  </p>
                )}
                <div className="mt-3">
                  <span className={isGM ? 'badge-role-gm' : 'badge-role-player'}>
                    {myRole}
                  </span>
                </div>
              </div>

              {isGM && (
                <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                  {liveSession && (
                    <button className="btn-primary" onClick={() => joinLiveSession(liveSession.id)}>
                      ▶ Join Session
                    </button>
                  )}
                  <button
                    className={liveSession ? 'btn-ghost' : 'btn-primary'}
                    onClick={() => startSessionMutation.mutate()}
                    disabled={startSessionMutation.isPending}
                  >
                    {startSessionMutation.isPending
                      ? 'Starting...'
                      : liveSession
                        ? 'Start New Session'
                        : '▶ Start Session'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="gold-divider mb-8" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Members list */}
          <div className="md:col-span-2">
            <h2
              className="font-display text-base font-semibold tracking-wider mb-4"
              style={{ color: 'var(--color-accent-gold)' }}
            >
              Members
            </h2>
            <div className="space-y-2">
              {(campaign.members as MemberWithUser[]).map((member) => (
                <div
                  key={member.id}
                  className="flex items-center gap-3 rounded-md p-3"
                  style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-ui font-semibold shrink-0"
                    style={{ background: 'var(--color-bg-primary)', color: 'var(--color-accent-gold)' }}
                  >
                    {member.user.username.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-ui text-sm flex-1" style={{ color: 'var(--color-text-primary)' }}>
                    {member.user.username}
                  </span>
                  <span className={member.role === 'GM' ? 'badge-role-gm' : 'badge-role-player'}>
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Invite panel (GM only) */}
          {isGM && id && (
            <div className="space-y-4">
              <InvitePanel campaignId={id} />
              <DdbLinkPanelEmbedded />
            </div>
          )}
        </div>

        {isGM && (
          <>
            <div className="gold-divider my-10" />
            <section
              className="rounded-lg p-5"
              style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
            >
              <h2
                className="font-display text-base font-semibold tracking-wider mb-2"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Danger zone
              </h2>
              <p className="font-ui text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                Permanently delete this campaign and all of its scenes, maps, sessions, and member links.
              </p>
              <button
                type="button"
                className="btn-danger"
                onClick={handleDeleteCampaign}
                disabled={deleteCampaignMutation.isPending}
              >
                {deleteCampaignMutation.isPending ? 'Deleting...' : 'Delete Campaign'}
              </button>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
