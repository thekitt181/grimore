import { useNavigate } from 'react-router-dom';
import type { CampaignWithMembers } from '@grimoire/shared';
import { clsx } from 'clsx';

interface CampaignCardProps {
  campaign: CampaignWithMembers & { myRole?: string };
}

export function CampaignCard({ campaign }: CampaignCardProps) {
  const navigate = useNavigate();
  const isGM = campaign.myRole === 'GM';

  return (
    <div
      onClick={() => navigate(`/campaigns/${campaign.id}`)}
      className={clsx(
        'group relative cursor-pointer rounded-lg overflow-hidden transition-all duration-300',
        'border hover:shadow-gold hover:-translate-y-0.5'
      )}
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}
    >
      {/* Cover image or placeholder */}
      <div
        className="h-36 relative overflow-hidden"
        style={{ background: 'var(--color-bg-tertiary)' }}
      >
        {campaign.coverImageUrl ? (
          <img
            src={campaign.coverImageUrl}
            alt={campaign.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl opacity-30">🐉</span>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-secondary/90 to-transparent" />

        {/* Role badge */}
        <div className="absolute top-3 right-3">
          <span className={isGM ? 'badge-role-gm' : 'badge-role-player'}>
            {isGM ? 'GM' : 'Player'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3
          className="font-display text-base font-semibold tracking-wide mb-1 truncate"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {campaign.name}
        </h3>

        {campaign.description && (
          <p
            className="font-body text-sm mb-3 line-clamp-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {campaign.description}
          </p>
        )}

        <div className="gold-divider mb-3" />

        <div className="flex items-center justify-between font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <span>{campaign._count?.members ?? 0} members</span>
          <span>{campaign._count?.scenes ?? 0} scenes</span>
          <span>{campaign.system}</span>
        </div>
      </div>
    </div>
  );
}
