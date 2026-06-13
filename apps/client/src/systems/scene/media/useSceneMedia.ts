import { useEffect, useRef } from 'react';
import type { SceneChangePayload, SceneRecord, SceneMediaConfig, SceneAudioLayer, TimeOfDay, WeatherOverlay } from '@grimoire/shared';
import { DEFAULT_SCENE_MEDIA_CONFIG, WEATHER_AMBIENT_LIBRARY, WEATHER_AMBIENT_SOUNDS } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import {
  applySceneMediaConfig,
  disposeMediaEngine,
  setAmbientMuted,
  setMediaMasterVolume,
  setMusicMuted,
} from './audioEngine';
import { useSceneMediaStore } from './sceneMediaStore';
import { hydrateSceneMap } from '../manager/hydrateSceneMap';

export const SESSION_WEATHER_SCENE_ID = 'session-live-weather';
export const SESSION_TIME_SCENE_ID = 'session-live-time';
export const SESSION_MEDIA_SCENE_ID = 'session-live-media';

function createSessionLiveScene(
  id: string,
  name: string,
  campaignId: string,
  patch: Partial<SceneRecord>,
): SceneRecord {
  const now = new Date().toISOString();
  const { mediaConfig: patchMedia, ...rest } = patch;
  return {
    id,
    campaignId,
    name,
    mapId: null,
    ambientAudioUrl: null,
    backgroundVideoUrl: null,
    lightingPreset: 'default',
    weatherOverlay: null,
    timeOfDay: 'day',
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...rest,
    mediaConfig: {
      ...DEFAULT_SCENE_MEDIA_CONFIG,
      ...(patchMedia ?? {}),
    },
  };
}

function createSessionWeatherScene(campaignId: string, weather: WeatherOverlay | null): SceneRecord {
  return createSessionLiveScene(SESSION_WEATHER_SCENE_ID, 'Map weather', campaignId, { weatherOverlay: weather });
}

function createSessionMediaScene(campaignId: string, patch: Partial<SceneRecord>): SceneRecord {
  return createSessionLiveScene(SESSION_MEDIA_SCENE_ID, 'Live media', campaignId, patch);
}

function sceneMediaFingerprint(scene: SceneRecord): string {
  return JSON.stringify({
    ambientAudioUrl: scene.ambientAudioUrl,
    backgroundVideoUrl: scene.backgroundVideoUrl,
    lightingPreset: scene.lightingPreset,
    mediaConfig: scene.mediaConfig,
  });
}

function isMediaOnlyPatch(prev: SceneRecord | null, next: SceneRecord): boolean {
  if (!prev || prev.id !== next.id) return false;
  return (
    prev.weatherOverlay === next.weatherOverlay
    && prev.timeOfDay === next.timeOfDay
    && prev.mapId === next.mapId
    && sceneMediaFingerprint(prev) !== sceneMediaFingerprint(next)
  );
}

function isAtmosphereOnlyPatch(prev: SceneRecord | null, next: SceneRecord): boolean {
  if (!prev || prev.id !== next.id) return false;
  return (
    prev.lightingPreset === next.lightingPreset
    && prev.ambientAudioUrl === next.ambientAudioUrl
    && prev.backgroundVideoUrl === next.backgroundVideoUrl
    && prev.mapId === next.mapId
    && JSON.stringify(prev.mediaConfig) === JSON.stringify(next.mediaConfig)
    && (prev.weatherOverlay !== next.weatherOverlay || prev.timeOfDay !== next.timeOfDay)
  );
}

function applyAtmosphere(scene: SceneRecord) {
  useSceneMediaStore.getState().setWeatherOverlay(scene.weatherOverlay);
  useSceneMediaStore.getState().setTimeOfDay(scene.timeOfDay ?? 'day');
  useSceneMediaStore.getState().setTransitioning(false);
}

function stripWeatherAmbientLayers(cfg: SceneMediaConfig): SceneMediaConfig {
  const ambientLayers = cfg.ambientLayers.filter((l) => !l.id.startsWith('weather-'));
  if (ambientLayers.length === cfg.ambientLayers.length) return cfg;
  return { ...cfg, ambientLayers };
}

function buildWeatherAmbientLayers(weather: WeatherOverlay | null): SceneAudioLayer[] {
  if (!weather || weather === 'none') return [];
  const libraryIds = WEATHER_AMBIENT_LIBRARY[weather] ?? [];
  return libraryIds.flatMap((libraryId) => {
    const entry = WEATHER_AMBIENT_SOUNDS[libraryId];
    if (!entry) return [];
    return [{
      id: `weather-${libraryId}`,
      name: entry.name,
      url: entry.url,
      volume: entry.defaultVolume * 0.75,
      loop: true,
      libraryId: entry.id,
    }];
  });
}

function mergeWeatherAmbientLayers(
  cfg: SceneMediaConfig,
  weather: WeatherOverlay | null,
): SceneMediaConfig {
  const base = stripWeatherAmbientLayers(cfg);
  return {
    ...base,
    ambientLayers: [...base.ambientLayers, ...buildWeatherAmbientLayers(weather)],
  };
}

