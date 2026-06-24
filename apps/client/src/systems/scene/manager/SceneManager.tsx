import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SceneRecord, SceneTransition } from '@grimoire/shared';
import {
  gameTimeToInputValue,
  gameTimeToTimeOfDay,
  LIGHTING_PRESETS,
  normalizeGameTime,
  SCENE_TRANSITIONS,
  TIME_OF_DAY_PRESETS,
  TIME_OF_DAY_TO_GAME_TIME,
  WEATHER_PRESETS,
} from '@grimoire/shared';
import { fileToDataUrl } from '@/lib/imagePersistence';
import {
  activateScene,
  createCampaignMap,
  createScene,
  deleteScene,
  fetchCampaignMaps,
  fetchCampaignScenes,
  updateScene,
} from './sceneApi';
import { useItemStore } from '../store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';

interface SceneManagerProps {
  campaignId: string;
  isGM: boolean;
  /** When set, show "Go to scene" for live session. */
  liveSessionId?: string | null;
  onSceneActivated?: (scene: SceneRecord, transition: SceneTransition) => void;
}

export function SceneManager({ campaignId, isGM, liveSessionId, onSceneActivated }: SceneManagerProps) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const scenesQ = useQuery({
    queryKey: ['scenes', campaignId],
    queryFn: () => fetchCampaignScenes(campaignId),
    enabled: Boolean(campaignId),
  });
  const mapsQ = useQuery({
    queryKey: ['campaign-maps', campaignId],
    queryFn: () => fetchCampaignMaps(campaignId),
    enabled: Boolean(campaignId) && isGM,
  });

  const createMut = useMutation({
    mutationFn: () => createScene(campaignId, { name: draftName || 'New Scene' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', campaignId] });
      setDraftName('');
      setMessage('Scene created');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteScene(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scenes', campaignId] }),
  });

  const activateMut = useMutation({
    mutationFn: ({ sceneId, transition }: { sceneId: string; transition: SceneTransition }) =>
      activateScene(sceneId, liveSessionId!, transition),
    onSuccess: (data) => {
      onSceneActivated?.(data.scene, data.transition);
      setMessage(`Activated "${data.scene.name}"`);
    },
  });
  
  const saveCurrentToSceneMut = useMutation({
    mutationFn: async (sceneId: string) => {
      const { items, activeMapId } = useItemStore.getState();
      const { revealedCells } = useMapStore.getState();
      return updateScene(sceneId, {
        items: Object.values(items),
        activeMapId,
        fogData: [...revealedCells],
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scenes', campaignId] });
      setMessage('Scene saved');
    },
  });

  async function handleMapUpload(file: File, scene: SceneRecord) {
    const imageUrl = await fileToDataUrl(file);
    const map = await createCampaignMap(campaignId, {
      name: `${scene.name} Map`,
      imageUrl,
      width: 2560,
      height: 1920,
    });
    await updateScene(scene.id, { mapId: map.id });
    void qc.invalidateQueries({ queryKey: ['scenes', campaignId] });
    void qc.invalidateQueries({ queryKey: ['campaign-maps', campaignId] });
  }

  async function setSceneField(scene: SceneRecord, patch: Parameters<typeof updateScene>[1]) {
    await updateScene(scene.id, patch);
    void qc.invalidateQueries({ queryKey: ['scenes', campaignId] });
  }

  if (!isGM) {
    return (
      <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {scenesQ.data?.length ?? 0} scenes prepared for this campaign.
      </p>
    );
  }

  const scenes = scenesQ.data ?? [];
  const maps = mapsQ.data ?? [];

  return (
    <div className="space-y-4">
      {message && (
        <p className="font-ui text-xs" style={{ color: 'var(--color-accent-gold)' }}>{message}</p>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <input
          className="input flex-1 min-w-[160px]"
          placeholder="New scene name…"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <button type="button" className="btn-primary" onClick={() => createMut.mutate()} disabled={createMut.isPending}>
          + Add Scene
        </button>
      </div>

      <div className="space-y-3">
        {scenes.map((scene) => (
          <details
            key={scene.id}
            className="rounded-lg p-4"
            style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
            open={editingId === scene.id}
            onToggle={(e) => setEditingId((e.target as HTMLDetailsElement).open ? scene.id : null)}
          >
            <summary className="cursor-pointer font-display font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              {scene.name}
              {scene.map ? ` · ${scene.map.name}` : ''}
            </summary>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="font-ui text-xs block">
                Name
                <input
                  className="input mt-1 w-full"
                  defaultValue={scene.name}
                  onBlur={(e) => {
                    if (e.target.value !== scene.name) void setSceneField(scene, { name: e.target.value });
                  }}
                />
              </label>

              <label className="font-ui text-xs block">
                Linked map
                <select
                  className="input mt-1 w-full"
                  value={scene.mapId ?? ''}
                  onChange={(e) => void setSceneField(scene, { mapId: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {maps.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>

              <label className="font-ui text-xs block">
                Lighting
                <select
                  className="input mt-1 w-full"
                  value={scene.lightingPreset}
                  onChange={(e) => void setSceneField(scene, { lightingPreset: e.target.value as SceneRecord['lightingPreset'] })}
                >
                  {LIGHTING_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="font-ui text-xs block">
                Weather
                <select
                  className="input mt-1 w-full"
                  value={scene.weatherOverlay ?? 'none'}
                  onChange={(e) => {
                    const raw = e.target.value as SceneRecord['weatherOverlay'];
                    void setSceneField(scene, {
                      weatherOverlay: raw === 'none' ? null : raw,
                    });
                  }}
                >
                  {WEATHER_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="font-ui text-xs block">
                In-game time
                <input
                  type="time"
                  className="input mt-1 w-full tabular-nums"
                  value={gameTimeToInputValue(scene.gameTime ?? { hour: 12, minute: 0 })}
                  onChange={(e) => {
                    const [hRaw, mRaw] = e.target.value.split(':');
                    const h = Number(hRaw);
                    const m = Number(mRaw);
                    if (Number.isFinite(h) && Number.isFinite(m)) {
                      const gameTime = normalizeGameTime({ hour: h, minute: m });
                      void setSceneField(scene, {
                        gameTime,
                        timeOfDay: gameTimeToTimeOfDay(gameTime),
                      });
                    }
                  }}
                />
              </label>

              <label className="font-ui text-xs block">
                Time of day
                <select
                  className="input mt-1 w-full"
                  value={scene.timeOfDay ?? 'day'}
                  onChange={(e) => {
                    const timeOfDay = e.target.value as NonNullable<SceneRecord['timeOfDay']>;
                    void setSceneField(scene, {
                      timeOfDay,
                      gameTime: TIME_OF_DAY_TO_GAME_TIME[timeOfDay],
                    });
                  }}
                >
                  {TIME_OF_DAY_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="font-ui text-xs block md:col-span-2">
                Background video URL
                <input
                  className="input mt-1 w-full"
                  defaultValue={scene.backgroundVideoUrl ?? ''}
                  placeholder="https://… or use Upload during a live session"
                  onBlur={(e) => void setSceneField(scene, { backgroundVideoUrl: e.target.value || null })}
                />
              </label>

              <p className="font-ui text-xs md:col-span-2" style={{ color: 'var(--color-text-secondary)' }}>
                Video, ambient audio, and music are added via the live session Upload menu — paste a URL or pick a file.
              </p>

              <label className="font-ui text-xs block md:col-span-2">
                Upload map image
                <input
                  type="file"
                  accept="image/*"
                  className="mt-1 block w-full text-xs"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleMapUpload(f, scene);
                  }}
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {liveSessionId && (
                <>
                  {SCENE_TRANSITIONS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="btn-primary text-xs"
                      disabled={activateMut.isPending}
                      onClick={() => activateMut.mutate({ sceneId: scene.id, transition: t.id })}
                    >
                      Go · {t.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    disabled={saveCurrentToSceneMut.isPending}
                    onClick={() => saveCurrentToSceneMut.mutate(scene.id)}
                  >
                    Save current
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn-danger text-xs ml-auto"
                onClick={() => {
                  if (window.confirm(`Delete scene "${scene.name}"?`)) deleteMut.mutate(scene.id);
                }}
              >
                Delete
              </button>
            </div>
          </details>
        ))}
      </div>

      {scenes.length === 0 && (
        <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          No scenes yet. Scenes hold your map, ambience, video pop-ups, lighting, and weather — like Foundry scenes.
        </p>
      )}
    </div>
  );
}
