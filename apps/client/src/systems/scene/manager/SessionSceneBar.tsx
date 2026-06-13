import { useQuery } from '@tanstack/react-query';
import type { SceneRecord, SceneTransition } from '@grimoire/shared';
import { SCENE_TRANSITIONS } from '@grimoire/shared';
import { fetchCampaignScenes, activateScene } from './sceneApi';
import { emitSceneChange } from '../media/useSceneMedia';

interface SessionSceneBarProps {
  campaignId: string;
  sessionId: string;
  isGM: boolean;
}

export function SessionSceneBar({ campaignId, sessionId, isGM }: SessionSceneBarProps) {
  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', campaignId],
    queryFn: () => fetchCampaignScenes(campaignId),
    enabled: isGM && Boolean(campaignId),
  });

  if (!isGM || scenes.length === 0) return null;

  async function go(scene: SceneRecord, transition: SceneTransition) {
    const result = await activateScene(scene.id, sessionId, transition);
    emitSceneChange(sessionId, result.scene, result.transition);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-ui text-xs uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
        Scenes
      </span>
      {scenes.map((scene) => (
        <div key={scene.id} className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost text-xs py-0.5 px-2"
            onClick={() => void go(scene, 'fade')}
            title={SCENE_TRANSITIONS.map((t) => t.label).join(' / ')}
          >
            {scene.name}
          </button>
        </div>
      ))}
    </div>
  );
}
