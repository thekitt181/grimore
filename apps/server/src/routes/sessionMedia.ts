import { Router } from 'express';
import multer from 'multer';
import { readPrisma } from '../lib/prisma';
import { isDbPoolSaturation, withDbTimeout } from '../lib/dbTimeout';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import {
  mediaKindFromMime,
  saveSessionMediaFile,
  SESSION_MEDIA_AUDIO_MAX_BYTES,
  SESSION_MEDIA_VIDEO_MAX_BYTES,
} from '../services/sessionMediaStorage';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SESSION_MEDIA_VIDEO_MAX_BYTES },
});

type SessionGmRequest = AuthenticatedRequest & { sessionCampaignId?: string };

async function assertSessionGm(req: SessionGmRequest, res: import('express').Response, next: import('express').NextFunction) {
  try {
    const userId = req.userId!;
    const sessionId = req.params['sessionId'] as string;
    const session = await withDbTimeout(
      10_000,
      () =>
        readPrisma.gameSession.findUnique({
          where: { id: sessionId },
          select: {
            campaignId: true,
            campaign: { select: { gmId: true } },
          },
        }),
      'session media auth',
    );
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.campaign.gmId !== userId) {
      res.status(403).json({ error: 'GM only' });
      return;
    }
    req.sessionCampaignId = session.campaignId;
    next();
  } catch (err) {
    if (isDbPoolSaturation(err)) {
      res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
      return;
    }
    console.error('[SessionMedia] auth error:', err);
    res.status(500).json({ error: 'Failed to verify session' });
  }
}

// POST /api/sessions/:sessionId/media — upload local video/audio (multipart)
router.post(
  '/:sessionId/media',
  requireAuth,
  assertSessionGm,
  (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err && typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: `File too large — max ${Math.round(SESSION_MEDIA_VIDEO_MAX_BYTES / (1024 * 1024))} MB` });
        return;
      }
      if (err) {
        console.error('[SessionMedia] multer error:', err);
        res.status(400).json({ error: 'Upload failed' });
        return;
      }
      next();
    });
  },
  (req: SessionGmRequest, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Missing file' });
      return;
    }

    const kind = mediaKindFromMime(file.mimetype);
    if (!kind) {
      res.status(400).json({ error: 'Unsupported file type — use video or audio formats' });
      return;
    }

    const maxBytes = kind === 'video' ? SESSION_MEDIA_VIDEO_MAX_BYTES : SESSION_MEDIA_AUDIO_MAX_BYTES;
    if (file.size > maxBytes) {
      const maxMb = Math.round(maxBytes / (1024 * 1024));
      res.status(413).json({ error: `File too large — max ${maxMb} MB for ${kind}` });
      return;
    }

    const campaignId = req.sessionCampaignId!;
    try {
      const saved = saveSessionMediaFile(campaignId, file.originalname, file.mimetype, file.buffer);
      res.status(201).json({
        url: saved.url,
        kind,
        size: file.size,
        mime: file.mimetype,
      });
    } catch (err) {
      console.error('[SessionMedia] save error:', err);
      res.status(500).json({ error: 'Failed to save media file' });
    }
  },
);

export default router;
