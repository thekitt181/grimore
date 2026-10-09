import { Router } from 'express';
import type { OwlbearItem, OwlbearMonster, OwlbearSpell } from '@grimoire/shared';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { requireCompendiumAdmin, isCompendiumAdmin, getCompendiumAdminPassword, matchesCompendiumAdminPassword } from '../middleware/requireCompendiumAdmin';
import { isDbPoolSaturation } from '../lib/dbTimeout';
import { scheduleCompendiumStartupBackground } from '../services/compendiumStartup';
import {
  deleteCompendiumEntry,
  findCatalogItem,
  findCatalogMonster,
  findCatalogSpell,
  getCompendiumVisibilityPolicy,
  getItemById,
  getMonsterById,
  getSpellById,
  getSyncStatus,
  listAllBookSources,
  listSources,
  reconcileCompendiumMongo,
  saveItem,
  saveMonster,
  saveSpell,
  listVisibleItems,
  searchItems,
  searchMonsters,
  searchSpells,
  type CompendiumSaveOptions,
} from '../services/compendiumSync';
import {
  lockCompendiumSource,
  unlockCompendiumSource,
  publishCompendiumEntry,
  unpublishCompendiumEntry,
} from '../services/compendiumSourcePolicy';
import {
  getEntryImageState,
  saveEntryImage,
  serveAssetFile,
  fetchPublicImage,
  serveStaticImage,
} from '../services/compendiumImages';
import { rollLootFromItems } from '../services/lootRoll';
import { rollShopStock } from '../services/shopStock';

const router = Router();
const auth = [requireAuth] as const;
const admin = [requireAuth, requireCompendiumAdmin] as const;

function buildCompendiumPatchSaveOpts(
  entryId: string,
  existing: { name: string; isCustom: boolean },
  body: { saveAs?: 'replace' | 'homebrew' },
): CompendiumSaveOptions {
  const opts: CompendiumSaveOptions = { replaceEntryId: entryId };
  if (body.saveAs) opts.saveAs = body.saveAs;
  if (body.saveAs === 'replace') {
    opts.previousName = existing.name;
    opts.hidePrevious = !existing.isCustom;
  }
  return opts;
}

function respondCompendiumError(
  res: import('express').Response,
  err: unknown,
  logLabel: string,
  message: string,
): void {
  if (isDbPoolSaturation(err)) {
    res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
    return;
  }
  console.error(logLabel, err);
  res.status(500).json({ error: message });
}

// ─── Lightweight routes (no compendium DB startup) ───────────────────────────

router.post('/admin/verify', ...auth, (req: AuthenticatedRequest, res) => {
  const expected = getCompendiumAdminPassword();
  if (!expected) {
    res.status(503).json({ ok: false, error: 'Admin password not configured on server' });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (matchesCompendiumAdminPassword(password)) {
    res.json({ ok: true });
    return;
  }
  res.status(403).json({ ok: false, error: 'Incorrect password' });
});

router.get('/admin/configured', ...auth, (_req, res) => {
  res.json({ configured: Boolean(getCompendiumAdminPassword()) });
});

router.get('/proxy-image', async (req, res) => {
  const url = typeof req.query['url'] === 'string' ? req.query['url'] : '';
  try {
    const image = await fetchPublicImage(url);
    if (!image) {
      res.status(400).json({ error: 'Invalid image URL' });
      return;
    }
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(image.body);
  } catch (err) {
    respondCompendiumError(res, err, '[Compendium] proxy-image:', 'Failed to proxy image');
  }
});

router.get('/static-image', async (req, res) => {
  const key = typeof req.query['key'] === 'string' ? req.query['key'] : '';
  if (!key) {
    res.status(400).json({ error: 'Missing key' });
    return;
  }
  try {
    await serveStaticImage(key, res);
  } catch (err) {
    respondCompendiumError(res, err, '[Compendium] static-image:', 'Failed to serve image');
  }
});

router.get('/asset/*', (req, res) => {
  const rel = (req.params as { 0?: string })['0'] ?? '';
  try {
    serveAssetFile(rel, res);
  } catch (err) {
    respondCompendiumError(res, err, '[Compendium] asset:', 'Failed to serve asset');
  }
});

router.get('/sync-status', ...auth, async (_req, res) => {
  scheduleCompendiumStartupBackground();
  try {
    res.json(await getSyncStatus());
  } catch (err) {
    respondCompendiumError(res, err, '[Compendium] sync-status error:', 'Failed to read sync status');
  }
});

router.post('/reconcile-mongo', ...auth, async (req: AuthenticatedRequest, res) => {
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : 'client-reconcile';
  const deferCatalogRebuild = req.body?.deferCatalogRebuild === true;
  const strict = req.body?.strict !== false;
  try {
    res.json(await reconcileCompendiumMongo(reason || 'client-reconcile', { deferCatalogRebuild, strict }));
  } catch (err) {
    console.error('[Compendium] reconcile-mongo error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to reconcile compendium storage' });
  }
});

