import { useMemo, useState } from 'react';
import { useSceneMediaStore } from './sceneMediaStore';
import { detectEmbed, embedAudioHeight } from './mediaEmbed';

interface EmbedSource {
  key: string;
  title: string;
  src: string;
  height: number;
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
  const [minimized, setMinimized] = useState(false);

  const cfg = scene?.mediaConfig;

  const sources = useMemo<EmbedSource[]>(() => {
    if (!cfg) return [];
    const out: EmbedSource[] = [];

    if (!ambientMuted) {
      for (const layer of cfg.ambientLayers) {
        const info = detectEmbed(layer.url);
        if (!info) continue;
        const src = info.src({ autoplay: true, loop: true, muted: false, controls: true });
        if (!src) continue;
        out.push({
          key: `amb-${layer.id}`,
          title: layer.name || info.title,
          src,
          height: info.mediaType === 'video' ? 80 : embedAudioHeight(info.provider),
        });
      }
    }

    if (!musicMuted) {
      // Iframes can't be sequenced like Howler, so play the first streaming track.
      const track = cfg.musicPlaylist.find((t) => detectEmbed(t.url));
      if (track) {
        const info = detectEmbed(track.url)!;
        const src = info.src({ autoplay: true, loop: cfg.musicMode !== 'playlist', muted: false, controls: true });
        if (src) {
          out.push({
            key: `mus-${track.id}`,
            title: track.name || info.title,
            src,
            height: info.mediaType === 'video' ? 160 : embedAudioHeight(info.provider),
          });
        }
      }
    }

    return out;
  }, [cfg, ambientMuted, musicMuted]);

  if (sources.length === 0) return null;

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
            <iframe
              title={s.title}
              src={s.src}
              width="100%"
              height={s.height}
              style={{ border: 0, borderRadius: 8, display: 'block' }}
              allow="autoplay; encrypted-media; clipboard-write; fullscreen; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
