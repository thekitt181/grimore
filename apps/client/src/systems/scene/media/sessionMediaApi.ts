import axios from 'axios';
import { api } from '@/lib/axios';

export const SESSION_MEDIA_VIDEO_MAX_MB = 150;
export const SESSION_MEDIA_AUDIO_MAX_MB = 50;

export function isLocalMediaFile(file: File): boolean {
  return file.type.startsWith('video/') || file.type.startsWith('audio/');
}

export function localMediaFileTooLarge(file: File, kind: 'video' | 'ambient' | 'music'): boolean {
  const mb = file.size / (1024 * 1024);
  if (kind === 'video') return mb > SESSION_MEDIA_VIDEO_MAX_MB;
  return mb > SESSION_MEDIA_AUDIO_MAX_MB;
}

export function formatMediaSizeMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function uploadSessionMediaFile(
  sessionId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ url: string; kind: 'video' | 'audio' }> {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<{ url: string; kind: 'video' | 'audio' }>(
    `/sessions/${encodeURIComponent(sessionId)}/media`,
    form,
    {
      timeout: 15 * 60_000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onUploadProgress: (evt) => {
        if (!onProgress || !evt.total) return;
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      },
    },
  );
  return data;
}

export function mediaUploadErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg = (err.response?.data as { error?: string } | undefined)?.error;
    if (msg) return msg;
    if (err.response?.status === 413) return 'File is too large for the server.';
    if (!err.response) return 'Upload failed — check your connection and try again.';
  }
  return err instanceof Error ? err.message : 'Upload failed';
}
