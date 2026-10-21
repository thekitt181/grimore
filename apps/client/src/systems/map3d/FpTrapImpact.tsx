import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { propArtById } from '@/systems/map/props/propArt';
import { resolvePropId } from '@/systems/map/props/dungeonProps';
import { propShotElapsed } from '@/systems/map/props/propPose';
import type { ImageItem } from '@/systems/scene/types';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';

const TRAP_PLAYS = new Set(['shoot', 'rise', 'snap', 'burst', 'pulse', 'spread']);
const FLASH_MS = 520;
const NEAR_CELLS = 5.5;

type Flash = { kind: 'shoot' | 'rise' | 'snap' | 'burst' | 'other'; until: number };

/**
 * Screen-edge flash when a trap fires near the local FP token —
 * makes arrow / spear / blade / alarm hits readable in first person.
 */
export function FpTrapImpactHud() {
  const enabled = useFirstPersonStore((s) => s.enabled);
  const view3d = useMapStore((s) => s.viewMode === '3d');
  const [flash, setFlash] = useState<Flash | null>(null);
  const seenAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled || !view3d) {
      setFlash(null);
      return;
    }

    const tick = () => {
      const token = resolveFirstPersonToken();
      if (!token) return;
      const grid = 96;
      const items = useItemStore.getState().items;
      const now = Date.now();
      let best: Flash | null = null;

      for (const item of Object.values(items)) {
        if (item.type !== 'image') continue;
        const img = item as ImageItem;
        const propId = resolvePropId(img);
        if (!propId) continue;
        const play = propArtById(propId)?.play ?? 'still';
        if (!TRAP_PLAYS.has(play)) continue;
        const at = img.propAt ?? 0;
        if (!at || now - at > FLASH_MS + 80) continue;
        const prev = seenAt.current.get(img.id) ?? 0;
        if (at <= prev) continue;

        const tcx = token.x + token.width / 2;
        const tcy = token.y + token.height / 2;
        const pcx = img.x + img.width / 2;
        const pcy = img.y + img.height / 2;
        const dist = Math.hypot(tcx - pcx, tcy - pcy);
        if (dist > grid * NEAR_CELLS) continue;

        seenAt.current.set(img.id, at);
        const kind =
          play === 'shoot' || play === 'rise' || play === 'snap' || play === 'burst'
            ? play
            : 'other';
        best = { kind, until: now + FLASH_MS };
      }

      if (best) setFlash(best);
      else {
        setFlash((f) => (f && f.until > now ? f : null));
      }
    };

    const id = window.setInterval(tick, 50);
    return () => window.clearInterval(id);
  }, [enabled, view3d]);

  if (!enabled || !view3d || !flash || Date.now() > flash.until) return null;

  const t = 1 - (flash.until - Date.now()) / FLASH_MS;
  const alpha = Math.max(0, t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8);
  const edge =
    flash.kind === 'shoot'
      ? `rgba(201,168,76,${0.12 + alpha * 0.35})`
      : flash.kind === 'rise'
        ? `rgba(180,60,40,${0.12 + alpha * 0.35})`
        : flash.kind === 'burst'
          ? `rgba(220,180,60,${0.12 + alpha * 0.35})`
          : `rgba(160,40,40,${0.12 + alpha * 0.35})`;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[34]"
      aria-hidden
      style={{
        boxShadow: `inset 0 0 ${80 + alpha * 100}px ${40 + alpha * 60}px ${edge}`,
        background:
          flash.kind === 'shoot'
            ? `radial-gradient(circle at 50% 45%, rgba(255,220,120,${0.08 * alpha}) 0%, transparent 55%)`
            : undefined,
      }}
    />
  );
}

/** Brief world light when a trap fires near the FP token. */
export function FpTrapImpactSparks() {
  const enabled = useFirstPersonStore((s) => s.enabled);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(() => {
    const pl = lightRef.current;
    if (!pl || !enabled) {
      if (pl) pl.intensity = 0;
      return;
    }
    const token = resolveFirstPersonToken();
    if (!token) {
      pl.intensity = 0;
      return;
    }
    const items = useItemStore.getState().items;
    let hot: ImageItem | null = null;
    let hotDist = Infinity;
    for (const item of Object.values(items)) {
      if (item.type !== 'image') continue;
      const img = item as ImageItem;
      const propId = resolvePropId(img);
      const play = propId ? propArtById(propId)?.play : undefined;
      if (!play || !TRAP_PLAYS.has(play)) continue;
      const shot = propShotElapsed(img);
      if (shot > 0.55) continue;
      const dist = Math.hypot(
        token.x + token.width / 2 - (img.x + img.width / 2),
        token.y + token.height / 2 - (img.y + img.height / 2),
      );
      if (dist < hotDist) {
        hotDist = dist;
        hot = img;
      }
    }
    if (!hot || hotDist > 96 * 6) {
      pl.intensity = Math.max(0, pl.intensity - 0.35);
      return;
    }
    const shot = propShotElapsed(hot);
    const peak = shot < 0.12 ? shot / 0.12 : Math.max(0, 1 - (shot - 0.12) / 0.45);
    pl.position.set(hot.x + hot.width / 2, Math.max(24, hot.width * 0.4), hot.y + hot.height / 2);
    pl.intensity = 4.5 * peak;
    pl.distance = 220;
  });

  if (!enabled) return null;
  return <pointLight ref={lightRef} color="#ffc14a" intensity={0} decay={2} />;
}
