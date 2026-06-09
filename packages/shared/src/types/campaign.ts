export interface Campaign {
  id: string;
  name: string;
  description?: string;
  coverImageUrl?: string;
  system: string;
  inviteCode: string;
  gmId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CampaignMember {
  id: string;
  campaignId: string;
  userId: string;
  role: 'GM' | 'PLAYER';
  joinedAt: Date;
}

export interface CreateCampaignPayload {
  name: string;
  description?: string;
  coverImageUrl?: string;
  system?: string;
}

/** Minimal live-session info for campaign list/detail and join redirects. */
export interface ActiveSessionSummary {
  id: string;
  startedAt: Date;
  isActive: boolean;
}

export interface CampaignWithMembers extends Campaign {
  members: CampaignMember[];
  _count: {
    members: number;
    scenes: number;
  };
  activeSession?: ActiveSessionSummary | null;
}
