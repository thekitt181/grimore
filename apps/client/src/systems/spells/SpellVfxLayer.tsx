import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { useShallow } from 'zustand/react/shallow';
import type { ActiveSpellEffect } from '@grimoire/shared';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useSpellEffectStore } from './effectStore';
import { buildAoePolygon, type AoePlacement } from '@/systems/combat/aoeGeometry';
import { getMapGridSize } from '@/systems/combat/evaluateAttack';
import { getJb2aBaseUrl, jb2aAnimationsEnabled } from './spellVfxRegistry';
import { playSpellCastVfx, syncZoneLoopVfx, clearAllSpellVideoVfx } from './spellVfxPlayer';
import { findSpellEffectCatalogEntry, effectShowsMapZone } from './spellEffectsCatalog';
import { spellVfxUsesScreenLayer } from './spellVfxScreenUtils';

const GOLD = 0xc9a84c;

function hexToNumber(hex: string | undefined): number {
  if (!hex) return GOLD;
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return Number.isFinite(n) ? n : GOLD;
}

function showsPersistentZone(effect: ActiveSpellEffect): boolean {
  const catalog = findSpellEffectCatalogEntry(effect.spellName);
  if (catalog?.hasZoneLoop) return true;
  if (effect.concentration) return true;
  if (effect.duration.kind === 'untilDispelled') return true;
  if (effect.duration.kind === 'minutes' || effect.duration.kind === 'hours') return true;
  if (effect.duration.totalRounds != null && effect.duration.totalRounds > 1) return true;
  return false;
}

/** Synced spell zones + JB2A cast bursts on the Pixi overlay (Embers-style). */
export function SpellVfxLayer({ appReady }: { appReady: boolean }) {
  const effects = useSpellEffectStore(useShallow((s) => s.effects.filter((e) => !e.ended && e.placement && e.aoe)));
  const settings = useSpellEffectStore((s) => s.settings);
  const gRef = useRef<Graphics | null>(null);
  const playedCastIds = useRef(new Set<string>());

  useEffect(() => {
    if (!appReady) return;
    const overlay = sceneRefs.overlay.current;
    if (!overlay) return;

    for (;;) {
      const orphan = overlay.getChildByLabel('spell-vfx');
      if (!orphan || orphan === gRef.current) break;
      overlay.removeChild(orphan);
      orphan.destroy({ children: true });
    }

    let g = overlay.getChildByLabel('spell-vfx') as Graphics | null;
    if (!g || g.destroyed) {
      g = new Graphics();
      g.label = 'spell-vfx';
      overlay.addChild(g);
    }
    gRef.current = g;

    return () => {
      gRef.current = null;
    };
  }, [appReady]);

  useEffect(() => {
    const g = gRef.current;
    if (!g || g.destroyed) return;
    g.clear();

    const useJb2a = jb2aAnimationsEnabled();
    if (useJb2a && spellVfxUsesScreenLayer()) return;
    if (useJb2a) return;

    const grid = getMapGridSize();
    for (const effect of effects) {
      if (!effectShowsMapZone(effect)) continue;
      if (!effect.placement || !effect.aoe) continue;
      const placement: AoePlacement = effect.placement;
      const poly = buildAoePolygon(effect.aoe, placement, grid);
      if (poly.length < 3) continue;

      const color = hexToNumber(effect.vfxColor);
      g.moveTo(poly[0]!.x, poly[0]!.y);
      for (let i = 1; i < poly.length; i++) {
        g.lineTo(poly[i]!.x, poly[i]!.y);
      }
      g.closePath();
      g.fill({ color, alpha: 0.12 });
      g.stroke({ color, width: 2, alpha: 0.55 });
    }
  }, [effects, settings.jb2aBaseUrl]);

  useEffect(() => {
    if (!appReady || spellVfxUsesScreenLayer()) return;
    const baseUrl = getJb2aBaseUrl();
    if (!baseUrl) return;

    for (const effect of effects) {
      if (playedCastIds.current.has(effect.id)) continue;
      if (!effect.triggerCastVfx) {
        playedCastIds.current.add(effect.id);
        continue;
      }
      playedCastIds.current.add(effect.id);
      void playSpellCastVfx(effect, baseUrl);
    }

    const zoneEffects = effects.filter(showsPersistentZone);
    void syncZoneLoopVfx(zoneEffects, baseUrl);
  }, [appReady, effects, settings.jb2aBaseUrl]);

  useEffect(() => {
    const activeIds = new Set(effects.map((e) => e.id));
    for (const id of playedCastIds.current) {
      if (!activeIds.has(id)) playedCastIds.current.delete(id);
    }
  }, [effects]);

  useEffect(() => () => {
    clearAllSpellVideoVfx();
  }, []);

  return null;
}
