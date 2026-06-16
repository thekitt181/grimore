import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ActiveSpellEffect } from '@grimoire/shared';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { THREE_READY_EVENT } from '@/systems/map3d/threeCanvasHealth';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSpellEffectStore } from './effectStore';
import { useSpellEffectTargetStore } from './spellEffectTargetStore';
import { getJb2aBaseUrl } from './spellVfxRegistry';
import { jb2aAssetUrl, pickJb2aVariant, resolveSpellJb2aMapping, applyJb2aShotIndex } from './jb2aAssets';
import { findSpellEffectCatalogEntry } from './spellEffectsCatalog';
import {
  clearSpellVfxDomLayer,
  getSpellVfxDomLayer,
  hideSpellVfxDomRoot,
  showSpellVfxDomRoot,
} from './spellVfxDomHost';
import {
  effectScreenSizePx,
  placementTravelWorldSpan,
  placementWorldPoint,
  projectWorldPoint,
  resolveCastAsset,
  resolveDirectedBeamLayout,
  resolveShotPlacementsForEffect,
  spellVfxUsesScreenLayer,
  worldSpanToScreenPx,
} from './spellVfxScreenUtils';

const GOLD = '#c9a84c';

function showsPersistentZone(effect: ActiveSpellEffect): boolean {
  const catalog = findSpellEffectCatalogEntry(effect.spellName);
  if (catalog?.hasZoneLoop) return true;
  if (effect.concentration) return true;
  if (effect.duration.kind === 'untilDispelled') return true;
  if (effect.duration.kind === 'minutes' || effect.duration.kind === 'hours') return true;
  if (effect.duration.totalRounds != null && effect.duration.totalRounds > 1) return true;
  return false;
}

function showGoldBurst(layer: HTMLDivElement, x: number, y: number, sizePx: number): void {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    `left:${x}px`,
    `top:${y}px`,
    `width:${Math.max(sizePx, 48)}px`,
    `height:${Math.max(sizePx, 48)}px`,
    'transform:translate(-50%,-50%)',
    'border-radius:50%',
    `border:2px solid ${GOLD}`,
    'background:rgba(201,168,76,0.18)',
    'pointer-events:none',
  ].join(';');
  layer.appendChild(el);
  window.setTimeout(() => el.remove(), 1200);
}

function playDirectedBeamVideo(
  layer: HTMLDivElement,
  placement: NonNullable<ActiveSpellEffect['placement']>,
  asset: NonNullable<ReturnType<typeof resolveCastAsset>>['asset'],
  baseUrl: string,
  shotIndex = 0,
): { ok: boolean; variant?: NonNullable<ReturnType<typeof resolveCastAsset>>['variant'] } {
  const layout = resolveDirectedBeamLayout(placement, asset);
  if (!layout) return { ok: false };

  const variant = applyJb2aShotIndex(layout.variant, shotIndex);
  const url = jb2aAssetUrl(baseUrl, asset, variant);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.cssText = [
    'position:fixed',
    `left:${layout.x}px`,
    `top:${layout.y}px`,
    `width:${layout.width}px`,
    `height:${layout.height}px`,
    `transform:translate(0,-50%) rotate(${layout.angleRad}rad)`,
    'transform-origin:0% 50%',
    'pointer-events:none',
  ].join(';');
  layer.appendChild(video);

  const remove = () => video.remove();
  video.addEventListener('ended', remove, { once: true });
  window.setTimeout(remove, variant.durationMs + 300);
  void video.play().catch(() => {
    remove();
    showGoldBurst(layer, layout.x, layout.y, layout.width);
  });

  return { ok: true, variant };
}

