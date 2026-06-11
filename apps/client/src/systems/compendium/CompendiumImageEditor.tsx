import { useRef, useState, useEffect } from 'react';
import axios from 'axios';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompendiumImageKind } from '@grimoire/shared';
import { fileToDataUrl } from '@/lib/imagePersistence';
import { getEntryImages, saveEntryImages } from './compendiumApi';
import { withCompendiumImageCacheBust, sameCompendiumImageUrl } from './compendiumImageUrl';
import { syncCompendiumImageToHandouts } from './syncHandoutImages';
import { preloadCompendiumImageUrl } from './preloadCompendiumImage';
import { useGrimoireAuth } from '@/hooks/useGrimoireAuth';

function saveErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const msg = err.response?.data?.error;
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return err instanceof Error ? err.message : 'Failed to save image';
}

export function CompendiumImageEditor({
  kind,
  entryId,
  entryName,
  imageEditable = true,
  fallbackUrl,
}: {
  kind: CompendiumImageKind;
  entryId: string;
  entryName: string;
  /** Allow any signed-in user to change images (default true). */
  imageEditable?: boolean;
  fallbackUrl?: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { isSignedIn } = useGrimoireAuth();
  const canEditImages = imageEditable && Boolean(isSignedIn);
  const imagesEnabled = Boolean(isSignedIn) && Boolean(entryId);
  const [urlDraft, setUrlDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  const imagesQ = useQuery({
    queryKey: ['compendium', kind, entryId, 'images'],
    queryFn: () => getEntryImages(kind, entryId),
    enabled: imagesEnabled,
    staleTime: 120_000,
  });

  const saveMut = useMutation({
    mutationFn: (imageUrl: string | null) => saveEntryImages(kind, entryId, imageUrl),
    onSuccess: (data) => {
      setSaveError(null);
      setPendingUrl(null);
      qc.setQueryData(['compendium', kind, entryId, 'images'], data);
      if (kind === 'item' && data.current) {
        syncCompendiumImageToHandouts(entryId, data.current);
      }
      preloadCompendiumImageUrl(data.current, data.updatedAt);
      void qc.invalidateQueries({ queryKey: ['compendium', kind, entryId, 'images'] });
      void qc.invalidateQueries({ queryKey: ['compendium', kind, entryId] });
      void qc.invalidateQueries({ queryKey: ['compendium', kind] });
      void qc.invalidateQueries({ queryKey: ['compendium', 'sync-status'] });
      setUrlDraft('');
    },
    onError: (err: unknown) => {
      setPendingUrl(null);
      setSaveError(saveErrorMessage(err));
    },
  });

  const state = imagesQ.data;
  const cacheVersion = state?.updatedAt ?? null;
  const rawDisplayUrl = state?.current ?? fallbackUrl ?? null;
  const displayUrl = withCompendiumImageCacheBust(
    pendingUrl && pendingUrl !== 'uploading' ? pendingUrl : rawDisplayUrl,
    cacheVersion,
  );

  useEffect(() => {
    preloadCompendiumImageUrl(rawDisplayUrl, cacheVersion);
  }, [rawDisplayUrl, cacheVersion]);
  const history = state?.history ?? (rawDisplayUrl ? [rawDisplayUrl] : []);

  async function onFilePick(file: File) {
    setSaveError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      saveMut.mutate(dataUrl);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to read file');
    }
  }

  function applyUrl() {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    saveMut.mutate(trimmed);
  }

  if (!displayUrl && !canEditImages) return null;

  return (
    <div className="space-y-2">
      {displayUrl && (
        <div
          className="flex justify-center rounded overflow-hidden"
          style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
        >
          <img
            key={displayUrl ?? 'none'}
            src={displayUrl}
            alt={entryName}
            className="max-h-32 max-w-full object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {canEditImages && (
        <>
          {!editing ? (
            <button className="btn-ghost text-xs px-2 py-0.5 w-full" onClick={() => setEditing(true)}>
              {displayUrl ? 'Change image' : 'Add image'}
            </button>
          ) : (
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFilePick(file);
                  e.target.value = '';
                }}
              />
              <div className="flex gap-1">
                <button
                  className="btn-ghost text-xs px-2 py-0.5 flex-1"
                  disabled={saveMut.isPending}
                  onClick={() => fileRef.current?.click()}
                >
                  {saveMut.isPending ? 'Uploading…' : 'Upload'}
                </button>
                {displayUrl && (
                  <button
                    className="btn-ghost text-xs px-2 py-0.5"
                    disabled={saveMut.isPending}
                    onClick={() => saveMut.mutate(null)}
                    style={{ color: 'var(--color-accent-red-hot)' }}
                  >
                    Clear
                  </button>
                )}
                <button className="btn-ghost text-xs px-2 py-0.5" onClick={() => setEditing(false)}>Done</button>
              </div>
              <div className="flex gap-1">
                <input
                  className="input-dark text-xs flex-1 py-0.5"
                  placeholder="Paste image URL…"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyUrl(); }}
                />
                <button className="btn-primary text-xs px-2 py-0.5" disabled={!urlDraft.trim() || saveMut.isPending} onClick={applyUrl}>
                  Use
                </button>
              </div>
              {history.length > 0 && (
                <ImageHistoryPicker
                  title="This entry"
                  history={history}
                  current={state?.current ?? null}
                  pendingUrl={pendingUrl}
                  cacheVersion={cacheVersion}
                  disabled={saveMut.isPending}
                  onSelect={(url) => {
                    setPendingUrl(url);
                    setSaveError(null);
                    saveMut.mutate(url);
                  }}
                />
              )}
              {saveError && (
                <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>
                  {saveError}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ImageHistoryPicker({
  title,
  history,
  current,
  pendingUrl,
  cacheVersion,
  disabled,
  onSelect,
}: {
  title: string;
  history: string[];
  current: string | null;
  pendingUrl?: string | null;
  cacheVersion?: string | null;
  disabled?: boolean;
  onSelect: (url: string) => void;
}) {
  const activeUrl = pendingUrl ?? current;

  return (
    <div>
      <p className="font-ui text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--color-text-secondary)' }}>
        {title}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {history.map((url, idx) => {
          const selected = sameCompendiumImageUrl(url, activeUrl);
          return (
          <button
            key={`${idx}:${url.slice(0, 48)}`}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(url)}
            className="rounded overflow-hidden shrink-0 transition-opacity hover:opacity-100"
            style={{
              width: 44,
              height: 44,
              opacity: selected ? 1 : 0.65,
              border: selected ? '2px solid var(--color-accent-gold)' : '1px solid var(--color-border)',
              background: 'var(--color-bg-tertiary)',
            }}
            title="Use this image"
          >
            <img
              src={withCompendiumImageCacheBust(url, selected ? cacheVersion : null) ?? url}
              alt=""
              className="w-full h-full object-contain"
            />
          </button>
          );
        })}
      </div>
    </div>
  );
}
