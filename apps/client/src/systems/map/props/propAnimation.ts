import { Container, Graphics, Sprite, Texture, type Ticker } from 'pixi.js';
import type { ImageItem } from '@/systems/scene/types';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { loadTexture } from '@/lib/textureLoader';
import { resolvePropId } from './dungeonProps';
import { propArtById, type PropArt } from './propArt';
import { getPropCanvasTexture } from './propCanvasArt';
import { isDoorPropId } from './doorCollision';
import { useMapStore } from '@/systems/map/store/mapStore';
import { resolveDoorSurfaceStyle, type DoorSurfaceStyle } from '@/systems/map3d/doorSurfaceStyles';
import { resolveMapSurfaceStyle } from '@/systems/map3d/mapSurfaceStyles';

const propTicks = new Map<Container, (ticker: Ticker) => void>();

function stopPropAnimation(c: Container) {
  const tick = propTicks.get(c);
  if (!tick) return;
  propTicks.delete(c);
  sceneRefs.app.current?.ticker?.remove(tick);
}

/** Pixi teardown — stop ticks before Application.destroy nulls the ticker. */
export function stopAllPropAnimations(): void {
  for (const c of [...propTicks.keys()]) {
    stopPropAnimation(c);
  }
}

async function restTexture(propId: string | undefined, url: string): Promise<Texture> {
  if (propId) {
    const canvasTex = getPropCanvasTexture(propId);
    if (canvasTex) {
      canvasTex.source.scaleMode = 'linear';
      return canvasTex;
    }
  }
  const tex = await loadTexture(url);
  tex.source.scaleMode = url.endsWith('.svg') ? 'linear' : 'nearest';
  return tex;
}

function fit(sprite: Sprite, size = 64): number {
  sprite.width = size;
  sprite.height = size;
  return sprite.scale.x;
}

function smooth(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

function pose(item: ImageItem, seconds: number): number {
  const target = (item.propState ?? 0) > 0 ? 1 : 0;
  const at = item.propAt ?? 0;
  if (!at) return target;
  const e = smooth((Date.now() - at) / (seconds * 1000));
  return target ? e : 1 - e;
}

function springPose(item: ImageItem, seconds: number): number {
  const target = (item.propState ?? 0) > 0 ? 1 : 0;
  const at = item.propAt ?? 0;
  if (!at) return target;
  const u = Math.min(1, Math.max(0, (Date.now() - at) / (seconds * 1000)));
  if (!target) return 1 - smooth(u);
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
}

function shotElapsed(item: ImageItem): number {
  const at = item.propAt ?? 0;
  if (!at || (item.propState ?? 0) <= 0) return 99;
  return (Date.now() - at) / 1000;
}

function frameIndex(now: number, count: number, ms = 140): number {
  return Math.floor(now / ms) % count;
}

function cellMask(x: number, y: number, w: number, h: number): Graphics {
  const mask = new Graphics();
  mask.rect(x, y, w, h);
  mask.fill({ color: 0xffffff });
  return mask;
}

function cssHex(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16);
}

