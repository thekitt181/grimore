import type { DdbRollBridgePayload } from '@grimoire/shared';
import {
  tryConsumePropCheckRoll,
  tryConsumePropDdbRoll,
  wasRecentPropUseRoll,
} from './dungeonProps';

/** After a D&D Beyond roll lands in the tray, try to open a nearby / armed prop. */
export function ingestDdbPropRoll(payload: DdbRollBridgePayload): void {
  try {
    tryConsumePropDdbRoll(payload);
  } catch {
    // Never break the dice tray for a prop arm mismatch.
  }
}

/** After a VTT skill/ability roll, try to open a nearby linked prop (within 15 ft). */
export function ingestVttPropRoll(opts: {
  label: string;
  notation?: string;
  total: number;
  characterName?: string;
  actorTokenId?: string;
}): void {
  try {
    if (wasRecentPropUseRoll()) return;
    const ingest: {
      label: string;
      total: number;
      notation?: string;
      characterName?: string;
      actorTokenId?: string;
    } = {
      label: opts.label,
      total: opts.total,
    };
    if (opts.notation) ingest.notation = opts.notation;
    if (opts.characterName) ingest.characterName = opts.characterName;
    if (opts.actorTokenId) ingest.actorTokenId = opts.actorTokenId;
    tryConsumePropCheckRoll(ingest);
  } catch {
    // Never break the dice tray.
  }
}