// Startup can sit on a large database write. Lists use the in-memory catalog and must not wait for it.
router.use((_req, _res, next) => {
  scheduleCompendiumStartupBackground();
  next();
});

router.get('/admin/visibility-policy', ...admin, async (_req, res) => {
  try {
    res.json(await getCompendiumVisibilityPolicy());
  } catch (err) {
    console.error('[Compendium] visibility-policy:', err);
    res.status(500).json({ error: 'Failed to load visibility policy' });
  }
});

router.post('/admin/sources/lock', ...admin, async (req, res) => {
  const sourceLabel = typeof req.body?.sourceLabel === 'string' ? req.body.sourceLabel.trim() : '';
  if (!sourceLabel) {
    res.status(400).json({ error: 'sourceLabel required' });
    return;
  }
  try {
    res.json(await lockCompendiumSource(sourceLabel));
  } catch (err) {
    console.error('[Compendium] lock source:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to lock source' });
  }
});

router.post('/admin/sources/unlock', ...admin, async (req, res) => {
  const sourceLabel = typeof req.body?.sourceLabel === 'string' ? req.body.sourceLabel.trim() : '';
  if (!sourceLabel) {
    res.status(400).json({ error: 'sourceLabel required' });
    return;
  }
  try {
    res.json(await unlockCompendiumSource(sourceLabel));
  } catch (err) {
    console.error('[Compendium] unlock source:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to unlock source' });
  }
});

router.post('/admin/entries/publish', ...admin, async (req, res) => {
  const kind = req.body?.kind;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if ((kind !== 'monster' && kind !== 'item' && kind !== 'spell') || !name) {
    res.status(400).json({ error: 'kind (monster|item|spell) and name required' });
    return;
  }
  try {
    res.json(await publishCompendiumEntry(kind, name));
  } catch (err) {
    console.error('[Compendium] publish entry:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to publish entry' });
  }
});

router.post('/admin/entries/unpublish', ...admin, async (req, res) => {
  const kind = req.body?.kind;
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if ((kind !== 'monster' && kind !== 'item' && kind !== 'spell') || !name) {
    res.status(400).json({ error: 'kind (monster|item|spell) and name required' });
    return;
  }
  try {
    res.json(await unpublishCompendiumEntry(kind, name));
  } catch (err) {
    console.error('[Compendium] unpublish entry:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to unpublish entry' });
  }
});

function compendiumGetOpts(req: AuthenticatedRequest): {
  includeDrafts: boolean;
  source?: string;
} {
  const source = typeof req.query['source'] === 'string' ? req.query['source'].trim() : undefined;
  return {
    includeDrafts: isCompendiumAdmin(req) || Boolean(source),
    ...(source ? { source } : {}),
  };
}

router.get('/monsters/:id/images', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const entry = await getMonsterById(req.params['id']!, compendiumGetOpts(req));
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(await getEntryImageState('monster', entry.name, entry.image));
  } catch (err) {
    console.error('[Compendium] get monster images:', err);
    res.status(500).json({ error: 'Failed to load images' });
  }
});