function playImpactBurst(
  layer: HTMLDivElement,
  effect: ActiveSpellEffect,
  placement: NonNullable<ActiveSpellEffect['placement']>,
  impactAsset: import('./jb2aAssets').Jb2aEffectAsset,
  baseUrl: string,
): boolean {
  const center = projectWorldPoint(placement.centerX, placement.centerY);
  if (!center) return false;

  const burstAsset = { ...impactAsset, directed: false as const };
  const sizePx = Math.max(64, effectScreenSizePx({ ...effect, placement }, burstAsset));
  const variant = pickJb2aVariant(impactAsset, sizePx);
  const url = jb2aAssetUrl(baseUrl, impactAsset, variant);

  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.cssText = [
    'position:fixed',
    `left:${center.x}px`,
    `top:${center.y}px`,
    `width:${sizePx}px`,
    `height:${sizePx}px`,
    'transform:translate(-50%,-50%)',
    'pointer-events:none',
  ].join(';');
  layer.appendChild(video);

  const remove = () => video.remove();
  const fallback = () => {
    remove();
    showGoldBurst(layer, center.x, center.y, sizePx);
  };
  video.addEventListener('ended', remove, { once: true });
  video.addEventListener('error', fallback, { once: true });
  window.setTimeout(remove, variant.durationMs + 300);
  void video.play().catch(fallback);
  return true;
}

function playCastBurst(
  layer: HTMLDivElement,
  effect: ActiveSpellEffect,
  placement: NonNullable<ActiveSpellEffect['placement']>,
  asset: NonNullable<ReturnType<typeof resolveCastAsset>>['asset'],
  variant: NonNullable<ReturnType<typeof resolveCastAsset>>['variant'],
  baseUrl: string,
): boolean {
  if (asset.directed) {
    const { ok } = playDirectedBeamVideo(layer, placement, asset, baseUrl);
    return ok;
  }

  const url = jb2aAssetUrl(baseUrl, asset, variant);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.position = 'fixed';
  video.style.pointerEvents = 'none';

  const pt = placementWorldPoint(placement, false);
  const projected = projectWorldPoint(pt.x, pt.z);
  if (!projected) return false;

  const sizePx = Math.max(48, effectScreenSizePx({ ...effect, placement }, asset));
  video.style.left = `${projected.x}px`;
  video.style.top = `${projected.y}px`;
  video.style.width = `${sizePx}px`;
  video.style.height = `${sizePx}px`;
  video.style.transform = 'translate(-50%, -50%)';
  video.src = url;
  layer.appendChild(video);

  const remove = () => video.remove();
  const showFallback = () => {
    remove();
    showGoldBurst(layer, projected.x, projected.y, sizePx);
  };
  video.addEventListener('ended', remove, { once: true });
  video.addEventListener('error', showFallback, { once: true });
  window.setTimeout(remove, variant.durationMs + 300);
  void video.play().catch(showFallback);
  return true;
}

function playTravelThenImpact(
  layer: HTMLDivElement,
  effect: ActiveSpellEffect,
  placement: NonNullable<ActiveSpellEffect['placement']>,
  baseUrl: string,
): boolean {
  const mapping = resolveSpellJb2aMapping(effect.spellName, effect.aoe?.type);
  const beam = mapping.cast;
  const impact = mapping.impact;
  if (!beam?.directed || !impact) return false;

  const { ok, variant } = playDirectedBeamVideo(layer, placement, beam, baseUrl);
  if (!ok || !variant) return false;

  window.setTimeout(() => {
    playImpactBurst(layer, effect, placement, impact, baseUrl);
  }, Math.max(0, variant.durationMs - 120));

  return true;
}

function tryPlayCastVfx(
  effect: ActiveSpellEffect,
  castLayer: HTMLDivElement,
  baseUrl: string,
  items: ReturnType<typeof useItemStore.getState>['items'],
  liveById: Record<string, import('@/systems/scene/store/liveTransformStore').LiveTransform | undefined>,
): boolean {
  if (!effect.placement) return false;

  const resolved = resolveCastAsset(effect);
  const mapping = resolveSpellJb2aMapping(effect.spellName, effect.aoe?.type);
  const directed = resolved?.asset.directed ?? false;
  const placements = resolveShotPlacementsForEffect(effect, items, liveById, directed);

  if (!resolved || !baseUrl) {
    let any = false;
    for (const placement of placements) {
      const directed = resolved?.asset.directed ?? false;
      if (directed) {
        const layout = resolved
          ? resolveDirectedBeamLayout(placement, resolved.asset)
          : null;
        if (layout) {
          showGoldBurst(castLayer, layout.x, layout.y, layout.width);
          any = true;
          continue;
        }
      }
      const pt = placementWorldPoint(placement, directed);
      const center = projectWorldPoint(pt.x, pt.z);
      if (!center) continue;
      const sizePx = resolved
        ? effectScreenSizePx({ ...effect, placement }, resolved.asset)
        : 96;
      showGoldBurst(castLayer, center.x, center.y, sizePx);
      any = true;
    }
    return any;
  }

  let any = false;
  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i]!;
    const shotIndex = i;
    const delayMs = i * 140;
    const playShot = () => {
      const travelImpact = mapping.impact
        && resolved?.asset.directed
        && placementTravelWorldSpan(placement) > 0;
      if (travelImpact && resolved && baseUrl) {
        if (playTravelThenImpact(castLayer, effect, placement, baseUrl)) {
          any = true;
          return;
        }
      }
      if (!resolved || !baseUrl) return;
      if (resolved.asset.directed) {
        const { ok } = playDirectedBeamVideo(castLayer, placement, resolved.asset, baseUrl, shotIndex);
        if (ok) any = true;
        return;
      }
      if (playCastBurst(castLayer, effect, placement, resolved.asset, resolved.variant, baseUrl)) {
        any = true;
      }
    };
    if (delayMs === 0) playShot();
    else window.setTimeout(playShot, delayMs);
    any = true;
  }
  return any;
}

