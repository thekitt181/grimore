import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireSessionGM } from '../middleware/requireSessionGM';
import { deleteCompendiumEntry, getItemById, getMonsterById, getSpellById, getSyncStatus, listSources, saveItem, saveMonster, saveSpell, searchItems, searchMonsters, searchSpells, } from '../services/compendiumSync';
import { getEntryImageState, saveEntryImage, serveAssetFile, serveStaticImage, } from '../services/compendiumImages';
const router = Router();
const gm = [requireAuth, requireSessionGM];
router.get('/static-image', async (req, res) => {
    const key = typeof req.query['key'] === 'string' ? req.query['key'] : '';
    if (!key) {
        res.status(400).json({ error: 'Missing key' });
        return;
    }
    try {
        await serveStaticImage(key, res);
    }
    catch (err) {
        console.error('[Compendium] static-image:', err);
        res.status(500).json({ error: 'Failed to serve image' });
    }
});
router.get('/asset/*', (req, res) => {
    const rel = req.params['0'] ?? '';
    try {
        serveAssetFile(rel, res);
    }
    catch (err) {
        console.error('[Compendium] asset:', err);
        res.status(500).json({ error: 'Failed to serve asset' });
    }
});
router.get('/monsters/:id/images', ...gm, async (req, res) => {
    try {
        const entry = await getMonsterById(req.params['id']);
        if (!entry) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(await getEntryImageState('monster', entry.name, entry.image));
    }
    catch (err) {
        console.error('[Compendium] get monster images:', err);
        res.status(500).json({ error: 'Failed to load images' });
    }
});
router.put('/monsters/:id/images', ...gm, async (req, res) => {
    const imageUrl = req.body?.imageUrl === null ? null : typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : undefined;
    if (imageUrl === undefined) {
        res.status(400).json({ error: 'imageUrl required (string or null)' });
        return;
    }
    try {
        const entry = await getMonsterById(req.params['id']);
        if (!entry) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(await saveEntryImage('monster', entry.name, imageUrl, entry.image));
    }
    catch (err) {
        console.error('[Compendium] save monster image:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save image' });
    }
});
router.get('/items/:id/images', ...gm, async (req, res) => {
    try {
        const entry = await getItemById(req.params['id']);
        if (!entry) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(await getEntryImageState('item', entry.name, entry.image));
    }
    catch (err) {
        console.error('[Compendium] get item images:', err);
        res.status(500).json({ error: 'Failed to load images' });
    }
});
router.put('/items/:id/images', ...gm, async (req, res) => {
    const imageUrl = req.body?.imageUrl === null ? null : typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : undefined;
    if (imageUrl === undefined) {
        res.status(400).json({ error: 'imageUrl required (string or null)' });
        return;
    }
    try {
        const entry = await getItemById(req.params['id']);
        if (!entry) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(await saveEntryImage('item', entry.name, imageUrl, entry.image));
    }
    catch (err) {
        console.error('[Compendium] save item image:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save image' });
    }
});
router.get('/spells/:id/images', ...gm, async (req, res) => {
    try {
        const entry = await getSpellById(req.params['id']);
        if (!entry) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(await getEntryImageState('spell', entry.name));
    }
    catch (err) {
        console.error('[Compendium] get spell images:', err);
        res.status(500).json({ error: 'Failed to load images' });
    }
});
router.put('/spells/:id/images', ...gm, async (req, res) => {
    const imageUrl = req.body?.imageUrl === null ? null : typeof req.body?.imageUrl === 'string' ? req.body.imageUrl : undefined;
    if (imageUrl === undefined) {
        res.status(400).json({ error: 'imageUrl required (string or null)' });
        return;
    }
    try {
        const entry = await getSpellById(req.params['id']);
        if (!entry) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(await saveEntryImage('spell', entry.name, imageUrl));
    }
    catch (err) {
        console.error('[Compendium] save spell image:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save image' });
    }
});
router.get('/sync-status', ...gm, async (_req, res) => {
    try {
        res.json(await getSyncStatus());
    }
    catch (err) {
        console.error('[Compendium] sync-status error:', err);
        res.status(500).json({ error: 'Failed to read sync status' });
    }
});
router.get('/sources', ...gm, async (req, res) => {
    try {
        const kind = req.query['kind'];
        if (kind !== 'monsters' && kind !== 'items' && kind !== 'spells') {
            res.status(400).json({ error: 'kind must be monsters, items, or spells' });
            return;
        }
        res.json(await listSources(kind));
    }
    catch (err) {
        console.error('[Compendium] list sources:', err);
        res.status(500).json({ error: 'Failed to list sources' });
    }
});
router.get('/monsters', ...gm, async (req, res) => {
    try {
        const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
        const page = Number(req.query['page'] ?? 1);
        const limit = Number(req.query['limit'] ?? 50);
        const crMin = req.query['crMin'] !== undefined ? Number(req.query['crMin']) : undefined;
        const crMax = req.query['crMax'] !== undefined ? Number(req.query['crMax']) : undefined;
        const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
        const isCustom = req.query['isCustom'] === 'true' ? true : req.query['isCustom'] === 'false' ? false : undefined;
        const result = await searchMonsters({ q, page, limit, crMin, crMax, source, isCustom });
        res.json(result);
    }
    catch (err) {
        console.error('[Compendium] search monsters:', err);
        res.status(500).json({ error: 'Failed to search monsters' });
    }
});
router.get('/monsters/:id', ...gm, async (req, res) => {
    try {
        const monster = await getMonsterById(req.params['id']);
        if (!monster) {
            res.status(404).json({ error: 'Monster not found' });
            return;
        }
        res.json(monster);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to load monster' });
    }
});
router.patch('/monsters/:id', ...gm, async (req, res) => {
    try {
        const existing = await getMonsterById(req.params['id']);
        const body = req.body;
        const name = (body.name ?? existing?.name)?.trim();
        if (!name) {
            res.status(400).json({ error: 'Name required' });
            return;
        }
        const renamed = Boolean(existing?.name && name !== existing.name);
        const saved = await saveMonster({
            name,
            type: body.type ?? existing?.type ?? 'Medium humanoid, neutral',
            source: body.source ?? existing?.source ?? 'Custom',
            hp: Number(body.hp ?? existing?.hp ?? 10),
            ac: Number(body.ac ?? existing?.ac ?? 10),
            cr: String(body.cr ?? existing?.cr ?? '0'),
            description: body.description ?? existing?.description ?? '',
            ...(body.image ?? existing?.image ? { image: body.image ?? existing?.image } : {}),
        }, {
            ...(renamed ? { previousName: existing.name, hidePrevious: !existing.isCustom } : {}),
            ...(body.saveAs ? { saveAs: body.saveAs } : {}),
        });
        res.json(saved);
    }
    catch (err) {
        console.error('[Compendium] save monster:', err);
        res.status(500).json({ error: 'Failed to save monster' });
    }
});
router.post('/monsters', ...gm, async (req, res) => {
    try {
        const body = req.body;
        if (!body.name?.trim()) {
            res.status(400).json({ error: 'Name required' });
            return;
        }
        const saved = await saveMonster({
            ...body,
            source: body.source || 'Custom',
        });
        res.status(201).json(saved);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to create monster' });
    }
});
router.delete('/monsters/:id', ...gm, async (req, res) => {
    try {
        const existing = await getMonsterById(req.params['id']);
        if (!existing) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        await deleteCompendiumEntry(existing.name, 'monster');
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete monster' });
    }
});
router.get('/items', ...gm, async (req, res) => {
    try {
        const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
        const page = Number(req.query['page'] ?? 1);
        const limit = Number(req.query['limit'] ?? 50);
        const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
        const isCustom = req.query['isCustom'] === 'true' ? true : req.query['isCustom'] === 'false' ? false : undefined;
        res.json(await searchItems({ q, page, limit, source, isCustom }));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to search items' });
    }
});
router.get('/items/:id', ...gm, async (req, res) => {
    const item = await getItemById(req.params['id']);
    if (!item) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(item);
});
router.post('/items', ...gm, async (req, res) => {
    try {
        const body = req.body;
        if (!body.name?.trim()) {
            res.status(400).json({ error: 'Name required' });
            return;
        }
        const saved = await saveItem({
            ...body,
            source: body.source || 'Custom',
        });
        res.status(201).json(saved);
    }
    catch (err) {
        console.error('[Compendium] create item:', err);
        res.status(500).json({ error: 'Failed to create item' });
    }
});
router.delete('/items/:id', ...gm, async (req, res) => {
    const existing = await getItemById(req.params['id']);
    if (!existing) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    try {
        await deleteCompendiumEntry(existing.name, 'item');
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete item' });
    }
});
router.patch('/items/:id', ...gm, async (req, res) => {
    try {
        const existing = await getItemById(req.params['id']);
        const body = req.body;
        const name = (body.name ?? existing?.name)?.trim();
        if (!name) {
            res.status(400).json({ error: 'Name required' });
            return;
        }
        const renamed = Boolean(existing?.name && name !== existing.name);
        const saved = await saveItem({
            name,
            type: body.type ?? existing?.type ?? '',
            source: body.source ?? existing?.source ?? 'Custom',
            description: body.description ?? existing?.description ?? '',
            ...(body.rarity ?? existing?.rarity ? { rarity: body.rarity ?? existing?.rarity } : {}),
            ...(body.image ?? existing?.image ? { image: body.image ?? existing?.image } : {}),
        }, {
            ...(renamed ? { previousName: existing.name, hidePrevious: !existing.isCustom } : {}),
            ...(body.saveAs ? { saveAs: body.saveAs } : {}),
        });
        res.json(saved);
    }
    catch (err) {
        console.error('[Compendium] save item:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save item' });
    }
});
router.get('/spells', ...gm, async (req, res) => {
    try {
        const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
        const page = Number(req.query['page'] ?? 1);
        const limit = Number(req.query['limit'] ?? 50);
        const source = typeof req.query['source'] === 'string' ? req.query['source'] : undefined;
        const isCustom = req.query['isCustom'] === 'true' ? true : req.query['isCustom'] === 'false' ? false : undefined;
        res.json(await searchSpells({ q, page, limit, source, isCustom }));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to search spells' });
    }
});
router.get('/spells/:id', ...gm, async (req, res) => {
    const spell = await getSpellById(req.params['id']);
    if (!spell) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(spell);
});
router.post('/spells', ...gm, async (req, res) => {
    try {
        const body = req.body;
        if (!body.name?.trim()) {
            res.status(400).json({ error: 'Name required' });
            return;
        }
        const saved = await saveSpell({
            ...body,
            source: body.source || 'Custom',
        });
        res.status(201).json(saved);
    }
    catch (err) {
        console.error('[Compendium] create spell:', err);
        res.status(500).json({ error: 'Failed to create spell' });
    }
});
router.delete('/spells/:id', ...gm, async (req, res) => {
    const existing = await getSpellById(req.params['id']);
    if (!existing) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    try {
        await deleteCompendiumEntry(existing.name, 'spell');
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to delete spell' });
    }
});
router.patch('/spells/:id', ...gm, async (req, res) => {
    try {
        const existing = await getSpellById(req.params['id']);
        const body = req.body;
        const name = (body.name ?? existing?.name)?.trim();
        if (!name) {
            res.status(400).json({ error: 'Name required' });
            return;
        }
        const renamed = Boolean(existing?.name && name !== existing.name);
        const saved = await saveSpell({
            name,
            level: Number(body.level ?? existing?.level ?? 0),
            ...(body.damage ?? existing?.damage ? { damage: body.damage ?? existing?.damage } : {}),
            ...(body.type ?? existing?.type ? { type: body.type ?? existing?.type } : {}),
            ...(body.save ?? existing?.save ? { save: body.save ?? existing?.save } : {}),
            ...(body.aoe ?? existing?.aoe ? { aoe: body.aoe ?? existing?.aoe } : {}),
            ...(body.description ?? existing?.description ? { description: body.description ?? existing?.description } : {}),
            source: body.source ?? existing?.source ?? 'Custom',
        }, {
            ...(renamed ? { previousName: existing.name, hidePrevious: !existing.isCustom } : {}),
            ...(body.saveAs ? { saveAs: body.saveAs } : {}),
        });
        res.json(saved);
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to save spell' });
    }
});
export default router;
//# sourceMappingURL=compendium.js.map