function buildMediaConfig(scene: SceneRecord): SceneMediaConfig {
  const cfg = mergeWeatherAmbientLayers(
    scene.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG,
    scene.weatherOverlay,
  );
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
  applyAtmosphere(scene);
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
      const prev = useSceneMediaStore.getState().activeScene;
      if (payload.scene.id === SESSION_WEATHER_SCENE_ID) {
        applySceneBundle(payload.scene, 'none');
        return;
      }
      if (payload.scene.id === SESSION_TIME_SCENE_ID) {
        applyAtmosphere(payload.scene);
        useSceneMediaStore.getState().setActiveScene(payload.scene, 'none');
        return;
      }
      if (prev && isAtmosphereOnlyPatch(prev, payload.scene)) {
        applySceneBundle(payload.scene, 'none');
        return;
      }
      if (
        payload.scene.id === SESSION_MEDIA_SCENE_ID
        || (prev && isMediaOnlyPatch(prev, payload.scene))
      ) {
        applySceneBundle(payload.scene, 'none');
        useSceneMediaStore.getState().setTransitioning(false);
        return;
      }
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

/** Push map weather live to all clients (right-click map menu). */
export function emitSessionWeather(sessionId: string, weather: WeatherOverlay) {
  const normalized = weather === 'none' ? null : weather;
  const active = useSceneMediaStore.getState().activeScene;
  const campaignId = useSessionStore.getState().campaignId ?? 'local';
  const baseCfg = active?.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG;
  const mediaConfig = mergeWeatherAmbientLayers(baseCfg, normalized);

  if (active) {
    const scene = { ...active, weatherOverlay: normalized, mediaConfig };
    applySceneBundle(scene, 'none');
    applyAtmosphere(scene);
    getSocket().emit('scene:change', {
      sessionId,
      sceneId: scene.id,
      transition: 'none',
      scene,
    });
    return;
  }

  const scene = createSessionWeatherScene(campaignId, normalized);
  scene.mediaConfig = mediaConfig;
  applySceneBundle(scene, 'none');
  applyAtmosphere(scene);
  getSocket().emit('scene:change', {
    sessionId,
    sceneId: scene.id,
    transition: 'none',
    scene,
  });
}

/** Push map time-of-day live to all clients (right-click map menu / media bar). */
export function emitSessionTimeOfDay(sessionId: string, timeOfDay: TimeOfDay) {
  const active = useSceneMediaStore.getState().activeScene;
  const campaignId = useSessionStore.getState().campaignId ?? 'local';

  if (active) {
    const scene = { ...active, timeOfDay };
    applyAtmosphere(scene);
    useSceneMediaStore.getState().setActiveScene(scene, 'none');
    getSocket().emit('scene:change', {
      sessionId,
      sceneId: scene.id,
      transition: 'none',
      scene,
    });
    return;
  }

  const scene = createSessionLiveScene(SESSION_TIME_SCENE_ID, 'Map time', campaignId, { timeOfDay });
  applyAtmosphere(scene);
  useSceneMediaStore.getState().setActiveScene(scene, 'none');
  getSocket().emit('scene:change', {
    sessionId,
    sceneId: scene.id,
    transition: 'none',
    scene,
  });
}

export type SessionMediaPatch = Partial<
  Pick<SceneRecord, 'ambientAudioUrl' | 'backgroundVideoUrl' | 'lightingPreset' | 'mediaConfig'>
>;

/** Push audio/video/lighting changes live without switching maps. */
export function emitSessionMediaPatch(sessionId: string, patch: SessionMediaPatch) {
  const store = useSceneMediaStore.getState();
  const active = store.activeScene;
  const campaignId = useSessionStore.getState().campaignId ?? 'local';

  const mergedMediaConfig = patch.mediaConfig
    ? { ...(active?.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG), ...patch.mediaConfig }
    : active?.mediaConfig;

  const scene: SceneRecord = active
    ? {
        ...active,
        ...patch,
        ...(mergedMediaConfig ? { mediaConfig: mergedMediaConfig } : {}),
      }
    : createSessionMediaScene(campaignId, {
        ...patch,
        ...(mergedMediaConfig ? { mediaConfig: mergedMediaConfig } : {}),
      });

  applySceneBundle(scene, 'none');
  store.setTransitioning(false);
  getSocket().emit('scene:change', {
    sessionId,
    sceneId: scene.id,
    transition: 'none',
    scene,
  });
}

/** Stop cinema / popup video for all clients (GM skip or clip ended). */
export function emitClearSessionVideo(sessionId: string) {
  const active = useSceneMediaStore.getState().activeScene;
  const cfg = active?.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG;
  emitSessionMediaPatch(sessionId, {
    backgroundVideoUrl: null,
    mediaConfig: { ...cfg, videoPopup: null },
  });
}
