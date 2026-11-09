/**
 * Alstra Infinite Chests (itch.io) — personal End Product only.
 * Free Asset License: credit required; do not redistribute the pack.
 * https://alstrainfinite.itch.io/chests
 */
import type { PropArt } from './propArt';

const T = '/props/alstra';
const M = '/props3d/alstra';

export const ALSTRA_PROP_ART: PropArt[] = [
  {
    id: 'alstra-chest-v1',
    name: 'Chest iron',
    short: 'Chest iron',
    motion: 'toggle',
    play: 'lift',
    rest: `${T}/ChestV1.png`,
    open: `${T}/ChestV1_Open.png`,
  },
  {
    id: 'alstra-chest-v2',
    name: 'Chest ornate',
    short: 'Chest ornate',
    motion: 'toggle',
    play: 'lift',
    rest: `${T}/ChestV2.png`,
    open: `${T}/ChestV2_Open.png`,
  },
  {
    id: 'alstra-chest-v3',
    name: 'Chest banded',
    short: 'Chest banded',
    motion: 'toggle',
    play: 'lift',
    rest: `${T}/ChestV3.png`,
    open: `${T}/ChestV3_Open.png`,
  },
  {
    id: 'alstra-lock-v1',
    name: 'Lock iron',
    short: 'Lock iron',
    motion: 'none',
    play: 'still',
    rest: `${T}/ChestV1_Lock.png`,
  },
  {
    id: 'alstra-lock-v2',
    name: 'Lock ornate',
    short: 'Lock ornate',
    motion: 'none',
    play: 'still',
    rest: `${T}/ChestV2_Lock.png`,
  },
  {
    id: 'alstra-lock-v3',
    name: 'Lock banded',
    short: 'Lock banded',
    motion: 'none',
    play: 'still',
    rest: `${T}/ChestV3_Lock.png`,
  },
  {
    id: 'alstra-loot-v1',
    name: 'Loot iron',
    short: 'Loot iron',
    motion: 'none',
    play: 'still',
    rest: `${T}/ChestV1_Loot.png`,
  },
  {
    id: 'alstra-loot-v2',
    name: 'Loot ornate',
    short: 'Loot ornate',
    motion: 'none',
    play: 'still',
    rest: `${T}/ChestV2_Loot.png`,
  },
  {
    id: 'alstra-loot-v3',
    name: 'Loot banded',
    short: 'Loot banded',
    motion: 'none',
    play: 'still',
    rest: `${T}/ChestV3_Loot.png`,
  },
];

export const ALSTRA_PROP_MODELS: Record<
  string,
  { url: string; openUrl?: string; sizeBias?: number }
> = {
  'alstra-chest-v1': { url: `${M}/ChestV1.glb`, sizeBias: 0.95 },
  'alstra-chest-v2': { url: `${M}/ChestV2.glb`, sizeBias: 0.95 },
  'alstra-chest-v3': { url: `${M}/ChestV3.glb`, sizeBias: 0.95 },
  'alstra-lock-v1': { url: `${M}/ChestV1_Lock.glb`, sizeBias: 0.55 },
  'alstra-lock-v2': { url: `${M}/ChestV2_Lock.glb`, sizeBias: 0.55 },
  'alstra-lock-v3': { url: `${M}/ChestV3_Lock.glb`, sizeBias: 0.55 },
  'alstra-loot-v1': { url: `${M}/ChestV1_Loot.glb`, sizeBias: 0.95 },
  'alstra-loot-v2': { url: `${M}/ChestV2_Loot.glb`, sizeBias: 0.95 },
  'alstra-loot-v3': { url: `${M}/ChestV3_Loot.glb`, sizeBias: 0.95 },
};

export const ALSTRA_CREDIT =
  'Infinite Chests by Alstra Infinite (itch.io) · Free Asset License · personal use, not redistributed';
