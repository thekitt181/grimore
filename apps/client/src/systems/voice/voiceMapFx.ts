import { useVoiceStore } from './voiceStore';
import { stampVoiceWallScorch } from '@/systems/map3d/wallScorch';

const FIRE = /\b(fire\s*ball|fire\s*bolt|firebolt|scorching ray|burning hands|flame strike|scorch|immolate|incinerate|combust)\b/i;
const CAST_FIRE = /\b(cast|shoot|throw|hurl|lob|launch)\b.{0,48}\bfire\b/i;
const WALL = /\b(wall|door|stonework|masonry)\b/i;

let lastAt = 0;
let lastText = '';

export function isWallScorchLine(text: string): boolean {
  const t = text.toLowerCase();
  if (!WALL.test(t)) return false;
  return FIRE.test(t) || CAST_FIRE.test(t);
}

/** Local speaker only — uses this client's look / token. */
export function tryVoiceMapFx(text: string): void {
  if (!useVoiceStore.getState().joined) return;
  if (!isWallScorchLine(text)) return;
  const key = text.trim().toLowerCase().slice(0, 80);
  const now = Date.now();
  if (key === lastText && now - lastAt < 8000) return;
  lastText = key;
  lastAt = now;
  stampVoiceWallScorch();
}
