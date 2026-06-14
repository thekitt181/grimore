import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/axios';

export type CampaignInviteInfo = {
  inviteCode: string;
  inviteUrl: string;
};

export function useCampaignInvite(campaignId: string | null | undefined) {
  return useQuery({
    queryKey: ['campaign-invite', campaignId],
    queryFn: async () => {
      const res = await api.get<CampaignInviteInfo>(`/campaigns/${campaignId}/invite`);
      return res.data;
    },
    enabled: Boolean(campaignId),
    staleTime: 60_000,
  });
}