function mountThemedDoor(c: Container, item: ImageItem, art: PropArt, theme: DoorSurfaceStyle): boolean {
  stopPropAnimation(c);
  const root = new Container();
  root.label = 'prop-door-themed';
  const s = Math.min(item.width, item.height) / 64;
  root.scale.set(s);
  root.position.set((item.width - 64 * s) / 2, (item.height - 64 * s) / 2);
  c.addChildAt(root, 0);

  const concealed = art.id === 'secret-door' && item.visible === false;
  const open = (item.propState ?? 0) > 0;

  const redraw = () => {
    root.removeChildren();
    const g = new Graphics();
    if (concealed) {
      const wall = resolveMapSurfaceStyle(useMapStore.getState().wallStyleId);
      g.rect(0, 0, 64, 64);
      g.fill({ color: cssHex(wall.wall), alpha: 0.92 });
      root.addChild(g);
      return;
    }

    if (art.id === 'gate') {
      const bars = [-22, -11, 0, 11, 22];
      for (const x of bars) {
        g.rect(30 + x, 4, 4, 56);
        g.fill({ color: cssHex(theme.gate) });
      }
      g.rect(6, 12, 52, 4);
      g.fill({ color: cssHex(theme.gateDark) });
      g.rect(6, 30, 52, 4);
      g.fill({ color: cssHex(theme.gateDark) });
      g.rect(6, 48, 52, 4);
      g.fill({ color: cssHex(theme.gateDark) });
      root.addChild(g);
      return;
    }

    const swing = art.play === 'swing' ? pose(item, 0.45) : 0;
    const panel = g;
    panel.roundRect(8, 4, 48, 56, 2);
    panel.fill({ color: cssHex(art.id === 'runed-door' ? theme.panelDark : theme.panel) });
    panel.stroke({ color: cssHex(theme.trim), width: 2 });
    if (open && art.open) {
      panel.rect(8, 4, 48, 56);
      panel.fill({ color: cssHex(theme.panelDark), alpha: 0.35 + swing * 0.4 });
    }
    const showHandles = art.id !== 'secret-door' || item.visible !== false;
    if (showHandles && !open) {
      panel.circle(48, 32, art.id === 'secret-door' ? 2.5 : 4);
      panel.fill({ color: cssHex(theme.handle) });
    }
    if (art.id === 'runed-door') {
      panel.circle(32, 28, 8);
      panel.stroke({ color: cssHex(theme.rune), width: 2 });
    }
    root.addChild(panel);
    root.rotation = swing * 0.35;
  };

  redraw();
  if (art.play === 'swing') {
    const tick = () => {
      if (c.destroyed || !root.parent) {
        stopPropAnimation(c);
        return;
      }
      redraw();
    };
    const ticker = sceneRefs.app.current?.ticker;
    if (ticker) {
      ticker.add(tick);
      propTicks.set(c, tick);
    }
  }
  return true;
}

