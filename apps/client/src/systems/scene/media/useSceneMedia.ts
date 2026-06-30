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
import { useItemStore } from '../store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { applyFogData } from '../fogSync';
import { emitItemsSync } from '../sceneSync';
import { installAudioUnlock } from './audioUnlock';

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
    items: [],
    activeMapId: null,
    fogData: null,
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

export function applySceneMediaOnly(scene: SceneRecord) {
  const prev = useSceneMediaStore.getState().activeScene;
  const merged: SceneRecord = prev && !isEphemeralLiveScene(prev)
    ? {
        ...prev,
        ambientAudioUrl: scene.ambientAudioUrl,
        backgroundVideoUrl: scene.backgroundVideoUrl,
        lightingPreset: scene.lightingPreset,
        mediaConfig: scene.mediaConfig,
        weatherOverlay: scene.weatherOverlay ?? prev.weatherOverlay ?? null,
        timeOfDay: scene.timeOfDay ?? prev.timeOfDay ?? null,
        gameTime: scene.gameTime ?? prev.gameTime ?? null,
      }
    : scene;
  useSceneMediaStore.getState().setActiveScene(merged, 'none');
  applyAtmosphere(merged);
  const media = buildMediaConfig(merged);
  useSceneMediaStore.getState().setMasterVolume(media.masterVolume);
  applySceneMediaConfig(media);
  useSceneMediaStore.getState().setTransitioning(false);
}

/** Re-apply Howler layers (e.g. after mobile audio unlock). */
export function replayActiveSceneMedia(): void {
  const scene = useSceneMediaStore.getState().activeScene;
  if (!scene) return;
  applySceneMediaConfig(buildMediaConfig(scene));
}

function isEphemeralLiveScene(scene: SceneRecord): boolean {
  return scene.id.startsWith('session-live-');
}

export function applySceneBundle(scene: SceneRecord, transition: SceneChangePayload['transition'] = 'fade') {
  useSceneMediaStore.getState().setActiveScene(scene, transition);
  applyAtmosphere(scene);
  const media = buildMediaConfig(scene);
  useSceneMediaStore.getState().setMasterVolume(media.masterVolume);
  applySceneMediaConfig(media);

  // Live media/weather patches carry empty items[] — never wipe the map with those.
  if (!isEphemeralLiveScene(scene)) {
    if (Array.isArray(scene.items)) {
      useItemStore.getState().setItems(scene.items as any[], scene.activeMapId);
    }
    if (scene.fogData) {
      const fogJson = typeof scene.fogData === 'string'
        ? scene.fogData
        : JSON.stringify(scene.fogData);
      applyFogData(fogJson, { persist: true });
    }
  } else {
    useSceneMediaStore.getState().setTransitioning(false);
  }
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
        applySceneMediaOnly(payload.scene);
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

  useEffect(() => {
    installAudioUnlock();
  }, []);
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
  
  // If GM, also sync items and fog to all clients
  if (useSessionStore.getState().myRole === 'GM') {
    emitItemsSync(scene.items as any[]);
    if (scene.fogData) {
      const fogJson = typeof scene.fogData === 'string' 
        ? scene.fogData 
        : JSON.stringify(scene.fogData);
      getSocket().emit('fog:sync', { sessionId, fogData: fogJson });
    }
  }
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

const MAX_INLINE_MEDIA_URL_CHARS = 512_000;

function stripOversizedInlineMediaUrl(url: string | null | undefined): string | null | undefined {
  if (url?.startsWith('data:') && url.length > MAX_INLINE_MEDIA_URL_CHARS) {
    console.warn('[Media] Refusing to sync oversized inline file — upload via Media → Upload instead.');
    return null;
  }
  return url;
}

function sanitizeMediaPatch(patch: SessionMediaPatch): SessionMediaPatch {
  const out: SessionMediaPatch = { ...patch };
  if ('ambientAudioUrl' in out) {
    out.ambientAudioUrl = stripOversizedInlineMediaUrl(out.ambientAudioUrl) ?? null;
  }
  if ('backgroundVideoUrl' in out) {
    out.backgroundVideoUrl = stripOversizedInlineMediaUrl(out.backgroundVideoUrl) ?? null;
  }
  if (out.mediaConfig) {
    const cfg = { ...out.mediaConfig };
    if (cfg.videoPopup?.url) {
      const url = stripOversizedInlineMediaUrl(cfg.videoPopup.url);
      cfg.videoPopup = url ? { ...cfg.videoPopup, url } : null;
    }
    if (cfg.ambientLayers) {
      cfg.ambientLayers = cfg.ambientLayers
        .map((layer) => {
          const url = stripOversizedInlineMediaUrl(layer.url);
          return url ? { ...layer, url } : null;
        })
        .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer));
    }
    if (cfg.musicPlaylist) {
      cfg.musicPlaylist = cfg.musicPlaylist
        .map((track) => {
          const url = stripOversizedInlineMediaUrl(track.url);
          return url ? { ...track, url } : null;
        })
        .filter((track): track is NonNullable<typeof track> => Boolean(track));
    }
    out.mediaConfig = cfg;
  }
  return out;
}

/** Push audio/video/lighting changes live without switching maps. */
export function emitSessionMediaPatch(sessionId: string, patch: SessionMediaPatch) {
  const safePatch = sanitizeMediaPatch(patch);
  const active = useSceneMediaStore.getState().activeScene;
  const campaignId = useSessionStore.getState().campaignId ?? 'local';

  const mergedMediaConfig = safePatch.mediaConfig
    ? { ...(active?.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG), ...safePatch.mediaConfig }
    : active?.mediaConfig;

  const merged: SceneRecord = active
    ? {
        ...active,
        ...safePatch,
        ...(mergedMediaConfig ? { mediaConfig: mergedMediaConfig } : {}),
      }
    : createSessionMediaScene(campaignId, {
        ...safePatch,
        ...(mergedMediaConfig ? { mediaConfig: mergedMediaConfig } : {}),
      });

  const syncScene = createSessionMediaScene(campaignId, {
    ambientAudioUrl: merged.ambientAudioUrl,
    backgroundVideoUrl: merged.backgroundVideoUrl,
    lightingPreset: merged.lightingPreset,
    weatherOverlay: merged.weatherOverlay,
    timeOfDay: merged.timeOfDay ?? null,
    gameTime: merged.gameTime ?? null,
    mediaConfig: merged.mediaConfig,
  });

  applySceneMediaOnly(syncScene);
  getSocket().emit('scene:change', {
    sessionId,
    sceneId: syncScene.id,
    transition: 'none',
    scene: syncScene,
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
