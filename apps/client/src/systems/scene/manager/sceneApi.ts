import { api } from '@/lib/axios';
import type {
  CreateGameMapPayload,
  CreateScenePayload,
  GameMapRecord,
  SceneRecord,
  SceneTransition,
  UpdateScenePayload,
} from '@grimoire/shared';

export async function fetchCampaignScenes(campaignId: string): Promise<SceneRecord[]> {
  const { data } = await api.get<{ scenes: SceneRecord[] }>(`/scenes/campaign/${campaignId}`);
  return data.scenes;
}

export async function fetchCampaignMaps(campaignId: string): Promise<GameMapRecord[]> {
  const { data } = await api.get<{ maps: GameMapRecord[] }>(`/scenes/campaign/${campaignId}/maps`);
  return data.maps;
}

export async function createScene(campaignId: string, payload: CreateScenePayload): Promise<SceneRecord> {
  const { data } = await api.post<{ scene: SceneRecord }>(`/scenes/campaign/${campaignId}`, payload);
  return data.scene;
}

export async function updateScene(sceneId: string, payload: UpdateScenePayload): Promise<SceneRecord> {
  const { data } = await api.patch<{ scene: SceneRecord }>(`/scenes/${sceneId}`, payload);
  return data.scene;
}

export async function deleteScene(sceneId: string): Promise<void> {
  await api.delete(`/scenes/${sceneId}`);
}

export async function createCampaignMap(campaignId: string, payload: CreateGameMapPayload): Promise<GameMapRecord> {
  const { data } = await api.post<{ map: GameMapRecord }>(`/scenes/campaign/${campaignId}/maps`, payload);
  return data.map;
}

export async function activateScene(
  sceneId: string,
  sessionId: string,
  transition: SceneTransition = 'fade',
): Promise<{ scene: SceneRecord; transition: SceneTransition }> {
  const { data } = await api.post<{ scene: SceneRecord; transition: SceneTransition }>(
    `/scenes/${sceneId}/activate`,
    { sessionId, transition },
  );
  return data;
}
