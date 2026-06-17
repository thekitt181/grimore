import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneMediaStore } from './sceneMediaStore';
import { detectEmbed, embedAudioHeight, type EmbedProvider } from './mediaEmbed';
import {
  createEmbedVolumeController,
  createYoutubeController,
  isVolumeControllableProvider,
  type EmbedVolumeController,
} from './embedVolume';

interface EmbedSource {
  key: string;
  title: string;
  src: string;
  height: number;
  provider: EmbedProvider;
  controllable: boolean;
  loop: boolean;
  youtube?: { videoId?: string | undefined; listId?: string | undefined } | undefined;
}

/** YouTube uses the IFrame API to build its own player inside this container. */
function YoutubeEmbed({ source, volume }: { source: EmbedSource; volume: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedVolumeController | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !source.youtube) return;
    let disposed = false;
    createYoutubeController(host, {
      videoId: source.youtube.videoId,
      listId: source.youtube.listId,
      volume: volumeRef.current,
      loop: source.loop,
    })
      .then((controller) => {
        if (disposed) {
          controller.destroy();
          return;
        }
        controllerRef.current = controller;
        controller.setVolume(volumeRef.current);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [source.youtube?.videoId, source.youtube?.listId, source.loop]);

  useEffect(() => {
    controllerRef.current?.setVolume(volume);
  }, [volume]);

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', height: source.height, borderRadius: 8, overflow: 'hidden' }}
    />
  );
}

/** A single streaming embed; controllable providers get a live volume hook. */
function VolumeEmbed({ source, volume }: { source: EmbedSource; volume: number }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const controllerRef = useRef<EmbedVolumeController | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    const el = iframeRef.current;
    if (!el || !source.controllable) return;
    let disposed = false;
    createEmbedVolumeController(source.provider, el, volumeRef.current)
      .then((controller) => {
        if (disposed) {
          controller?.destroy();
          return;
        }
        controllerRef.current = controller;
        controller?.setVolume(volumeRef.current);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [source.src, source.provider, source.controllable]);

  useEffect(() => {
    controllerRef.current?.setVolume(volume);
  }, [volume]);

  if (source.provider === 'youtube') {
    return <YoutubeEmbed source={source} volume={volume} />;
  }

  return (
    <iframe
      ref={iframeRef}
      title={source.title}
      src={source.src}
      width="100%"
      height={source.height}
      style={{ border: 0, borderRadius: 8, display: 'block' }}
      allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      loading="lazy"
    />
  );
}

/**
 * Plays streaming audio links (Spotify, SoundCloud, YouTube, …) that Howler
 * cannot decode, via provider iframe players in a small dock. Direct files keep
 * flowing through the Howler engine and never reach this layer.
 */
export function EmbedAudioLayer() {
  const scene = useSceneMediaStore((s) => s.activeScene);
  const ambientMuted = useSceneMediaStore((s) => s.ambientMuted);
  const musicMuted = useSceneMediaStore((s) => s.musicMuted);
  const masterVolume = useSceneMediaStore((s) => s.masterVolume);
  const musicSkipCount = useSceneMediaStore((s) => s.musicSkipCount);
  const [minimized, setMinimized] = useState(false);

  const cfg = scene?.mediaConfig;

  const sources = useMemo<EmbedSource[]>(() => {
    if (!cfg) return [];
    const out: EmbedSource[] = [];

    if (!ambientMuted) {
      for (const layer of cfg.ambientLayers) {
        const info = detectEmbed(layer.url);
        if (!info) continue;
        // YouTube/Vimeo can only autoplay while muted; their controller unmutes
        // and applies volume via the player API once ready.
        const mutedAutoplay = info.provider === 'youtube' || info.provider === 'vimeo';
        const src = info.src({ autoplay: true, loop: true, muted: mutedAutoplay, controls: true });
        if (!src) continue;
        out.push({
          key: `amb-${layer.id}`,
          title: layer.name || info.title,
          src,
          height: info.provider === 'youtube' ? 150 : info.mediaType === 'video' ? 90 : embedAudioHeight(info.provider),
          provider: info.provider,
          controllable: isVolumeControllableProvider(info.provider),
          loop: true,
          youtube: info.youtube,
        });
      }
    }

    if (!musicMuted) {
      // Iframes can't auto-sequence like Howler, so Skip cycles this index.
      const embedTracks = cfg.musicPlaylist.filter((t) => detectEmbed(t.url));
      if (embedTracks.length > 0) {
        const track = embedTracks[musicSkipCount % embedTracks.length]!;
        const info = detectEmbed(track.url)!;
        const mutedAutoplay = info.provider === 'youtube' || info.provider === 'vimeo';
        const src = info.src({ autoplay: true, loop: cfg.musicMode !== 'playlist', muted: mutedAutoplay, controls: true });
        if (src) {
          out.push({
            key: `mus-${track.id}-${musicSkipCount}`,
            title: track.name || info.title,
            src,
            height: info.provider === 'youtube' ? 180 : info.mediaType === 'video' ? 160 : embedAudioHeight(info.provider),
            provider: info.provider,
            controllable: isVolumeControllableProvider(info.provider),
            loop: cfg.musicMode !== 'playlist',
            youtube: info.youtube,
          });
        }
      }
    }

    return out;
  }, [cfg, ambientMuted, musicMuted, musicSkipCount]);

  if (sources.length === 0) return null;

  const hasUncontrollable = sources.some((s) => !s.controllable);

  return (
    <div
      className="fixed bottom-3 left-3 z-[60] w-[320px] max-w-[88vw] rounded-lg shadow-panel overflow-hidden font-ui"
      style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5 text-xs"
        style={{ borderBottom: minimized ? 'none' : '1px solid var(--color-border)' }}
      >
        <span className="uppercase tracking-wider" style={{ color: 'var(--color-accent-gold)' }}>
          ♪ Streaming audio
        </span>
        <button
          type="button"
          className="btn-ghost text-xs py-0 px-2"
          onClick={() => setMinimized((m) => !m)}
        >
          {minimized ? 'Show' : 'Hide'}
        </button>
      </div>
      <div
        style={{
          maxHeight: minimized ? 0 : 600,
          overflow: 'hidden',
          transition: 'max-height 0.2s ease',
        }}
      >
        {sources.map((s) => (
          <div key={s.key} className="px-2 py-1.5">
            <VolumeEmbed source={s} volume={masterVolume} />
          </div>
        ))}
        {hasUncontrollable && (
          <div
            className="px-3 py-1.5 text-[11px] leading-snug"
            style={{ color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)' }}
          >
            Spotify and some providers don't allow volume control from here — use the player's own
            volume or your device volume.
          </div>
        )}
      </div>
    </div>
  );
}