function updateZoneVideoPosition(
  video: HTMLVideoElement,
  effect: ActiveSpellEffect,
  directed: boolean,
  sizePx: number,
): void {
  if (!effect.placement) return;
  const pt = placementWorldPoint(effect.placement, directed);
  const center = projectWorldPoint(pt.x, pt.z);
  if (!center) return;
  video.style.left = `${center.x}px`;
  video.style.top = `${center.y}px`;
  video.style.width = `${sizePx}px`;
  video.style.height = `${sizePx}px`;
}

/** DOM layer above Three.js — spell VFX + target rings (Pixi overlay is hidden behind GL). */
export function SpellScreenVfxOverlay() {
  const viewMode = useMapStore((s) => s.viewMode);
  const [threeReady, setThreeReady] = useState(false);
  const effects = useSpellEffectStore(useShallow((s) =>
    s.effects.filter((e) => !e.ended && e.placement && e.aoe),
  ));
  const pick = useSpellEffectTargetStore((s) => s.pick);
  const items = useItemStore((s) => s.items);
  const liveById = useLiveTransformStore((s) => s.byId);

  const playedCastIds = useRef(new Set<string>());
  const zoneVideos = useRef(new Map<string, HTMLVideoElement>());
  const zoneSizes = useRef(new Map<string, number>());

  const screenLayer = spellVfxUsesScreenLayer();

  useEffect(() => {
    const onReady = () => setThreeReady(true);
    window.addEventListener(THREE_READY_EVENT, onReady);
    if (spellVfxUsesScreenLayer()) setThreeReady(true);
    return () => window.removeEventListener(THREE_READY_EVENT, onReady);
  }, [viewMode]);

  useEffect(() => {
    if (screenLayer) {
      showSpellVfxDomRoot();
      return () => hideSpellVfxDomRoot();
    }
    hideSpellVfxDomRoot();
    return undefined;
  }, [screenLayer]);

  useEffect(() => {
    if (!screenLayer) return;

    let raf = 0;
    const tick = () => {
      if (spellVfxUsesScreenLayer()) {
        const castLayer = getSpellVfxDomLayer('cast');
        const baseUrl = getJb2aBaseUrl();
        for (const effect of effects) {
          if (playedCastIds.current.has(effect.id)) continue;
          if (!effect.triggerCastVfx) {
            playedCastIds.current.add(effect.id);
            continue;
          }
          const played = tryPlayCastVfx(effect, castLayer, baseUrl, items, liveById);
          if (played) playedCastIds.current.add(effect.id);
        }

        const ringsEl = getSpellVfxDomLayer('rings');
        ringsEl.replaceChildren();
        if (pick) {
          const drawRing = (tokenId: string, selected: boolean) => {
            const token = items[tokenId];
            if (token?.type !== 'token') return;
            const b = resolveItemBounds(token, liveById[token.id]);
            const center = projectWorldPoint(b.cx, b.cz);
            if (!center) return;
            const size = worldSpanToScreenPx(b.cx, b.cz, Math.max(b.width, b.height) / 2 + 12);
            const el = document.createElement('div');
            el.style.cssText = [
              'position:fixed',
              `left:${center.x - size}px`,
              `top:${center.y - size}px`,
              `width:${size * 2}px`,
              `height:${size * 2}px`,
              'border-radius:50%',
              `border:${selected ? 4 : 2}px solid ${GOLD}`,
              `background:${selected ? 'rgba(201,168,76,0.15)' : 'transparent'}`,
              `opacity:${selected ? 0.95 : 0.55}`,
              'pointer-events:none',
              'box-sizing:border-box',
            ].join(';');
            ringsEl.appendChild(el);
          };

          if (pick.hoverTokenId && !pick.selectedTargetIds.includes(pick.hoverTokenId)) {
            drawRing(pick.hoverTokenId, false);
          }
          for (const id of [...new Set(pick.selectedTargetIds)]) {
            drawRing(id, true);
          }
        }

        for (const effect of effects.filter(showsPersistentZone)) {
          const video = zoneVideos.current.get(effect.id);
          const sizePx = zoneSizes.current.get(effect.id);
          if (!video || sizePx == null || !effect.placement || !effect.aoe) continue;
          const mapping = resolveSpellJb2aMapping(effect.spellName, effect.aoe.type);
          const asset = mapping.zone ?? mapping.cast;
          if (!asset) continue;
          updateZoneVideoPosition(video, effect, asset.directed ?? false, sizePx);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pick, items, liveById, effects, screenLayer, threeReady]);

  useEffect(() => {
    if (!screenLayer) return;
    const baseUrl = getJb2aBaseUrl();
    const layer = getSpellVfxDomLayer('zone');

    const zoneEffects = effects.filter(showsPersistentZone);
    const keep = new Set<string>();

    for (const effect of zoneEffects) {
      keep.add(effect.id);
      if (zoneVideos.current.has(effect.id)) continue;
      if (!effect.placement || !effect.aoe) continue;

      const mapping = resolveSpellJb2aMapping(effect.spellName, effect.aoe.type);
      const asset = mapping.zone ?? mapping.cast;
      if (!asset) continue;

      const pt = placementWorldPoint(effect.placement, asset.directed ?? false);
      const center = projectWorldPoint(pt.x, pt.z);
      if (!center) continue;
      const sizePx = Math.max(48, effectScreenSizePx(effect, asset));

      if (!baseUrl) {
        showGoldBurst(layer, center.x, center.y, sizePx);
        continue;
      }

      const variant = pickJb2aVariant(asset, sizePx);
      const url = jb2aAssetUrl(baseUrl, asset, variant);

      const video = document.createElement('video');
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.autoplay = true;
      video.style.position = 'fixed';
      video.style.left = `${center.x}px`;
      video.style.top = `${center.y}px`;
      video.style.width = `${sizePx}px`;
      video.style.height = `${sizePx}px`;
      video.style.transform = 'translate(-50%, -50%)';
      video.style.opacity = '0.85';
      video.style.pointerEvents = 'none';
      layer.appendChild(video);
      zoneVideos.current.set(effect.id, video);
      zoneSizes.current.set(effect.id, sizePx);

      const fail = () => {
        video.remove();
        zoneVideos.current.delete(effect.id);
        zoneSizes.current.delete(effect.id);
        showGoldBurst(layer, center.x, center.y, sizePx);
      };
      void video.play().catch(fail);
      video.addEventListener('error', fail, { once: true });
    }

    for (const [id, video] of zoneVideos.current) {
      if (keep.has(id)) continue;
      video.remove();
      zoneVideos.current.delete(id);
      zoneSizes.current.delete(id);
    }
  }, [effects, screenLayer, threeReady]);

  useEffect(() => {
    const activeIds = new Set(effects.map((e) => e.id));
    for (const id of playedCastIds.current) {
      if (!activeIds.has(id)) playedCastIds.current.delete(id);
    }
  }, [effects]);

  useEffect(() => {
    if (!screenLayer) {
      playedCastIds.current.clear();
      zoneVideos.current.clear();
      zoneSizes.current.clear();
      clearSpellVfxDomLayer('cast');
      clearSpellVfxDomLayer('zone');
      clearSpellVfxDomLayer('rings');
    }
  }, [screenLayer]);

  return null;
}