router.put('/monsters/:id/images', ...auth, async (req, res) => {
  const imageUrl = req.body?.imageUrl === null ? null : typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : undefined;
  if (imageUrl === undefined) { res.status(400).json({ error: 'imageUrl required (string or null)' }); return; }
  try {
    const entry = await findCatalogMonster(req.params['id']!);
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(await saveEntryImage('monster', entry.name, imageUrl, entry.image));
  } catch (err) {
    console.error('[Compendium] save monster image:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save image' });
  }
});

router.get('/items/:id/images', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const entry = await getItemById(req.params['id']!, compendiumGetOpts(req));
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(await getEntryImageState('item', entry.name, entry.image));
  } catch (err) {
    console.error('[Compendium] get item images:', err);
    res.status(500).json({ error: 'Failed to load images' });
  }
});

router.put('/items/:id/images', ...auth, async (req, res) => {
  const imageUrl = req.body?.imageUrl === null ? null : typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : undefined;
  if (imageUrl === undefined) { res.status(400).json({ error: 'imageUrl required (string or null)' }); return; }
  try {
    const entry = await findCatalogItem(req.params['id']!);
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(await saveEntryImage('item', entry.name, imageUrl, entry.image));
  } catch (err) {
    console.error('[Compendium] save item image:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save image' });
  }
});

router.get('/spells/:id/images', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const entry = await getSpellById(req.params['id']!, compendiumGetOpts(req));
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(await getEntryImageState('spell', entry.name, undefined));
  } catch (err) {
    console.error('[Compendium] get spell images:', err);
    res.status(500).json({ error: 'Failed to load images' });
  }
});

router.put('/spells/:id/images', ...auth, async (req, res) => {
  const imageUrl = req.body?.imageUrl === null ? null : typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : undefined;
  if (imageUrl === undefined) { res.status(400).json({ error: 'imageUrl required (string or null)' }); return; }
  try {
    const entry = await findCatalogSpell(req.params['id']!);
    if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(await saveEntryImage('spell', entry.name, imageUrl));
  } catch (err) {
    console.error('[Compendium] save spell image:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save image' });
  }
});

router.get('/sources', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const kind = req.query['kind'];
    if (kind === 'books') {
      res.json(await listAllBookSources());
      return;
    }
    if (kind !== 'monsters' && kind !== 'items' && kind !== 'spells') {
      res.status(400).json({ error: 'kind must be monsters, items, spells, or books' });
      return;
    }
    const books = req.query['books'] === '1' || req.query['books'] === 'true';
    res.json(await listSources(kind, {
      includeDrafts: !books && isCompendiumAdmin(req),
      excludeBundled: books,
    }));
  } catch (err) {
    console.error('[Compendium] list sources:', err);
    res.status(500).json({ error: 'Failed to list sources' });
  }
});

router.get('/monsters', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    const page = Number(req.query['page'] ?? 1);
    const limit = Number(req.query['limit'] ?? 50);
    const crMin = req.query['crMin'] !== undefined ? Number(req.query['crMin']) : undefined;
    const crMax = req.query['crMax'] !== undefined ? Number(req.query['crMax']) : undefined;
    const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
    const isCustom = req.query['isCustom'] === 'true' ? true : req.query['isCustom'] === 'false' ? false : undefined;
    const includeDrafts = isCompendiumAdmin(req) || Boolean(source?.trim());
    const result = await searchMonsters({ q, page, limit, crMin, crMax, source, isCustom, includeDrafts });
    res.json(result);
  } catch (err) {
    respondCompendiumError(res, err, '[Compendium] search monsters:', 'Failed to search monsters');
  }
});

router.get('/monsters/:id', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const monster = await getMonsterById(req.params['id']!, compendiumGetOpts(req));
    if (!monster) {
      res.status(404).json({ error: 'Monster not found' });
      return;
    }
    res.json(monster);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load monster' });
  }
});

