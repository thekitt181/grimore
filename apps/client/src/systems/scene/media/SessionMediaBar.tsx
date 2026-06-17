import { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { LightingPreset, TimeOfDay } from '@grimoire/shared';
import {
  DEFAULT_SCENE_MEDIA_CONFIG,
  LIGHTING_PRESETS,
  TIME_OF_DAY_PRESETS,
} from '@grimoire/shared';
import { fileToDataUrl } from '@/lib/imagePersistence';
import { skipMusicTrack } from './audioEngine';
import { useSceneMediaStore } from './sceneMediaStore';
import { detectEmbed } from './mediaEmbed';
import { emitSessionMediaPatch, emitSessionTimeOfDay } from './useSceneMedia';

type MenuId = 'media' | 'upload';

interface SessionMediaBarProps {
  sessionId: string;
  isGM: boolean;
}

export function SessionMediaBar({ sessionId, isGM }: SessionMediaBarProps) {
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
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
  const detectedProvider = uploadUrl.trim() ? detectEmbed(uploadUrl.trim())?.title ?? null : null;

  function toggle(menu: MenuId) {
    setOpenMenu((prev) => (prev === menu ? null : menu));
  }

  function pushLighting(preset: LightingPreset) {
    emitSessionMediaPatch(sessionId, { lightingPreset: preset });
    setOpenMenu(null);
  }

  function pushTimeOfDay(timeOfDay: TimeOfDay) {
    emitSessionTimeOfDay(sessionId, timeOfDay);
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
      <TabBtn id="upload" label="Upload" />

      {openMenu && (
        <div
          className="absolute top-full right-0 mt-1 z-[100] rounded-lg shadow-panel py-2 overflow-hidden"
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border)',
            minWidth: 260,
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
                <div className="gold-divider my-1" />
                <p className="px-1 font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
                  Time of day
                </p>
                {TIME_OF_DAY_PRESETS.map((t) => (
                  <PickBtn key={t.id} label={t.label} onClick={() => pushTimeOfDay(t.id)} />
                ))}
              </div>
            )}

            {openMenu === 'upload' && (
              <div className="space-y-2 px-1">
                <PickBtn label="Clear video" onClick={clearVideo} />
                <PickBtn label="Clear all audio" onClick={clearAudio} />
                <div className="gold-divider my-1" />
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
                  placeholder="Paste a link or file URL…"
                  value={uploadUrl}
                  onChange={(e) => setUploadUrl(e.target.value)}
                />
                {detectedProvider ? (
                  <p className="px-1 font-ui text-[10px]" style={{ color: 'var(--color-accent-gold)' }}>
                    Detected {detectedProvider} link — plays via its embedded player.
                  </p>
                ) : (
                  <p className="px-1 font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    Works with YouTube, Spotify, SoundCloud, Vimeo, Twitch links or direct MP4/MP3 files.
                  </p>
                )}
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
          </div>
        </div>
      )}
    </div>
  );
}