function build(root: Container, art: PropArt, tex: Map<string, Texture>, item: ImageItem) {
  const restTex = tex.get(art.rest);
  if (!restTex) return () => {};

  if (art.play === 'still') {
    const sprite = new Sprite(restTex);
    fit(sprite);
    root.addChild(sprite);
    return () => {};
  }

  if (art.play === 'flicker' && art.frames?.length) {
    const frames = art.frames.map((url) => tex.get(url)).filter((t): t is Texture => !!t);
    const sprite = new Sprite(frames[0] ?? restTex);
    fit(sprite);
    root.addChild(sprite);
    return (now: number) => {
      const next = frames[frameIndex(now, frames.length)] ?? restTex;
      if (sprite.texture !== next) {
        sprite.texture = next;
        fit(sprite);
      }
    };
  }

  if (art.play === 'lift' && art.open) {
    const openTex = tex.get(art.open);
    const open = new Sprite(openTex ?? restTex);
    const lid = new Sprite(restTex);
    fit(open);
    lid.anchor.set(0.5, 0);
    const lidScale = fit(lid);
    lid.position.set(32, 2);
    root.addChild(open, lid);
    return () => {
      const p = pose(item, 0.5);
      open.alpha = p;
      lid.scale.y = lidScale * (1 - p * 0.82);
      lid.alpha = 1 - Math.max(0, p - 0.55) / 0.45;
      lid.position.y = 2 - p * 8;
    };
  }

  if (art.play === 'swing' && art.open) {
    const open = new Sprite(tex.get(art.open) ?? restTex);
    const door = new Sprite(restTex);
    fit(open);
    door.anchor.set(0, 0);
    const doorScale = fit(door);
    root.addChild(open, door);
    return () => {
      const p = pose(item, 0.35);
      open.alpha = p;
      door.scale.x = doorScale * (1 - p * 0.92);
      door.alpha = 1 - Math.max(0, p - 0.7) / 0.3;
    };
  }

  if (art.play === 'split' && art.open) {
    const pit = new Sprite(tex.get(art.open) ?? restTex);
    fit(pit);
    const left = new Sprite(restTex);
    const right = new Sprite(restTex);
    left.anchor.set(0, 0);
    right.anchor.set(1, 0);
    const hatchScale = fit(left);
    fit(right);
    right.position.set(64, 0);
    const leftMask = cellMask(0, 0, 32, 64);
    const rightMask = cellMask(32, 0, 32, 64);
    left.mask = leftMask;
    right.mask = rightMask;
    root.addChild(pit, left, leftMask, right, rightMask);
    return () => {
      const p = pose(item, 0.55);
      const openAmount = 1 - p * 0.88;
      left.scale.x = hatchScale * openAmount;
      right.scale.x = hatchScale * openAmount;
    };
  }

  if (art.play === 'rise') {
    const trap = new Sprite(restTex);
    fit(trap);
    const mask = cellMask(0, 0, 64, 64);
    trap.mask = mask;
    root.addChild(trap, mask);
    return () => {
      trap.y = (1 - springPose(item, 0.28)) * 36;
    };
  }

  if (art.play === 'snap') {
    const trap = new Sprite(restTex);
    trap.anchor.set(0.5);
    const base = fit(trap);
    trap.position.set(32, 32);
    root.addChild(trap);
    return () => {
      const p = springPose(item, 0.18);
      const sprung = Math.min(1, Math.max(0, p));
      const open = 1 - sprung;
      trap.rotation = open * 0.55;
      const size = base * (0.82 + sprung * 0.22);
      trap.scale.set(size);
    };
  }

  if (art.play === 'press') {
    const plate = new Sprite(restTex);
    const base = fit(plate);
    root.addChild(plate);
    return () => {
      const p = pose(item, 0.16);
      plate.y = p * 4;
      plate.scale.y = base * (1 - p * 0.12);
    };
  }

  if (art.play === 'drop' && art.open) {
    const opening = new Sprite(tex.get(art.open) ?? restTex);
    const bars = new Sprite(restTex);
    fit(opening);
    fit(bars);
    const mask = cellMask(0, 0, 64, 64);
    bars.mask = mask;
    root.addChild(opening, bars, mask);
    return () => {
      const p = pose(item, 0.42);
      bars.y = -46 + p * p * 46;
    };
  }

  if (art.play === 'ignite' && art.frames?.length) {
    const altar = new Sprite(restTex);
    fit(altar);
    const frames = art.frames.map((url) => tex.get(url)).filter((t): t is Texture => !!t);
    const fire = new Sprite(frames[0] ?? restTex);
    fire.anchor.set(0.5, 1);
    fire.width = 28;
    fire.height = 28;
    fire.position.set(32, 30);
    root.addChild(altar, fire);
    return (now: number) => {
      const p = pose(item, 0.35);
      fire.alpha = p;
      fire.visible = p > 0.04;
      const next = frames[frameIndex(now, Math.max(1, frames.length), 110)];
      if (next && fire.texture !== next) {
        fire.texture = next;
        fire.width = 28;
        fire.height = 28;
      }
    };
  }

  if (art.play === 'shoot' && art.projectile) {
    const trap = new Sprite(restTex);
    fit(trap);
    const bolt = tex.get(art.projectile) ?? restTex;
    const arrows = [0, 1, 2].map(() => {
      const arrow = new Sprite(bolt);
      arrow.anchor.set(0.5);
      arrow.width = 22;
      arrow.height = 22;
      arrow.rotation = -Math.PI * 0.75;
      arrow.visible = false;
      return arrow;
    });
    root.addChild(trap, ...arrows);
    return () => {
      const e = shotElapsed(item);
      arrows.forEach((arrow, i) => {
        const t = (e - i * 0.05) / 0.42;
        if (t <= 0 || t >= 1) {
          arrow.visible = false;
          return;
        }
        arrow.visible = true;
        arrow.position.set(18 + i * 14, 40 - t * 120);
        arrow.alpha = t < 0.75 ? 1 : (1 - t) / 0.25;
      });
    };
  }

  if (art.play === 'swap' && art.open) {
    const next = new Sprite(tex.get(art.open) ?? restTex);
    const current = new Sprite(restTex);
    fit(next);
    fit(current);
    root.addChild(next, current);
    return () => {
      const p = pose(item, 0.35);
      next.alpha = p;
      current.alpha = 1 - p;
    };
  }

  if (art.play === 'flow' && art.frames?.length) {
    const dry = new Sprite(restTex);
    fit(dry);
    const frames = art.frames.map((url) => tex.get(url)).filter((t): t is Texture => !!t);
    const water = new Sprite(frames[0] ?? restTex);
    fit(water);
    root.addChild(water, dry);
    return (now: number) => {
      const p = pose(item, 0.45);
      dry.alpha = 1 - p;
      water.alpha = p;
      const frame = frames[frameIndex(now, Math.max(1, frames.length), 180)];
      if (frame && water.texture !== frame) {
        water.texture = frame;
        fit(water);
      }
    };
  }

  if (art.play === 'spread' && art.open) {
    const trap = new Sprite(restTex);
    const cover = new Sprite(tex.get(art.open) ?? restTex);
    fit(trap);
    cover.anchor.set(0.5);
    const base = fit(cover);
    cover.position.set(32, 32);
    root.addChild(trap, cover);
    return () => {
      const p = springPose(item, 0.28);
      const sprung = Math.min(1, Math.max(0, p));
      cover.alpha = sprung;
      cover.scale.set(base * (0.15 + sprung * 0.85));
    };
  }

  if (art.play === 'burst' && art.open) {
    const trap = new Sprite(restTex);
    const ring = new Sprite(tex.get(art.open) ?? restTex);
    fit(trap);
    ring.anchor.set(0.5);
    const base = fit(ring);
    ring.position.set(32, 32);
    ring.visible = false;
    root.addChild(trap, ring);
    return () => {
      const e = shotElapsed(item);
      if (e < 0 || e > 0.7) {
        ring.visible = false;
        return;
      }
      const t = e / 0.7;
      ring.visible = true;
      ring.alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      ring.scale.set(base * (0.7 + t * 0.55));
    };
  }

  if (art.play === 'pulse') {
    const trap = new Sprite(restTex);
    trap.anchor.set(0.5);
    const base = fit(trap);
    trap.position.set(32, 32);
    root.addChild(trap);
    return () => {
      const e = shotElapsed(item);
      const hit = e >= 0 && e < 0.4 ? Math.sin((e / 0.4) * Math.PI) : 0;
      trap.scale.set(base * (1 + hit * 0.22));
    };
  }

  if (art.play === 'breathe') {
    const sprite = new Sprite(restTex);
    sprite.anchor.set(0.5);
    const base = fit(sprite);
    sprite.position.set(32, 32);
    root.addChild(sprite);
    return (now: number) => {
      const wave = 0.5 + 0.5 * Math.sin(now * 0.004);
      sprite.scale.set(base * (0.94 + wave * 0.1));
    };
  }

  const sprite = new Sprite(restTex);
  fit(sprite);
  root.addChild(sprite);
  return () => {};
}