router.patch('/monsters/:id', ...admin, async (req: AuthenticatedRequest, res) => {
  try {
    const existing = await getMonsterById(req.params['id']!);
    const body = req.body as Partial<OwlbearMonster> & { saveAs?: 'replace' | 'homebrew' };
    const name = (body.name ?? existing?.name)?.trim();
    if (!name) {
      res.status(400).json({ error: 'Name required' });
      return;
    }
    if (!existing) {
      res.status(404).json({ error: 'Monster not found' });
      return;
    }
    const saved = await saveMonster({
      ...existing,
      ...body,
      name,
      type: body.type ?? existing.type ?? 'Medium humanoid, neutral',
      source: body.source ?? existing.source ?? 'Custom',
      hp: Number(body.hp ?? existing.hp ?? 10),
      ac: Number(body.ac ?? existing.ac ?? 10),
      cr: String(body.cr ?? existing.cr ?? '0'),
      description: body.description ?? existing.description ?? '',
      ...(body.image ?? existing.image ? { image: body.image ?? existing.image } : {}),
    }, buildCompendiumPatchSaveOpts(req.params['id']!, existing, body));
    res.json(saved);
  } catch (err) {
    console.error('[Compendium] save monster:', err);
    const message = err instanceof Error ? err.message : 'Failed to save monster';
    res.status(500).json({ error: message });
  }
});

router.post('/monsters', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as OwlbearMonster;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Name required' });
      return;
    }
    const saved = await saveMonster({
      ...body,
      source: body.source || 'Custom',
    }, isCompendiumAdmin(req) ? undefined : { saveAs: 'homebrew' });
    res.status(201).json(saved);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create monster' });
  }
});

router.delete('/monsters/:id', ...admin, async (req, res) => {
  try {
    const existing = await getMonsterById(req.params['id']!);
    if (!existing) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    await deleteCompendiumEntry(existing.name, 'monster');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete monster' });
  }
});

router.get('/shop', ...auth, async (req: AuthenticatedRequest, res) => {
  const shop = typeof req.query['shop'] === 'string' ? req.query['shop'].trim().slice(0, 80) : '';
  try {
    const items = await listVisibleItems(isCompendiumAdmin(req));
    res.json(rollShopStock(items, shop));
  } catch {
    res.status(500).json({ error: 'Failed to stock the shop' });
  }
});

router.get('/loot', ...auth, async (req: AuthenticatedRequest, res) => {
  const levelRaw = typeof req.query['level'] === 'string' ? req.query['level'].trim() : '';
  const level = levelRaw === '' ? null : Number(levelRaw);
  const min = Number(req.query['min']);
  const max = Number(req.query['max']);
  const source = typeof req.query['source'] === 'string' ? req.query['source'].trim().slice(0, 40) : 'any';
  const name = typeof req.query['name'] === 'string' ? req.query['name'].trim().slice(0, 80) : '';
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    res.status(400).json({ error: 'Min and max are required' });
    return;
  }
  if ((level != null && (!Number.isFinite(level) || level < 1 || level > 20)) || min < 1 || max < 1 || min > 20 || max > 20) {
    res.status(400).json({ error: 'Level must be blank or 1–20, and the loot count must be 1–20' });
    return;
  }
  try {
    const items = await listVisibleItems(isCompendiumAdmin(req));
    res.json(rollLootFromItems(items, level, min, max, source || 'any', name));
  } catch {
    res.status(500).json({ error: 'Failed to roll loot' });
  }
});

router.get('/items', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    const page = Number(req.query['page'] ?? 1);
    const limit = Number(req.query['limit'] ?? 50);
    const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
    const isCustom = req.query['isCustom'] === 'true' ? true : req.query['isCustom'] === 'false' ? false : undefined;
    const includeDrafts = isCompendiumAdmin(req) || Boolean(source?.trim());
    res.json(await searchItems({ q, page, limit, source, isCustom, includeDrafts }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to search items' });
  }
});

router.get('/items/:id', ...auth, async (req: AuthenticatedRequest, res) => {
  const item = await getItemById(req.params['id']!, compendiumGetOpts(req));
  if (!item) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(item);
});

