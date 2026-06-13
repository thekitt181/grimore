import { useEffect, useRef } from 'react';
import type { SceneChangePayload, SceneRecord, SceneMediaConfig } from '@grimoire/shared';
import { DEFAULT_SCENE_MEDIA_CONFIG } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import {
  applySceneMediaConfig,
  disposeMediaEngine,
  setAmbientMuted,
  setMediaMasterVolume,
  setMusicMuted,
} from './audioEngine';
import { useSceneMediaStore } from './sceneMediaStore';
import { hydrateSceneMap } from '../manager/hydrateSceneMap';

function buildMediaConfig(scene: SceneRecord): SceneMediaConfig {
  const cfg = scene.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG;
  const layers = [...cfg.ambientLayers];
  if (scene.ambientAudioUrl && !layers.some((l) => l.url === scene.ambientAudioUrl)) {
    layers.unshift({
      id: 'legacy-ambient',
      name: 'Scene Ambient',
      url: scene.ambientAudioUrl,
      volume: 0.6,
      loop: true,
    });
  }
  let videoPopup = cfg.videoPopup ?? null;
  if (scene.backgroundVideoUrl && !videoPopup) {
    videoPopup = {
      url: scene.backgroundVideoUrl,
      loop: true,
      muted: true,
      autoplay: true,
      showAsOverlay: false,
    };
  }
  return {
    ...cfg,
    ambientLayers: layers,
    videoPopup,
    masterVolume: cfg.masterVolume ?? DEFAULT_SCENE_MEDIA_CONFIG.masterVolume,
  };
}

export function applySceneBundle(scene: SceneRecord, transition: SceneChangePayload['transition'] = 'fade') {
  useSceneMediaStore.getState().setActiveScene(scene, transition);
  const media = buildMediaConfig(scene);
  useSceneMediaStore.getState().setMasterVolume(media.masterVolume);
  applySceneMediaConfig(media);
}

/** Listen for scene changes + drive Howler layers. */
export function useSceneMedia(sessionId: string | undefined) {
  const masterVolume = useSceneMediaStore((s) => s.masterVolume);
  const ambientMuted = useSceneMediaStore((s) => s.ambientMuted);
  const musicMuted = useSceneMediaStore((s) => s.musicMuted);
  const transitioning = useSceneMediaStore((s) => s.transitioning);
  const setTransitioning = useSceneMediaStore((s) => s.setTransitioning);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setMediaMasterVolume(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    setAmbientMuted(ambientMuted);
  }, [ambientMuted]);

  useEffect(() => {
    setMusicMuted(musicMuted);
  }, [musicMuted]);

  useEffect(() => {
    if (!transitioning) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setTransitioning(false), 900);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [transitioning, setTransitioning]);

  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();
    const onChange = (payload: SceneChangePayload) => {
      if (payload.sessionId !== sessionId || !payload.scene) return;
      applySceneBundle(payload.scene, payload.transition);
      if (payload.scene.map) hydrateSceneMap(payload.scene, false);
    };
    socket.on('scene:change', onChange);
    return () => {
      socket.off('scene:change', onChange);
    };
  }, [sessionId]);

  useEffect(() => () => disposeMediaEngine(), []);
}

export function emitSceneChange(
  sessionId: string,
  scene: SceneRecord,
  transition: SceneChangePayload['transition'] = 'fade',
  opts?: { hydrateMap?: boolean },
) {
  applySceneBundle(scene, transition);
  if (opts?.hydrateMap !== false && scene.map) {
    hydrateSceneMap(scene, true);
  }
  getSocket().emit('scene:change', {
    sessionId,
    sceneId: scene.id,
    transition,
    scene,
  });
}