/** Draw a dungeon prop from real sprites. Returns false when this image is not a prop. */
export function mountPropAnimation(c: Container, item: ImageItem): boolean {
  const id = resolvePropId(item);
  const art = id ? propArtById(id) : undefined;
  if (!art) return false;

  if (id && isDoorPropId(id)) {
    const theme = resolveDoorSurfaceStyle(item.propDoorTheme || useMapStore.getState().doorStyleId);
    return mountThemedDoor(c, item, art, theme);
  }

  stopPropAnimation(c);
  const root = new Container();
  root.label = 'prop-anim';
  const s = Math.min(item.width, item.height) / 64;
  root.scale.set(s);
  root.position.set((item.width - 64 * s) / 2, (item.height - 64 * s) / 2);
  c.addChildAt(root, 0);

  const urls = [art.rest, art.open, art.projectile, ...(art.frames ?? [])].filter((url): url is string => !!url);
  void Promise.all(urls.map(async (url) => [url, await restTexture(id, url)] as const)).then((pairs) => {
    if (c.destroyed || !root.parent) return;
    const tex = new Map(pairs);
    if (!tex.get(art.rest)) {
      root.destroy({ children: true });
      return;
    }
    const update = build(root, art, tex, item);
    const tick = () => {
      if (c.destroyed || !root.parent) {
        stopPropAnimation(c);
        return;
      }
      update(performance.now());
    };
    const ticker = sceneRefs.app.current?.ticker;
    if (ticker && art.play !== 'still') {
      ticker.add(tick);
      propTicks.set(c, tick);
    }
    tick();
  }).catch(() => {
    if (c.destroyed) return;
    root.destroy({ children: true });
    void restTexture(id, art.rest).then((tex) => {
      if (c.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.label = 'prop-fallback';
      const s = Math.min(item.width, item.height) / Math.max(tex.width, 64);
      sprite.scale.set(s);
      sprite.x = (item.width - tex.width * s) / 2;
      sprite.y = (item.height - tex.height * s) / 2;
      c.addChildAt(sprite, 0);
    }).catch(() => {});
  });

  return true;
}
