import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { searchCharacterArt } from '../services/freeArtSearch';

const router = Router();

router.get('/characters', requireAuth, async (req, res) => {
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
    const found = await searchCharacterArt(q, page);
    res.json({ portraits: found.portraits, hasMore: found.hasMore });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Art] character search failed:', message);
    res.status(502).json({ error: 'Character art search failed' });
  }
});

export default router;
