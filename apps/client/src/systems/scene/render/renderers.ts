import {
  Container, Graphics, Sprite, Text, TextStyle,
} from 'pixi.js';
import type { Item, MapItem, TokenItem, HandoutItem, DrawItem, TextItem, WallSegment } from '../types';
import { tokenShowsHpBarToPlayer } from '../types';
import { redrawGrid } from '@/systems/map/hooks/useMapGrid';
import { loadTexture } from '@/lib/textureLoader';

import { getTokenRenderType } from '../token/tokenRenderType';

export interface RenderContext {
  gm: boolean;
  activeTurnItemId?: string;
  viewMode?: '2d' | '3d';
  selectedIds?: string[];
}

import { tokenConditionColor } from '../token/tokenConditionColors';

function cssHex(hex: string): number { return parseInt(hex.replace('#', ''), 16); }

/** Base token visuals (image, aura, name) — stable during combat HP changes. */
export function tokenBaseVisualSignature(item: TokenItem): string {
  return `${item.name}|${item.imageUrl ?? ''}|${item.modelUrl ?? ''}|${item.width}|${item.height}|${item.sizeCells}|${item.auraRadius ?? 0}|${item.auraColor ?? ''}|${item.renderType ?? ''}|${item.borderColour ?? ''}`;
}

/** HP, conditions, and turn ring — cheap to patch without rebuilding the whole token. */
export function tokenOverlayVisualSignature(item: TokenItem, ctx: RenderContext): string {
  const selected = ctx.selectedIds?.includes(item.id) ?? false;
  return `${item.hp}|${item.maxHp}|${item.tempHp ?? 0}|${item.conditions.join(',')}|${ctx.activeTurnItemId === item.id}|${selected}|${ctx.gm}`;
}

/** A signature of the visual-relevant fields so we can skip needless rebuilds. */
export function itemVisualSignature(item: Item, ctx: RenderContext): string {
  const base = `${item.type}|${item.width}|${item.height}`;
  switch (item.type) {
    case 'map':
      return `${base}|${item.backgroundUrl}|${item.modelUrl ?? ''}|${item.gridSize}|${item.gridType}|${item.gridColor}|${item.gridOpacity}|${item.gridOffsetX}|${item.gridOffsetY}|${item.showGrid}`;
    case 'token':
      return `${base}|${tokenBaseVisualSignature(item)}|${ctx.viewMode ?? '2d'}`;
    case 'drawing':
      return `${base}|${item.shape}|${item.color}|${item.stroke}|${item.points.length}`;
    case 'text':
      return `${base}|${item.text}|${item.color}|${item.fontSize}`;
    case 'handout':
      return `${base}|${item.name}|${item.imageUrl}|${item.compendiumItemId}`;
  }
}

/** (Re)build a container's children for the given item. */
export function renderItem(container: Container, item: Item, ctx: RenderContext) {
  container.removeChildren();
  switch (item.type) {
    case 'map':     renderMap(container, item, ctx); break;
    case 'token':   renderToken(container, item, ctx); break;
    case 'drawing': renderDrawing(container, item); break;
    case 'text':    renderText(container, item); break;
    case 'handout': renderHandout(container, item); break;
  }
}

// ─── Map ────────────────────────────────────────────────────────────────────

