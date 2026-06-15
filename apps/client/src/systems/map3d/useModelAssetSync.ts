import { useEffect, useRef } from 'react';
import type {
  ModelAssetChunkPayload,
  ModelAssetRequestPayload,
} from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import {
  hasModelAsset,
  importModelAssetBlob,
  isGrimoireModelRef,
  parseGrimoireModelRef,
  resolveModelAssetUrl,
} from '@/lib/modelAssetStore';
import type { Item } from '@/systems/scene/types';

const CHUNK_BYTES = 384_000;
const pendingRequests = new Set<string>();
const inflightAssembly = new Map<
  string,
  {
    chunks: string[];
    total: number;
    format: 'glb' | 'gltf' | 'stl';
    sessionId: string;
    itemId: string;
  }
>();

function collectModelUrls(items: Item[]): string[] {
  const urls = new Set<string>();
  for (const item of items) {
    const url = item.type === 'map' || item.type === 'token' ? item.modelUrl : null;
    if (url && isGrimoireModelRef(url)) urls.add(url);
  }
  return [...urls];
}

async function requestMissingModels(
  sessionId: string,
  items: Item[],
  requesterId: string,
): Promise<void> {
  const socket = getSocket();
  if (!socket.connected || !requesterId) return;

  for (const modelUrl of collectModelUrls(items)) {
    if (pendingRequests.has(modelUrl)) continue;
    const has = await hasModelAsset(modelUrl);
    if (has) continue;
    const parsed = parseGrimoireModelRef(modelUrl);
    if (!parsed) continue;
    const [, itemId] = parsed.key.split(':');
    if (!itemId) continue;

    pendingRequests.add(modelUrl);
    socket.emit('model:request', {
      sessionId,
      itemId,
      modelUrl,
      requesterId,
    } satisfies ModelAssetRequestPayload);
  }
}

async function sendModelToRequester(
  sessionId: string,
  itemId: string,
  modelUrl: string,
  targetUserId: string,
): Promise<void> {
  const parsed = parseGrimoireModelRef(modelUrl);
  if (!parsed) return;
  const has = await hasModelAsset(modelUrl);
  if (!has) return;

  const blobUrl = await resolveModelAssetUrl(modelUrl);
  try {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const totalChunks = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
    const socket = getSocket();

    for (let i = 0; i < totalChunks; i++) {
      const slice = bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES);
      let binary = '';
      for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]!);
      socket.emit('model:chunk', {
        sessionId,
        itemId,
        format: parsed.format,
        chunkIndex: i,
        totalChunks,
        data: btoa(binary),
        targetUserId,
      } satisfies ModelAssetChunkPayload);
    }
  } finally {
    if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
  }
}

function onModelChunk(payload: ModelAssetChunkPayload, myUserId: string): void {
  if (payload.targetUserId && payload.targetUserId !== myUserId) return;

  const key = `${payload.sessionId}:${payload.itemId}:${payload.totalChunks}`;
  let assembly = inflightAssembly.get(key);
  if (!assembly) {
    assembly = {
      chunks: new Array(payload.totalChunks).fill(''),
      total: payload.totalChunks,
      format: payload.format,
      sessionId: payload.sessionId,
      itemId: payload.itemId,
    };
    inflightAssembly.set(key, assembly);
  }

  assembly.chunks[payload.chunkIndex] = payload.data;
  if (assembly.chunks.some((c) => !c)) return;

  inflightAssembly.delete(key);
  const raw = atob(assembly.chunks.join(''));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  const { sessionId, itemId, format } = assembly;
  void importModelAssetBlob(sessionId, itemId, format, new Blob([bytes])).then((ref) => {
    pendingRequests.delete(ref);
    window.dispatchEvent(
      new CustomEvent('grimoire:model-asset-ready', { detail: { itemId } }),
    );
  });
}

/** Relay 3D model blobs from GM IndexedDB to players missing grimoire-model:// assets. */
export function useModelAssetSync(
  sessionId: string | null,
  items: Item[],
  myRole: string | null,
  myUserId: string | null,
): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sessionId || !myUserId) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void requestMissingModels(sessionId, items, myUserId);
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sessionId, items, myUserId]);

  useEffect(() => {
    if (!sessionId || !myUserId) return;

    const socket = getSocket();
    const onRequest = (payload: ModelAssetRequestPayload) => {
      if (payload.sessionId !== sessionId || myRole !== 'GM') return;
      void sendModelToRequester(sessionId, payload.itemId, payload.modelUrl, payload.requesterId);
    };
    const onChunk = (payload: ModelAssetChunkPayload) => {
      if (payload.sessionId !== sessionId) return;
      onModelChunk(payload, myUserId);
    };

    socket.on('model:request', onRequest);
    socket.on('model:chunk', onChunk);
    return () => {
      socket.off('model:request', onRequest);
      socket.off('model:chunk', onChunk);
    };
  }, [sessionId, myRole, myUserId]);
}
