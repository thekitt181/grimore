import { Router } from 'express';
import { z } from 'zod';
import { isFloorplanScanConfigured, scanMapFloorplan } from '../services/floorplan/floorplanScanService';

const router = Router();

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
