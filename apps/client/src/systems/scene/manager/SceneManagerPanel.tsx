import { DraggablePanel } from '@/components/DraggablePanel';
import { useSessionStore } from '@/store/sessionStore';
import { emitSceneChange } from '../media/useSceneMedia';
import { SceneManager } from './SceneManager';

export function SceneManagerPanel({ onClose }: { onClose: () => void }) {
  const campaignId = useSessionStore((s) => s.campaignId);
  const sessionId = useSessionStore((s) => s.sessionId);
  const myRole = useSessionStore((s) => s.myRole);
  const isGM = myRole === 'GM';

  if (!campaignId || !isGM) return null;

  return (
    <DraggablePanel
      title="Scene Manager"
      subtitle="Maps, ambience, lighting & weather"
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, (window.innerWidth - 640) / 2), y: 56 }}
      width={640}
      maxHeight="calc(100vh - 80px)"
      zIndex={145}
    >
      <div className="p-4 overflow-y-auto">
        <SceneManager
          campaignId={campaignId}
          isGM={isGM}
          liveSessionId={sessionId}
          onSceneActivated={(scene, transition) => {
            if (sessionId) emitSceneChange(sessionId, scene, transition);
          }}
        />
      </div>
    </DraggablePanel>
  );
}
