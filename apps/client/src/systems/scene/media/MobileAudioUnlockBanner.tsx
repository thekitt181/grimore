import { useEffect, useState } from 'react';
import { isMobileClient } from '@/lib/socket';
import { useSceneMediaStore } from './sceneMediaStore';
import { isEmbedUrl } from './mediaEmbed';
import { installAudioUnlock, isAudioContextSuspended, resumeAudioContext } from './audioUnlock';
import { replayActiveSceneMedia } from './useSceneMedia';

function sessionHasDirectAudio(): boolean {
  const scene = useSceneMediaStore.getState().activeScene;
  if (!scene) return false;
  const cfg = scene.mediaConfig;
  const hasAmbient = cfg.ambientLayers.some((l) => !isEmbedUrl(l.url));
  const hasMusic = cfg.musicPlaylist.some((t) => !isEmbedUrl(t.url));
  return hasAmbient || hasMusic || Boolean(scene.ambientAudioUrl);
}

/** Mobile browsers block autoplay until the user taps — show a one-tap unlock. */
export function MobileAudioUnlockBanner() {
  const activeScene = useSceneMediaStore((s) => s.activeScene);
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    installAudioUnlock();
  }, []);

  useEffect(() => {
    if (!isMobileClient() || !activeScene || !sessionHasDirectAudio()) {
      setNeedsTap(false);
      return;
    }
    setNeedsTap(isAudioContextSuspended());
  }, [activeScene]);

  if (!needsTap) return null;

  return (
    <button
      type="button"
      className="fixed bottom-20 left-1/2 z-[10000] -translate-x-1/2 btn-primary text-sm px-4 py-2 shadow-panel"
      onClick={() => {
        void resumeAudioContext().then(() => {
          replayActiveSceneMedia();
          setNeedsTap(isAudioContextSuspended());
        });
      }}
    >
      Tap to enable session audio
    </button>
  );
}