router.post('/items', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as OwlbearItem;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Name required' });
      return;
    }
    const saved = await saveItem({
      ...body,
      source: body.source || 'Custom',
    }, isCompendiumAdmin(req) ? undefined : { saveAs: 'homebrew' });
    res.status(201).json(saved);
  } catch (err) {
    console.error('[Compendium] create item:', err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

router.delete('/items/:id', ...admin, async (req, res) => {
  const existing = await getItemById(req.params['id']!);
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  try {
    await deleteCompendiumEntry(existing.name, 'item');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

router.patch('/items/:id', ...admin, async (req, res) => {
  try {
    const existing = await getItemById(req.params['id']!);
    const body = req.body as Partial<OwlbearItem> & { saveAs?: 'replace' | 'homebrew' };
    const name = (body.name ?? existing?.name)?.trim();
    if (!name) { res.status(400).json({ error: 'Name required' }); return; }
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    const saved = await saveItem({
      ...existing,
      ...body,
      name,
      type: body.type ?? existing.type ?? '',
      source: body.source ?? existing.source ?? 'Custom',
      description: body.description ?? existing.description ?? '',
      ...(body.rarity ?? existing.rarity ? { rarity: body.rarity ?? existing.rarity } : {}),
      ...(body.image ?? existing.image ? { image: body.image ?? existing.image } : {}),
    }, buildCompendiumPatchSaveOpts(req.params['id']!, existing, body));
    res.json(saved);
  } catch (err) {
    console.error('[Compendium] save item:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save item' });
  }
});

router.get('/spells', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    const page = Number(req.query['page'] ?? 1);
    const limit = Number(req.query['limit'] ?? 50);
    const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
    const isCustom = req.query['isCustom'] === 'true' ? true : req.query['isCustom'] === 'false' ? false : undefined;
    const includeDrafts = isCompendiumAdmin(req) || Boolean(source?.trim());
    res.json(await searchSpells({ q, page, limit, source, isCustom, includeDrafts }));
  } catch (err) {
    res.status(500).json({ error: 'Failed to search spells' });
  }
});

router.get('/spells/:id', ...auth, async (req: AuthenticatedRequest, res) => {
  const spell = await getSpellById(req.params['id']!, compendiumGetOpts(req));
  if (!spell) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(spell);
});

router.post('/spells', ...auth, async (req: AuthenticatedRequest, res) => {
  try {
    const body = req.body as OwlbearSpell;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Name required' });
      return;
    }
    const saved = await saveSpell({
      ...body,
      source: body.source || 'Custom',
    }, isCompendiumAdmin(req) ? undefined : { saveAs: 'homebrew' });
    res.status(201).json(saved);
  } catch (err) {
    console.error('[Compendium] create spell:', err);
    res.status(500).json({ error: 'Failed to create spell' });
  }
});

router.delete('/spells/:id', ...admin, async (req, res) => {
  const existing = await getSpellById(req.params['id']!);
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  try {
    await deleteCompendiumEntry(existing.name, 'spell');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete spell' });
  }
});

router.patch('/spells/:id', ...admin, async (req, res) => {
  try {
    const existing = await getSpellById(req.params['id']!);
    const body = req.body as Partial<OwlbearSpell> & { saveAs?: 'replace' | 'homebrew' };
    const name = (body.name ?? existing?.name)?.trim();
    if (!name) { res.status(400).json({ error: 'Name required' }); return; }
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    const saved = await saveSpell({
      ...existing,
      ...body,
      name,
      level: Number(body.level ?? existing.level ?? 0),
      ...(body.damage ?? existing.damage ? { damage: body.damage ?? existing.damage } : {}),
      ...(body.type ?? existing.type ? { type: body.type ?? existing.type } : {}),
      ...(body.save ?? existing.save ? { save: body.save ?? existing.save } : {}),
      ...(body.aoe ?? existing.aoe ? { aoe: body.aoe ?? existing.aoe } : {}),
      ...(body.description ?? existing.description ? { description: body.description ?? existing.description } : {}),
      source: body.source ?? existing.source ?? 'Custom',
    }, buildCompendiumPatchSaveOpts(req.params['id']!, existing, body));
    res.json(saved);
  } catch (err) {
    console.error('[Compendium] save spell:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save spell' });
  }
});

export default router;
