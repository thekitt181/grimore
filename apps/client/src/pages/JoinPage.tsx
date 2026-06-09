import { useParams } from 'react-router-dom';
import { JoinCampaignModal } from '@/components/campaign/JoinCampaignModal';
import { useNavigate } from 'react-router-dom';

/**
 * Landing page for invite links: /join/:code
 * Automatically prefills the code in the join modal.
 */
export function JoinPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--color-bg-primary)' }}
    >
      <JoinCampaignModal
        prefillCode={code ?? ''}
        onClose={() => navigate('/')}
      />
    </div>
  );
}
