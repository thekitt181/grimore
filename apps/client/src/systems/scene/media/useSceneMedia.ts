import { useEffect, useRef } from 'react';
import type { GameTime, SceneChangePayload, SceneRecord, SceneMediaConfig, TimeOfDay, WeatherOverlay } from '@grimoire/shared';
import {
  DEFAULT_GAME_TIME,
  DEFAULT_SCENE_MEDIA_CONFIG,
  gameTimeToTimeOfDay,
  normalizeGameTime,
  TIME_OF_DAY_TO_GAME_TIME,
} from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import {
  applySceneMediaConfig,
  disposeMediaEngine,
  setAmbientMuted,
  setMediaMasterVolume,
  setMusicMuted,
} from './audioEngine';
import { useSceneMediaStore, normalizeWeatherOverlay } from './sceneMediaStore';
import { hydrateSceneMap } from '../manager/hydrateSceneMap';

export const SESSION_WEATHER_SCENE_ID = 'session-live-weather';
export const SESSION_TIME_SCENE_ID = 'session-live-time';
export const SESSION_GAME_TIME_SCENE_ID = 'session-live-game-time';
export const SESSION_MEDIA_SCENE_ID = 'session-live-media';

function resolveGameTime(scene: SceneRecord): GameTime {
  if (scene.gameTime) return normalizeGameTime(scene.gameTime);
  if (scene.timeOfDay) return TIME_OF_DAY_TO_GAME_TIME[scene.timeOfDay];
  return DEFAULT_GAME_TIME;
}

function gameTimeKey(time: GameTime | null | undefined): string {
  if (!time) return '';
  return `${time.hour}:${time.minute}`;
}

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
    gameTime: DEFAULT_GAME_TIME,
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
    && gameTimeKey(prev.gameTime) === gameTimeKey(next.gameTime)
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
    && (prev.weatherOverlay !== next.weatherOverlay
      || prev.timeOfDay !== next.timeOfDay
      || gameTimeKey(prev.gameTime) !== gameTimeKey(next.gameTime))
  );
}

function applyAtmosphere(scene: SceneRecord) {
  const weather = normalizeWeatherOverlay(scene.weatherOverlay);
  useSceneMediaStore.getState().setWeatherOverlay(weather);
  const gameTime = resolveGameTime(scene);
  const timeOfDay = scene.timeOfDay ?? gameTimeToTimeOfDay(gameTime);
  useSceneMediaStore.getState().setGameTime(gameTime);
  useSceneMediaStore.getState().setTimeOfDay(timeOfDay);
  useSceneMediaStore.getState().setTransitioning(false);
}

function stripWeatherAmbientLayers(cfg: SceneMediaConfig): SceneMediaConfig {
  const ambientLayers = cfg.ambientLayers.filter((l) => !l.id.startsWith('weather-'));
  if (ambientLayers.length === cfg.ambientLayers.length) return cfg;
  return { ...cfg, ambientLayers };
}

function buildMediaConfig(scene: SceneRecord): SceneMediaConfig {
  const cfg = stripWeatherAmbientLayers(scene.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG);
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
        applyAtmosphere(payload.scene);
        useSceneMediaStore.getState().setActiveScene(payload.scene, 'none');
        return;
      }
      if (payload.scene.id === SESSION_TIME_SCENE_ID) {
        applyAtmosphere(payload.scene);
        useSceneMediaStore.getState().setActiveScene(payload.scene, 'none');
        return;
      }
      if (payload.scene.id === SESSION_GAME_TIME_SCENE_ID) {
        applyAtmosphere(payload.scene);
        useSceneMediaStore.getState().setActiveScene(payload.scene, 'none');
        return;
      }
      if (prev && isAtmosphereOnlyPatch(prev, payload.scene)) {
        applyAtmosphere(payload.scene);
        useSceneMediaStore.getState().setActiveScene(payload.scene, 'none');
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

/** Push map weather live to all clients (right-click map menu). Visual only — no auto audio. */
export function emitSessionWeather(sessionId: string, weather: WeatherOverlay) {
  const normalized = weather === 'none' ? null : weather;
  const active = useSceneMediaStore.getState().activeScene;
  const campaignId = useSessionStore.getState().campaignId ?? 'local';
  const prevCfg = active?.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG;
  const mediaConfig = stripWeatherAmbientLayers(prevCfg);
  const strippedWeatherAudio =
    mediaConfig.ambientLayers.length !== prevCfg.ambientLayers.length;

  if (active) {
    const scene = { ...active, weatherOverlay: normalized, mediaConfig };
    useSceneMediaStore.getState().setActiveScene(scene, 'none');
    applyAtmosphere(scene);
    if (strippedWeatherAudio) {
      applySceneMediaConfig(buildMediaConfig(scene));
    }
    getSocket().emit('scene:change', {
      sessionId,
      sceneId: scene.id,
      transition: 'none',
      scene,
    });
    return;
  }

  const scene = createSessionWeatherScene(campaignId, normalized);
  useSceneMediaStore.getState().setActiveScene(scene, 'none');
  applyAtmosphere(scene);
  getSocket().emit('scene:change', {
    sessionId,
    sceneId: scene.id,
    transition: 'none',
    scene,
  });
}

/** Push in-game clock live to all clients; map lighting follows the hour. */
export function emitSessionGameTime(sessionId: string, gameTime: GameTime) {
  const normalized = normalizeGameTime(gameTime);
  const timeOfDay = gameTimeToTimeOfDay(normalized);
  const active = useSceneMediaStore.getState().activeScene;
  const campaignId = useSessionStore.getState().campaignId ?? 'local';

  if (active) {
    const scene = { ...active, gameTime: normalized, timeOfDay };
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

  const scene = createSessionLiveScene(SESSION_GAME_TIME_SCENE_ID, 'Map clock', campaignId, {
    gameTime: normalized,
    timeOfDay,
  });
  applyAtmosphere(scene);
  useSceneMediaStore.getState().setActiveScene(scene, 'none');
  getSocket().emit('scene:change', {
    sessionId,
    sceneId: scene.id,
    transition: 'none',
    scene,
  });
}

/** Push map time-of-day preset — sets clock to a typical hour for that mood. */
export function emitSessionTimeOfDay(sessionId: string, timeOfDay: TimeOfDay) {
  emitSessionGameTime(sessionId, TIME_OF_DAY_TO_GAME_TIME[timeOfDay]);
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
