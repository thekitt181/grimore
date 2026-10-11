import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { isFloorplanScanConfigured, scanMapFloorplan } from '../services/floorplan/floorplanScanService';
import { searchMapPacks } from '../services/freeArtSearch';
import { searchWebMaps, type WebMapHit } from '../services/mapLibrarySearch';

const router = Router();

router.get('/library', requireAuth, async (req, res) => {
  const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
  const page = Number(req.query['page'] ?? '1');
  if (!q || q.length > 120) {
    res.status(400).json({ error: 'Enter a shorter search' });
    return;
  }
  if (!Number.isInteger(page) || page < 1 || page > 10) {
    res.status(400).json({ error: 'Invalid page' });
    return;
  }
  try {
    const settled = await Promise.allSettled([searchWebMaps(q, page), searchMapPacks(q, page)]);
    const groups: WebMapHit[][] = [];
    let hasMore = false;
    for (const result of settled) {
      if (result.status !== 'fulfilled') {
        console.error('[Maps] one library source failed:', result.reason);
        continue;
      }
      groups.push(result.value.maps);
      if (result.value.hasMore) hasMore = true;
    }
    if (groups.length === 0) {
      res.status(502).json({ error: 'Image search failed' });
      return;
    }
    const seen = new Set<string>();
    const maps: WebMapHit[] = [];
    const longest = Math.max(0, ...groups.map((group) => group.length));
    for (let i = 0; i < longest; i += 1) {
      for (const group of groups) {
        const map = group[i];
        if (!map || seen.has(map.imageUrl)) continue;
        seen.add(map.imageUrl);
        maps.push(map);
      }
    }
    res.json({ maps, hasMore });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Maps] library search failed:', message);
    res.status(502).json({ error: 'Image search failed' });
  }
});

const scanBodySchema = z.object({
  backgroundUrl: z.string().min(1),
  width: z.number().int().min(8),
  height: z.number().int().min(8),
  gridSize: z.number().min(4),
  gridOffsetX: z.number().default(0),
  gridOffsetY: z.number().default(0),
  x: z.number().default(0),
  y: z.number().default(0),
  threshold: z.number().min(50).max(180).optional(),
});

router.get('/floorplan-scan/status', (_req, res) => {
  res.json({
    configured: isFloorplanScanConfigured(),
    remoteUrl: process.env['FLOORPLAN_SCAN_URL'] ?? null,
  });
});

router.post('/floorplan-scan', async (req, res) => {
  const parsed = scanBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  try {
    const { scene, meta } = await scanMapFloorplan(parsed.data, parsed.data.threshold ?? 64);
    res.json({
      ...scene,
      wallCells: Array.from(scene.wallCells),
      meta,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Maps] floorplan-scan failed:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
