import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { LightingPreset, MediaLibraryCategory, MediaLibraryEntry, VideoLibraryEntry } from '@grimoire/shared';
import {
  AMBIENT_SOUND_LIBRARY,
  DEFAULT_SCENE_MEDIA_CONFIG,
  LIGHTING_PRESETS,
  MUSIC_LIBRARY,
  VIDEO_LIBRARY,
} from '@grimoire/shared';
import { fileToDataUrl } from '@/lib/imagePersistence';
import { skipMusicTrack } from './audioEngine';
import { useSceneMediaStore } from './sceneMediaStore';
import { emitSessionMediaPatch } from './useSceneMedia';

type MenuId = 'media' | 'video' | 'audio' | 'upload' | 'libraries';

const LIBRARY_CATEGORIES: Array<{ id: MediaLibraryCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'tavern', label: 'Tavern' },
  { id: 'dungeon', label: 'Dungeon' },
  { id: 'forest', label: 'Forest' },
  { id: 'combat', label: 'Combat' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'temple', label: 'Temple' },
  { id: 'city', label: 'City' },
  { id: 'horror', label: 'Horror' },
  { id: 'winter', label: 'Winter' },
  { id: 'camp', label: 'Camp' },
  { id: 'library', label: 'Library' },
];

interface SessionMediaBarProps {
  sessionId: string;
  isGM: boolean;
}

