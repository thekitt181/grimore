import { getWalkPose, WALK_POSE_FRESH_MS } from '@/systems/scene/token/walkPoseBus';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { itemCenter, type ImageItem, type Item, type MapItem } from '@/systems/scene/types';
import { resolvePropId } from '@/systems/map/props/dungeonProps';

export const GRIMOIRE_LIGHT_NAME = 'grimoire-light';

export const TORCH_BRIGHT_FT = 20;
export const TORCH_DIM_FT = 20;

export interface LightSpec {
  brightFt: number;
  dimFt: number;
  totalFt: number;
  intensity: number;
  color: string;
  flicker: boolean;
}

export interface SceneLight extends LightSpec {
  id: string;
  wx: number;
  wy: number;
}

const PROP_LIGHT_DEFAULTS: Array<{ test: RegExp; brightFt: number; dimFt: number; color: string }> = [
  { test: /candle|votive|incense/i, brightFt: 5, dimFt: 5, color: '#ffd9a0' },
  { test: /lantern/i, brightFt: 30, dimFt: 30, color: '#ffd080' },
  { test: /lamp|sconce|brazier|chandelier/i, brightFt: 15, dimFt: 15, color: '#ffc078' },
  { test: /campfire|bonfire|firepit/i, brightFt: 20, dimFt: 20, color: '#ff9a40' },
  { test: /altar/i, brightFt: 10, dimFt: 10, color: '#ffe2a0' },
  { test: /torch|flame|fire/i, brightFt: TORCH_BRIGHT_FT, dimFt: TORCH_DIM_FT, color: '#ffc078' },
];

export function defaultLightForPropId(propId: string | undefined): {
  brightFt: number;
  dimFt: number;
  color: string;
} | null {
  if (!propId) return null;
  for (const row of PROP_LIGHT_DEFAULTS) {
    if (row.test.test(propId)) return { brightFt: row.brightFt, dimFt: row.dimFt, color: row.color };
  }
  return null;
}

function posedItem(item: Item): Item {
  if (item.type === 'token') {
    const walk = getWalkPose(item.id);
    if (walk && performance.now() - walk.at < WALK_POSE_FRESH_MS) {
      item = { ...item, x: walk.x, y: walk.y };
    }
  }
  const live = useLiveTransformStore.getState().byId[item.id];
  if (!live) return item;
  return { ...item, ...live } as Item;
}

export function itemLightSpec(item: Item | undefined): LightSpec | null {
  if (!item || item.visible === false) return null;
  if (item.type !== 'token' && item.type !== 'image') return null;

  const propId = item.type === 'image' ? resolvePropId(item as ImageItem) : undefined;
  const preset = defaultLightForPropId(propId);
  const explicitOn = item.lightOn === true;
  const explicitOff = item.lightOn === false;
  if (explicitOff) return null;
  if (!explicitOn && !preset) return null;

  const brightFt = Math.max(0, item.lightBrightFt ?? preset?.brightFt ?? TORCH_BRIGHT_FT);
  const dimFt = Math.max(0, item.lightDimFt ?? preset?.dimFt ?? TORCH_DIM_FT);
  if (brightFt <= 0 && dimFt <= 0) return null;

  const totalFt = brightFt + dimFt;
  const intensity = Math.max(1.1, (Math.max(brightFt, 5) / TORCH_BRIGHT_FT) * 2.6);
  return {
    brightFt,
    dimFt,
    totalFt,
    intensity,
    color: preset?.color ?? '#ffc078',
    flicker: Boolean(preset),
  };
}

export function collectSceneLights(
  items: Record<string, Item>,
  _map?: MapItem,
): SceneLight[] {
  const out: SceneLight[] = [];
  for (const raw of Object.values(items)) {
    if (raw.type !== 'token' && raw.type !== 'image') continue;
    const item = posedItem(raw);
    const spec = itemLightSpec(item);
    if (!spec) continue;
    const { cx, cy } = itemCenter(item);
    out.push({ id: item.id, wx: cx, wy: cy, ...spec });
  }
  return out;
}

export function lightRadiusPx(spec: Pick<LightSpec, 'totalFt'>, gridSize: number): number {
  return Math.max(gridSize, (spec.totalFt / 5) * Math.max(1, gridSize));
}

export function torchLightPatch(on: boolean): {
  lightOn: boolean;
  lightBrightFt: number;
  lightDimFt: number;
} {
  return {
    lightOn: on,
    lightBrightFt: TORCH_BRIGHT_FT,
    lightDimFt: TORCH_DIM_FT,
  };
}

export function lightTogglePatch(item: Item): Partial<Item> {
  if (itemLightSpec(item)) return { lightOn: false };
  const propId = item.type === 'image' ? resolvePropId(item as ImageItem) : undefined;
  const preset = defaultLightForPropId(propId);
  return {
    lightOn: true,
    lightBrightFt: item.lightBrightFt ?? preset?.brightFt ?? TORCH_BRIGHT_FT,
    lightDimFt: item.lightDimFt ?? preset?.dimFt ?? TORCH_DIM_FT,
  };
}
