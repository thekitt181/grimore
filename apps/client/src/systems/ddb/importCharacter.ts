import { v4 as uuidv4 } from 'uuid';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd, emitItemUpdate } from '@/systems/scene/sceneSync';
import { snapPoint } from '@/systems/scene/snap';
import type { TokenItem } from '@/systems/scene/types';
import { useSessionStore } from '@/store/sessionStore';
import { importDdbCharacterToken } from './ddbApi';
import { resolveTokenImageUrl } from './ddbImageUrl';

export interface ImportPosition {
  x: number;
  y: number;
}

export async function importCharacterToMap(
  ddbCharacterId: number,
  at?: ImportPosition,
  existingTokenId?: string,
): Promise<TokenItem | null> {
  const map = getActiveMap();
  if (!map) {
    throw new Error('No map on the table yet — wait for the GM to place one, then try again.');
  }

  const { tokenDefaults } = await importDdbCharacterToken(ddbCharacterId);
  const imageUrl = resolveTokenImageUrl(tokenDefaults.imageUrl);
  const grid = map.gridSize;
  const { myUserId, myRole } = useSessionStore.getState();
  const ownerId = tokenDefaults.ownerId ?? myUserId ?? undefined;

  const alreadyOnTable = Object.values(useItemStore.getState().items).find(
    (i): i is TokenItem => i.type === 'token' && i.ddbCharacterId === ddbCharacterId,
  );
  if (alreadyOnTable && !existingTokenId) {
    existingTokenId = alreadyOnTable.id;
  }
  if (
    alreadyOnTable
    && myRole !== 'GM'
    && alreadyOnTable.ownerId
    && myUserId
    && alreadyOnTable.ownerId !== myUserId
  ) {
    throw new Error('That character is already on the table for another player.');
  }

  let x: number;
  let y: number;
  if (at) {
    const snapped = snapPoint(at.x, at.y);
    x = snapped.x;
    y = snapped.y;
  } else {
    const tokens = Object.values(useItemStore.getState().items).filter((i) => i.type === 'token');
    const count = tokens.length;
    const col = count % 8;
    const row = Math.floor(count / 8);
    x = map.x + map.width / 2 - grid + col * grid;
    y = map.y + map.height / 2 - grid + row * grid;
  }

  const sizeCells = tokenDefaults.sizeCells ?? 1;
  const width = sizeCells * grid;
  const height = sizeCells * grid;

  if (existingTokenId) {
    const existing = useItemStore.getState().items[existingTokenId];
    if (existing?.type === 'token') {
      const patch: Partial<TokenItem> = {
        ...tokenDefaults,
        ...(imageUrl ? { imageUrl } : {}),
        ...(ownerId ? { ownerId } : {}),
        isPc: true,
        width: existing.width,
        height: existing.height,
      };
      useItemStore.getState().updateItem(existingTokenId, patch);
      emitItemUpdate([{ id: existingTokenId, patch }]);
      useItemStore.getState().select([existingTokenId]);
      return { ...existing, ...patch } as TokenItem;
    }
  }

  const token: TokenItem = {
    id: uuidv4(),
    type: 'token',
    x,
    y,
    rotation: 0,
    width,
    height,
    zIndex: 0,
    locked: false,
    visible: true,
    name: tokenDefaults.name ?? 'PC',
    sizeCells,
    hp: tokenDefaults.hp ?? 1,
    maxHp: tokenDefaults.maxHp ?? 1,
    tempHp: tokenDefaults.tempHp ?? 0,
    ac: tokenDefaults.ac ?? 10,
    conditions: [],
    hideHpFromPlayers: false,
    initiativeMod: tokenDefaults.initiativeMod ?? 0,
    visionRadius: tokenDefaults.visionRadius ?? 0,
    ddbCharacterId: tokenDefaults.ddbCharacterId ?? ddbCharacterId,
    isPc: true,
    syncHpToDdb: tokenDefaults.syncHpToDdb ?? true,
    ...(ownerId ? { ownerId } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };

  useItemStore.getState().addItem(token);
  emitItemAdd(token);
  useItemStore.getState().select([token.id]);
  return token;
}