export function SessionMediaBar({ sessionId, isGM }: SessionMediaBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [libraryCategory, setLibraryCategory] = useState<MediaLibraryCategory | 'all'>('all');
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadKind, setUploadKind] = useState<'video' | 'ambient' | 'music'>('video');
  const [videoOverlay, setVideoOverlay] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  const scene = useSceneMediaStore((s) => s.activeScene);
  const masterVolume = useSceneMediaStore((s) => s.masterVolume);
  const ambientMuted = useSceneMediaStore((s) => s.ambientMuted);
  const musicMuted = useSceneMediaStore((s) => s.musicMuted);
  const setMasterVolume = useSceneMediaStore((s) => s.setMasterVolume);
  const setAmbientMuted = useSceneMediaStore((s) => s.setAmbientMuted);
  const setMusicMuted = useSceneMediaStore((s) => s.setMusicMuted);

  useEffect(() => {
    if (!openMenu) return;
    function onDown(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [openMenu]);

  if (!isGM) return null;

  const cfg = scene?.mediaConfig ?? DEFAULT_SCENE_MEDIA_CONFIG;

  function toggle(menu: MenuId) {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  }

  function pushVideo(entry: VideoLibraryEntry, mode: 'cinema' | 'overlay' | 'popup' = 'cinema') {
    const videoPopup =
      mode === 'cinema'
        ? {
            url: entry.url,
            loop: false,
            muted: false,
            autoplay: true,
            volume: 1,
            showAsOverlay: false,
            cinemaMode: true,
          }
        : mode === 'overlay'
          ? {
              url: entry.url,
              loop: entry.loop,
              muted: true,
              autoplay: true,
              showAsOverlay: true,
              cinemaMode: false,
            }
          : {
              url: entry.url,
              loop: entry.loop,
              muted: false,
              autoplay: true,
              volume: 1,
              showAsOverlay: false,
              cinemaMode: false,
            };

    emitSessionMediaPatch(sessionId, {
      backgroundVideoUrl: entry.url,
      mediaConfig: {
        ...cfg,
        videoPopup,
      },
    });
    setOpenMenu(null);
  }

  function pushAmbient(entry: MediaLibraryEntry) {
    const layers = [...cfg.ambientLayers];
    if (!layers.some((l) => l.libraryId === entry.id)) {
      layers.push({
        id: uuidv4(),
        name: entry.name,
        url: entry.url,
        volume: entry.defaultVolume,
        loop: entry.loop,
        libraryId: entry.id,
        category: entry.category,
      });
    }
    emitSessionMediaPatch(sessionId, { mediaConfig: { ...cfg, ambientLayers: layers } });
    setOpenMenu(null);
  }

  function pushMusic(entry: MediaLibraryEntry) {
    emitSessionMediaPatch(sessionId, {
      mediaConfig: {
        ...cfg,
        musicMode: 'crossfade',
        musicPlaylist: [{
          id: uuidv4(),
          name: entry.name,
          url: entry.url,
          volume: entry.defaultVolume,
          libraryId: entry.id,
        }],
      },
    });
    setOpenMenu(null);
  }

  function pushLighting(preset: LightingPreset) {
    emitSessionMediaPatch(sessionId, { lightingPreset: preset });
    setOpenMenu(null);
  }

  function clearVideo() {
    emitSessionMediaPatch(sessionId, {
      backgroundVideoUrl: null,
      mediaConfig: { ...cfg, videoPopup: null },
    });
    setOpenMenu(null);
  }

  function clearAudio() {
    emitSessionMediaPatch(sessionId, {
      ambientAudioUrl: null,
      mediaConfig: { ...cfg, ambientLayers: [], musicPlaylist: [] },
    });
    setOpenMenu(null);
  }

  function applyUpload() {
    const url = uploadUrl.trim();
    if (!url) return;
    if (uploadKind === 'video') {
      const videoPopup = videoOverlay
        ? {
            url,
            loop: true,
            muted: true,
            autoplay: true,
            showAsOverlay: true,
            cinemaMode: false,
          }
        : {
            url,
            loop: false,
            muted: false,
            autoplay: true,
            volume: 1,
            showAsOverlay: false,
            cinemaMode: true,
          };
      emitSessionMediaPatch(sessionId, {
        backgroundVideoUrl: url,
        mediaConfig: {
          ...cfg,
          videoPopup,
        },
      });
    } else if (uploadKind === 'ambient') {
      const layers = [...cfg.ambientLayers, {
        id: uuidv4(),
        name: 'Custom ambient',
        url,
        volume: 0.55,
        loop: true,
      }];
      emitSessionMediaPatch(sessionId, { ambientAudioUrl: url, mediaConfig: { ...cfg, ambientLayers: layers } });
    } else {
      emitSessionMediaPatch(sessionId, {
        mediaConfig: {
          ...cfg,
          musicMode: 'single',
          musicPlaylist: [{ id: uuidv4(), name: 'Custom track', url, volume: 0.55 }],
        },
      });
    }
    setUploadUrl('');
    setOpenMenu(null);
  }

  async function onUploadFile(file: File | undefined) {
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      setUploadUrl(url);
    } catch {
      alert('Could not read that file.');
    }
  }

  function filterCategory<T extends { category: MediaLibraryCategory }>(items: T[]): T[] {
    if (libraryCategory === 'all') return items;
    return items.filter((i) => i.category === libraryCategory);
  }

  const TabBtn = ({ id, label }: { id: MenuId; label: string }) => (
    <button
      type="button"
      className="btn-ghost text-xs py-0.5 px-2"
      style={{
        color: openMenu === id ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
        borderColor: openMenu === id ? 'var(--color-accent-gold)' : 'transparent',
      }}
      onClick={() => toggle(id)}
    >
      {label}
    </button>
  );

  const PickBtn = ({ label, onClick }: { label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-2 py-1 text-xs font-ui rounded transition-colors truncate"
      style={{ color: 'var(--color-text-primary)' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-tertiary)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      {label}
    </button>
  );

  return (
    <div ref={barRef} className="relative flex flex-wrap items-center gap-1">
      <span className="font-ui text-xs uppercase tracking-wider mr-1" style={{ color: 'var(--color-text-secondary)' }}>
        Media
      </span>
      <TabBtn id="media" label="Mix" />
      <TabBtn id="video" label="Video" />
      <TabBtn id="audio" label="Audio" />
      <TabBtn id="upload" label="Upload" />
      <TabBtn id="libraries" label="Libraries" />

      {openMenu && (
        <div
          className="absolute top-full right-0 mt-1 z-[100] rounded-lg shadow-panel py-2 overflow-hidden"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            minWidth: openMenu === 'libraries' ? 320 : 260,
            maxWidth: 360,
            maxHeight: 'min(70vh, 420px)',
          }}
        >
          <div className="overflow-y-auto max-h-[min(68vh, 400px)] px-2">
            {openMenu === 'media' && (
              <div className="space-y-2">
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                  {scene?.name ?? 'Live session'}
                </p>
                <label className="flex items-center gap-2 px-1 font-ui text-xs">
                  Volume
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={masterVolume}
                    onChange={(e) => setMasterVolume(Number(e.target.value))}
                    className="flex-1"
                  />
                </label>
                <div className="flex flex-wrap gap-1 px-1">
                  <button type="button" className="btn-ghost text-xs py-0.5 px-2" onClick={() => setAmbientMuted(!ambientMuted)}>
                    {ambientMuted ? 'Amb off' : 'Amb on'}
                  </button>
                  <button type="button" className="btn-ghost text-xs py-0.5 px-2" onClick={() => setMusicMuted(!musicMuted)}>
                    {musicMuted ? 'Music off' : 'Music on'}
                  </button>
                  <button type="button" className="btn-ghost text-xs py-0.5 px-2" onClick={() => skipMusicTrack()}>
                    Skip track
                  </button>
                </div>
                <div className="gold-divider my-1" />
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                  Lighting
                </p>
                {LIGHTING_PRESETS.map((p) => (
                  <PickBtn key={p.id} label={p.label} onClick={() => pushLighting(p.id)} />
                ))}
              </div>
            )}

            {openMenu === 'video' && (
              <div className="space-y-1">
                <PickBtn label="✕ Clear video" onClick={clearVideo} />
                <div className="gold-divider my-1" />
                {VIDEO_LIBRARY.map((v) => (
                  <div key={v.id} className="flex gap-1">
                    <button type="button" className="btn-ghost text-[10px] py-0 px-1 shrink-0" onClick={() => pushVideo(v, 'cinema')} title="Cinema clip">
                      ▶
                    </button>
                    <button type="button" className="btn-ghost text-[10px] py-0 px-1 shrink-0" onClick={() => pushVideo(v, 'overlay')} title="Ambient overlay">
                      ◐
                    </button>
                    <button type="button" className="btn-ghost text-[10px] py-0 px-1 shrink-0" onClick={() => pushVideo(v, 'popup')} title="Popup">
                      ▢
                    </button>
                    <PickBtn label={v.name} onClick={() => pushVideo(v, 'cinema')} />
                  </div>
                ))}
              </div>
            )}

            {openMenu === 'audio' && (
              <div className="space-y-2">
                <PickBtn label="✕ Clear all audio" onClick={clearAudio} />
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                  Ambient layers
                </p>
                {AMBIENT_SOUND_LIBRARY.slice(0, 12).map((a) => (
                  <PickBtn key={a.id} label={`+ ${a.name}`} onClick={() => pushAmbient(a)} />
                ))}
                <div className="gold-divider my-1" />
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                  Music
                </p>
                {MUSIC_LIBRARY.map((m) => (
                  <PickBtn key={m.id} label={`♫ ${m.name}`} onClick={() => pushMusic(m)} />
                ))}
              </div>
            )}

            {openMenu === 'upload' && (
              <div className="space-y-2 px-1">
                <select
                  className="input w-full text-xs py-1"
                  value={uploadKind}
                  onChange={(e) => setUploadKind(e.target.value as typeof uploadKind)}
                >
                  <option value="video">Video</option>
                  <option value="ambient">Ambient audio</option>
                  <option value="music">Music track</option>
                </select>
                {uploadKind === 'video' && (
                  <label className="flex items-center gap-2 font-ui text-xs">
                    <input type="checkbox" checked={videoOverlay} onChange={(e) => setVideoOverlay(e.target.checked)} />
                    Ambient overlay loop (off = fullscreen cinema clip with sound)
                  </label>
                )}
                <input
                  className="input w-full text-xs py-1"
                  placeholder="Paste URL…"
                  value={uploadUrl}
                  onChange={(e) => setUploadUrl(e.target.value)}
                />
                <input
                  type="file"
                  accept={uploadKind === 'video' ? 'video/*' : 'audio/*'}
                  className="w-full text-[10px]"
                  onChange={(e) => void onUploadFile(e.target.files?.[0])}
                />
                <button type="button" className="btn-primary w-full text-xs py-1" onClick={applyUpload} disabled={!uploadUrl.trim()}>
                  Push live
                </button>
              </div>
            )}

            {openMenu === 'libraries' && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1 px-1">
                  {LIBRARY_CATEGORIES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded font-ui"
                      style={{
                        background: libraryCategory === c.id ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-tertiary)',
                        color: libraryCategory === c.id ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)',
                      }}
                      onClick={() => setLibraryCategory(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-accent-gold)' }}>
                  Ambient
                </p>
                {filterCategory(AMBIENT_SOUND_LIBRARY).map((a) => (
                  <PickBtn key={a.id} label={`+ ${a.name}`} onClick={() => pushAmbient(a)} />
                ))}
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-accent-gold)' }}>
                  Music
                </p>
                {filterCategory(MUSIC_LIBRARY).map((m) => (
                  <PickBtn key={m.id} label={`♫ ${m.name}`} onClick={() => pushMusic(m)} />
                ))}
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-accent-gold)' }}>
                  Video
                </p>
                {filterCategory(VIDEO_LIBRARY).map((v) => (
                  <PickBtn key={v.id} label={`▶ ${v.name}`} onClick={() => pushVideo(v, 'cinema')} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
