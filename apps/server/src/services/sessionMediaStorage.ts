import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';

/** Inline data URLs in socket payloads above this are stripped (prevents tab crash / disconnect). */
export const MAX_INLINE_MEDIA_URL_CHARS = 512_000;

export const SESSION_MEDIA_VIDEO_MAX_BYTES = 150 * 1024 * 1024;
export const SESSION_MEDIA_AUDIO_MAX_BYTES = 50 * 1024 * 1024;

const VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-msvideo',
]);

const AUDIO_MIMES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/aac',
  'audio/mp4',
  'audio/x-wav',
  'audio/flac',
  'audio/x-flac',
]);

export function getSessionMediaRoot(): string {
  const env = process.env['SESSION_MEDIA_DIR']?.trim();
  if (env) return path.resolve(env);
  return path.resolve(__dirname, '../../data/session-media');
}

export function mediaKindFromMime(mime: string): 'video' | 'audio' | null {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  if (VIDEO_MIMES.has(m) || m.startsWith('video/')) return 'video';
  if (AUDIO_MIMES.has(m) || m.startsWith('audio/')) return 'audio';
  return null;
}

function extFromMime(mime: string): string {
  const m = mime.toLowerCase().split(';')[0]!.trim();
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/webm': '.weba',
    'audio/aac': '.aac',
    'audio/mp4': '.m4a',
    'audio/flac': '.flac',
  };
  return map[m] ?? '';
}

export function campaignMediaDir(campaignId: string): string {
  const safe = campaignId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(getSessionMediaRoot(), safe || 'unknown');
}

export function publicMediaUrl(campaignId: string, filename: string): string {
  const safeCampaign = encodeURIComponent(campaignId);
  const safeFile = encodeURIComponent(filename);
  return `/api/session-media/${safeCampaign}/${safeFile}`;
}

export function saveSessionMediaFile(
  campaignId: string,
  originalName: string,
  mime: string,
  buffer: Buffer,
): { url: string; filename: string } {
  const dir = campaignMediaDir(campaignId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(originalName).toLowerCase() || extFromMime(mime) || '';
  const filename = `${nanoid()}${ext}`;
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return { url: publicMediaUrl(campaignId, filename), filename };
}

function isOversizedInlineUrl(url: string | null | undefined): boolean {
  return Boolean(url && url.startsWith('data:') && url.length > MAX_INLINE_MEDIA_URL_CHARS);
}

function stripUrl(url: string | null | undefined): string | null {
  if (!url) return url ?? null;
  if (isOversizedInlineUrl(url)) return null;
  return url;
}

/** Remove huge base64 blobs from live scene sync payloads. */
export function sanitizeSceneMediaUrls<T>(scene: T): T {
  const out = { ...(scene as Record<string, unknown>) };

  if ('ambientAudioUrl' in out) {
    out['ambientAudioUrl'] = stripUrl(out['ambientAudioUrl'] as string | null | undefined);
  }
  if ('backgroundVideoUrl' in out) {
    out['backgroundVideoUrl'] = stripUrl(out['backgroundVideoUrl'] as string | null | undefined);
  }

  const cfg = out['mediaConfig'];
  if (cfg && typeof cfg === 'object') {
    const nextCfg = { ...(cfg as Record<string, unknown>) };
    const popup = nextCfg['videoPopup'];
    if (popup && typeof popup === 'object' && popup !== null) {
      const p = { ...(popup as Record<string, unknown>) };
      if (typeof p['url'] === 'string' && isOversizedInlineUrl(p['url'])) {
        nextCfg['videoPopup'] = null;
      } else if (typeof p['url'] === 'string') {
        nextCfg['videoPopup'] = p;
      }
    }

    const ambientLayers = nextCfg['ambientLayers'];
    if (Array.isArray(ambientLayers)) {
      nextCfg['ambientLayers'] = ambientLayers.map((layer) => {
        if (!layer || typeof layer !== 'object') return layer;
        const l = { ...(layer as Record<string, unknown>) };
        if (typeof l['url'] === 'string' && isOversizedInlineUrl(l['url'])) {
          l['url'] = '';
        }
        return l;
      }).filter((layer) => layer && typeof layer === 'object' && (layer as { url?: string }).url);
    }

    const musicPlaylist = nextCfg['musicPlaylist'];
    if (Array.isArray(musicPlaylist)) {
      nextCfg['musicPlaylist'] = musicPlaylist.map((track) => {
        if (!track || typeof track !== 'object') return track;
        const t = { ...(track as Record<string, unknown>) };
        if (typeof t['url'] === 'string' && isOversizedInlineUrl(t['url'])) {
          t['url'] = '';
        }
        return t;
      }).filter((track) => track && typeof track === 'object' && (track as { url?: string }).url);
    }

    out['mediaConfig'] = nextCfg;
  }

  return out as T;
}
