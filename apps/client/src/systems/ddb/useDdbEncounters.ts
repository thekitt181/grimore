import { useQuery } from '@tanstack/react-query';
import { fetchDdbEncounters } from './ddbApi';

export const ddbEncountersQueryKey = (ddbCampaignId: number | null | undefined) =>
  ['ddb', 'encounters', ddbCampaignId] as const;

type UseDdbEncountersOptions = {
  enabled?: boolean;
  /** Poll D&D Beyond while this panel/tab is open (default true). */
  poll?: boolean;
};

export function useDdbEncounters(
  ddbCampaignId: number | null | undefined,
  options: UseDdbEncountersOptions = {},
) {
  const enabled = Boolean(ddbCampaignId) && options.enabled !== false;
  const poll = options.poll !== false;

  return useQuery({
    queryKey: ddbEncountersQueryKey(ddbCampaignId),
    queryFn: () => fetchDdbEncounters(ddbCampaignId!),
    enabled,
    staleTime: 0,
    gcTime: 5 * 60_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: poll ? 30_000 : false,
    refetchIntervalInBackground: false,
  });
}
