import { create } from 'zustand';
import type { CampaignWithMembers } from '@grimoire/shared';

interface CampaignState {
  campaigns: CampaignWithMembers[];
  activeCampaign: CampaignWithMembers | null;
  isLoading: boolean;
  setCampaigns: (campaigns: CampaignWithMembers[]) => void;
  setActiveCampaign: (campaign: CampaignWithMembers | null) => void;
  setLoading: (loading: boolean) => void;
  addCampaign: (campaign: CampaignWithMembers) => void;
}

export const useCampaignStore = create<CampaignState>((set) => ({
  campaigns: [],
  activeCampaign: null,
  isLoading: false,
  setCampaigns: (campaigns) => set({ campaigns }),
  setActiveCampaign: (activeCampaign) => set({ activeCampaign }),
  setLoading: (isLoading) => set({ isLoading }),
  addCampaign: (campaign) =>
    set((state) => ({ campaigns: [campaign, ...state.campaigns] })),
}));