function renderMap(c: Container, item: MapItem, ctx: RenderContext) {
  /** Three.js draws the GLB in 2D — hide Pixi placeholder so it stays aligned with the gizmo. */
  const hidePixiMapBody = Boolean(item.modelUrl) && ctx.viewMode !== '3d';

  const bg = new Graphics();
  bg.label = 'bg';
  bg.rect(0, 0, item.width, item.height);
  if (hidePixiMapBody) {
    bg.fill({ color: 0x0d0d14, alpha: 0.001 });
  } else {
    bg.fill({ color: 0x0d0d14 });
  }
  c.addChild(bg);

  if (item.backgroundUrl) {
    void loadTexture(item.backgroundUrl).then((tex) => {
      if (c.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.label = 'bg-image';
      sprite.width = item.width;
      sprite.height = item.height;
      c.addChildAt(sprite, 1);
    }).catch(() => {});
  } else if (item.modelUrl && !hidePixiMapBody) {
    const modelBadge = new Graphics();
    modelBadge.label = 'model-badge';
    modelBadge.rect(item.width * 0.2, item.height * 0.25, item.width * 0.6, item.height * 0.5);
    modelBadge.fill({ color: 0x1a1a28, alpha: 0.75 });
    modelBadge.setStrokeStyle({ width: 2, color: 0x8a7a50, alpha: 0.6 });
    modelBadge.stroke();
    c.addChildAt(modelBadge, 1);

    const label = new Text({
      text: '3D map\n(use 3D view toggle)',
      style: new TextStyle({
        fontFamily: 'Inter',
        fontSize: Math.max(12, Math.min(item.width, item.height) * 0.04),
        fill: 0x8a7a50,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: item.width * 0.55,
      }),
    });
    label.label = 'model-label';
    label.anchor.set(0.5);
    label.x = item.width / 2;
    label.y = item.height / 2;
    c.addChild(label);
  }

  // Grid
  const grid = new Graphics();
  grid.label = 'grid-gfx';
  redrawGrid(
    grid, item.gridType, item.width, item.height, item.gridSize,
    item.gridColor, item.gridOpacity, item.showGrid,
    item.gridOffsetX, item.gridOffsetY,
  );
  c.addChild(grid);

  // Border — subtle when Three.js renders the mesh
  const border = new Graphics();
  border.label = 'border';
  border.setStrokeStyle({
    width: 2,
    color: 0xc9a84c,
    alpha: hidePixiMapBody ? 0.15 : 0.4,
  });
  border.rect(0, 0, item.width, item.height);
  border.stroke();
  c.addChild(border);
}

export function wallVisualSignature(mapId: string, walls: WallSegment[], selectedWallIndices?: number[]): string {
  const sel = selectedWallIndices?.length ? `|sel:${[...selectedWallIndices].sort((a, b) => a - b).join(',')}` : '';
  return `walls|${mapId}|${walls.map((w) => `${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join(';')}${sel}`;
}

/** LOS walls — GM-only overlay above the map image/grid. */
export function renderMapWalls(c: Container, walls: WallSegment[], selectedIndices?: ReadonlySet<number>) {
  c.removeChildren();
  if (walls.length === 0) return;
  const wallGfx = new Graphics();
  wallGfx.label = 'walls';
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!;
    const selected = selectedIndices?.has(i) ?? false;
    wallGfx.setStrokeStyle({
      width: selected ? 4 : 3,
      color: selected ? 0xc9a84c : 0xef4444,
      alpha: selected ? 1 : 0.85,
      cap: 'round',
      join: 'round',
    });
    wallGfx.moveTo(w.a.x, w.a.y);
    wallGfx.lineTo(w.b.x, w.b.y);
    wallGfx.stroke();
  }
  c.addChild(wallGfx);
}

// ─── Token ──────────────────────────────────────────────────────────────────

const HP_BAR_HEIGHT = 6;

function renderToken(c: Container, item: TokenItem, ctx: RenderContext) {
  c.removeChildren();
  renderTokenBase(c, item, ctx);
  renderTokenOverlay(c, item, ctx);
}

/** Patch HP bar, conditions, and turn ring without rebuilding image/aura. */
export function updateTokenOverlay(c: Container, item: TokenItem, ctx: RenderContext) {
  const existing = c.getChildByLabel('token-overlay');
  if (existing) existing.destroy();
  renderTokenOverlay(c, item, ctx);
}

function renderTokenBase(c: Container, item: TokenItem, ctx: RenderContext) {
  const w = item.width;
  const h = item.height;
  const cellPx = w / item.sizeCells;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) / 2 - 4;
  const renderType = getTokenRenderType(item);
  /** Hide Pixi body when Three.js renders the token (3D view, or 2D model overlay). */
  const hidePixiBody =
    renderType === '3d' &&
    (ctx.viewMode === '3d' || Boolean(item.modelUrl));
  const borderColor = item.borderColour ? cssHex(item.borderColour) : 0xc9a84c;

  if (item.auraRadius && item.auraRadius > 0 && !hidePixiBody) {
    const aura = new Graphics();
    aura.label = 'aura';
    const color = item.auraColor ? cssHex(item.auraColor) : 0x4169e1;
    const pr = item.auraRadius * cellPx + radius;
    aura.circle(cx, cy, pr);
    aura.fill({ color, alpha: 0.18 });
    aura.circle(cx, cy, pr);
    aura.setStrokeStyle({ width: 1, color, alpha: 0.5 });
    aura.stroke();
    c.addChild(aura);
  }

  const circle = new Graphics();
  circle.label = 'circle';
  circle.circle(cx, cy, radius);
  if (hidePixiBody) {
    // Invisible hit fallback — Three.js renders this token in 3D view.
    circle.fill({ color: 0xffffff, alpha: 0.001 });
  } else if (renderType === '3d' && !item.imageUrl) {
    circle.fill({ color: 0x1c1c28 });
    circle.setStrokeStyle({ width: 3, color: borderColor });
    circle.stroke();
  } else {
    circle.fill({ color: 0x1c1c28 });
    circle.setStrokeStyle({ width: 3, color: borderColor });
    circle.stroke();
  }
  c.addChild(circle);

  if (renderType === '3d' && !item.imageUrl && !hidePixiBody) {
    const badge = new Text({
      text: '3D',
      style: new TextStyle({
        fontFamily: 'Inter',
        fontSize: Math.max(10, radius * 0.45),
        fill: borderColor,
        fontWeight: '600',
      }),
    });
    badge.anchor.set(0.5);
    badge.x = cx;
    badge.y = cy;
    c.addChild(badge);
  }

  if (item.imageUrl && !hidePixiBody) {
    void loadTexture(item.imageUrl).then((tex) => {
      if (c.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.label = 'image';
      sprite.anchor.set(0.5, 0.5);
      sprite.x = cx; sprite.y = cy;
      const d = radius * 2;
      sprite.scale.set(d / Math.max(tex.width, tex.height));
      const mask = new Graphics();
      mask.circle(cx, cy, radius - 2);
      mask.fill({ color: 0xffffff });
      sprite.mask = mask;
      c.addChildAt(sprite, Math.min(2, c.children.length));
      c.addChild(mask);
    }).catch(() => {});
  }

  if (!hidePixiBody) {
    const nameText = new Text({
      text: item.name,
      style: new TextStyle({ fontFamily: 'Inter', fontSize: 10, fill: 0xe8e0d0, stroke: { color: 0x000000, width: 3 } }),
    });
    nameText.label = 'name';
    nameText.anchor.set(0.5, 0);
    nameText.x = cx;
    nameText.y = cy + radius + 2;
    c.addChild(nameText);
  }
}

function renderTokenOverlay(c: Container, item: TokenItem, ctx: RenderContext) {
  const renderType = getTokenRenderType(item);
  const hidePixiBody =
    renderType === '3d' &&
    (ctx.viewMode === '3d' || Boolean(item.modelUrl));

  const overlay = new Container();
  overlay.label = 'token-overlay';

  const size = item.width;
  const cellPx = item.width / item.sizeCells;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 4;

  if (ctx.activeTurnItemId === item.id && !hidePixiBody) {
    const turn = new Graphics();
    turn.label = 'turn-ring';
    turn.circle(cx, cy, radius + 6);
    turn.setStrokeStyle({ width: 3, color: 0xffd700, alpha: 1 });
    turn.stroke();
    overlay.addChild(turn);
  }

  const selected = ctx.selectedIds?.includes(item.id);
  if (selected && !hidePixiBody) {
    const ring = new Graphics();
    ring.label = 'select-ring';
    ring.circle(cx, cy, radius + 5);
    ring.setStrokeStyle({
      width: 3,
      color: 0xc9a84c,
      alpha: 1,
    });
    ring.stroke();
    overlay.addChild(ring);
  }

  const showHpBar = (ctx.gm || tokenShowsHpBarToPlayer(item)) && !item.modelUrl;
  if (showHpBar) {
    const maxHp = Math.max(1, item.maxHp);
    const hpRatio = Math.max(0, item.hp / maxHp);
    const tempRatio = Math.max(0, (item.tempHp ?? 0) / maxHp);
    const barW = size - 8;
    const barX = cx - radius;
    const barY = cy + radius + 14;
    const hpBg = new Graphics();
    hpBg.label = 'hp-bg';
    hpBg.rect(barX, barY, barW, HP_BAR_HEIGHT);
    hpBg.fill({ color: 0x8b1a1a });
    overlay.addChild(hpBg);
    if (hpRatio > 0) {
      const color = hpRatio > 0.5 ? 0x4ade80 : hpRatio > 0.25 ? 0xfacc15 : 0xef4444;
      const hpFill = new Graphics();
      hpFill.label = 'hp-fill';
      hpFill.rect(barX, barY, barW * hpRatio, HP_BAR_HEIGHT);
      hpFill.fill({ color });
      overlay.addChild(hpFill);
    }
    if (tempRatio > 0) {
      const tempFill = new Graphics();
      tempFill.label = 'temp-fill';
      const tempW = Math.min(barW * tempRatio, barW - barW * hpRatio);
      tempFill.rect(barX + barW * hpRatio, barY, tempW, HP_BAR_HEIGHT);
      tempFill.fill({ color: 0x60a5fa });
      overlay.addChild(tempFill);
    }
  }

  if (item.conditions.length) {
    const dotR = Math.max(3, cellPx / 12);
    const count = item.conditions.length;
    const step = count === 1 ? 0 : (Math.PI * 2) / count;
    item.conditions.forEach((cond, i) => {
      const angle = -Math.PI / 2 + i * step;
      const dx = cx + (radius + dotR + 2) * Math.cos(angle);
      const dy = cy + (radius + dotR + 2) * Math.sin(angle);
      const dot = new Graphics();
      dot.label = `cond-${i}`;
      dot.circle(dx, dy, dotR);
      dot.fill({ color: parseInt(tokenConditionColor(cond).replace('#', ''), 16) });
      dot.setStrokeStyle({ width: 1, color: 0x000000, alpha: 0.5 });
      dot.stroke();
      overlay.addChild(dot);
    });
  }

  c.addChild(overlay);
}

// ─── Handout (item card) ────────────────────────────────────────────────────

function renderHandout(c: Container, item: HandoutItem) {
  const pad = 4;
  const innerW = item.width - pad * 2;
  const innerH = item.height - pad * 2;
  const imgH = Math.round(innerH * 0.62);

  const card = new Graphics();
  card.label = 'card';
  card.roundRect(pad, pad, innerW, innerH, 6);
  card.fill({ color: 0x14141e });
  card.roundRect(pad, pad, innerW, innerH, 6);
  card.setStrokeStyle({ width: 2, color: 0xc9a84c, alpha: 0.9 });
  card.stroke();
  c.addChild(card);

  const imgBg = new Graphics();
  imgBg.label = 'img-bg';
  imgBg.roundRect(pad + 4, pad + 4, innerW - 8, imgH, 4);
  imgBg.fill({ color: 0x0d0d14 });
  c.addChild(imgBg);

  if (item.imageUrl) {
    void loadTexture(item.imageUrl).then((tex) => {
      if (c.destroyed) return;
      const sprite = new Sprite(tex);
      sprite.label = 'image';
      const sx = (innerW - 8) / tex.width;
      const sy = imgH / tex.height;
      const scale = Math.min(sx, sy);
      sprite.scale.set(scale);
      sprite.x = pad + 4 + (innerW - 8 - tex.width * scale) / 2;
      sprite.y = pad + 4 + (imgH - tex.height * scale) / 2;
      c.addChild(sprite);
    }).catch(() => {});
  } else {
    const icon = new Text({
      text: '📜',
      style: new TextStyle({ fontSize: Math.min(28, imgH * 0.45) }),
    });
    icon.anchor.set(0.5);
    icon.x = pad + innerW / 2;
    icon.y = pad + 4 + imgH / 2;
    c.addChild(icon);
  }

  const nameText = new Text({
    text: item.name,
    style: new TextStyle({
      fontFamily: 'Inter',
      fontSize: Math.max(9, Math.min(12, innerW / 10)),
      fill: 0xe8e0d0,
      wordWrap: true,
      wordWrapWidth: innerW - 12,
      align: 'center',
    }),
  });
  nameText.anchor.set(0.5, 0);
  nameText.x = pad + innerW / 2;
  nameText.y = pad + 4 + imgH + 6;
  c.addChild(nameText);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function renderDrawing(c: Container, item: DrawItem) {
  const g = new Graphics();
  const color = cssHex(item.color);
  g.setStrokeStyle({ width: item.stroke, color, alpha: 1 });
  const p = item.points;

  switch (item.shape) {
    case 'freehand': {
      if (p.length >= 4) {
        g.moveTo(p[0]!, p[1]!);
        for (let i = 2; i < p.length - 1; i += 2) g.lineTo(p[i]!, p[i + 1]!);
        g.stroke();
      }
      break;
    }
    case 'rect': {
      g.rect(0, 0, item.width, item.height);
      g.stroke();
      break;
    }
    case 'circle': {
      g.ellipse(item.width / 2, item.height / 2, item.width / 2, item.height / 2);
      g.stroke();
      break;
    }
    case 'arrow': {
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = p;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      g.moveTo(x1, y1); g.lineTo(x2, y2);
      if (len >= 1) {
        const ux = dx / len, uy = dy / len;
        const head = Math.min(len * 0.3, 20);
        const a = Math.PI / 6;
        g.moveTo(x2, y2);
        g.lineTo(x2 - head * Math.cos(a) * ux + head * Math.sin(a) * uy, y2 - head * Math.cos(a) * uy - head * Math.sin(a) * ux);
        g.moveTo(x2, y2);
        g.lineTo(x2 - head * Math.cos(a) * ux - head * Math.sin(a) * uy, y2 - head * Math.cos(a) * uy + head * Math.sin(a) * ux);
      }
      g.stroke();
      break;
    }
  }
  c.addChild(g);
}

// ─── Text ──────────────────────────────────────────────────────────────────

function renderText(c: Container, item: TextItem) {
  const t = new Text({
    text: item.text,
    style: new TextStyle({
      fontFamily: 'Inter',
      fontSize: item.fontSize,
      fill: cssHex(item.color),
      stroke: { color: 0x000000, width: 2 },
    }),
  });
  t.x = 0; t.y = 0;
  c.addChild(t);
}
