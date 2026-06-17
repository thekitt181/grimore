/**
 * Attaches provider player APIs (YouTube / SoundCloud / Vimeo) to streaming
 * embed iframes so the master volume slider can control them. Other providers
 * (notably Spotify) expose no volume API and are left uncontrolled.
 */
import type { EmbedProvider } from './mediaEmbed';

export interface EmbedVolumeController {
  /** Set playback volume from a 0–1 value. */
  setVolume: (v01: number) => void;
  destroy: () => void;
}

/** Providers whose embeds expose a JS volume API we can drive. */
export function isVolumeControllableProvider(provider: EmbedProvider): boolean {
  return provider === 'youtube' || provider === 'soundcloud' || provider === 'vimeo';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const scriptPromises = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let p = scriptPromises.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(el);
    });
    scriptPromises.set(src, p);
  }
  return p;
}

interface YTPlayer {
  setVolume(volume: number): void;
  unMute(): void;
  playVideo(): void;
  destroy(): void;
}
interface YTPlayerConfig {
  width?: string | number;
  height?: string | number;
  videoId?: string | undefined;
  playerVars?: Record<string, string | number>;
  events?: { onReady?: () => void };
}
interface YTNamespace {
  Player: new (el: HTMLElement | string, opts: YTPlayerConfig) => YTPlayer;
}
interface SCWidget {
  setVolume(volume: number): void;
  bind(event: string, cb: () => void): void;
}
interface SCNamespace {
  Widget: ((el: HTMLIFrameElement) => SCWidget) & { Events: { READY: string } };
}
interface VimeoPlayer {
  setVolume(volume: number): Promise<number>;
  play(): Promise<void>;
  unload(): Promise<void>;
}
interface VimeoNamespace {
  Player: new (el: HTMLIFrameElement) => VimeoPlayer;
}

function getGlobal<T>(key: string): T | undefined {
  return (window as unknown as Record<string, T | undefined>)[key];
}

function whenYouTubeReady(): Promise<YTNamespace> {
  return loadScript('https://www.youtube.com/iframe_api').then(
    () =>
      new Promise<YTNamespace>((resolve) => {
        const check = () => {
          const YT = getGlobal<YTNamespace>('YT');
          if (YT && YT.Player) resolve(YT);
          else window.setTimeout(check, 50);
        };
        check();
      }),
  );
}

/**
 * Build a YouTube player inside `container` from a video/list id. This is the
 * documented IFrame API path (the API creates and owns the iframe), which is far
 * more reliable than attaching to a pre-rendered iframe — autoplay-muted then
 * unmute works consistently this way.
 */
export async function createYoutubeController(
  container: HTMLElement,
  opts: {
    videoId?: string | undefined;
    listId?: string | undefined;
    volume: number;
    loop: boolean;
  },
): Promise<EmbedVolumeController> {
  const YT = await whenYouTubeReady();
  // YT replaces the element it's given with an iframe; use a throwaway inner
  // node so React keeps owning `container` and teardown never conflicts.
  const inner = document.createElement('div');
  container.appendChild(inner);

  const playerVars: Record<string, string | number> = {
    autoplay: 1,
    mute: 1,
    controls: 1,
    rel: 0,
    modestbranding: 1,
    playsinline: 1,
  };
  if (opts.loop && opts.videoId) {
    playerVars.loop = 1;
    playerVars.playlist = opts.videoId;
  }
  if (opts.listId) {
    playerVars.list = opts.listId;
    if (!opts.videoId) playerVars.listType = 'playlist';
  }

  const player = new YT.Player(inner, {
    width: '100%',
    height: '100%',
    videoId: opts.videoId,
    playerVars,
    events: {
      onReady: () => {
        try {
          player.unMute();
          player.setVolume(Math.round(clamp01(opts.volume) * 100));
          player.playVideo();
        } catch {
          /* not ready */
        }
      },
    },
  });

  return {
    setVolume: (v) => {
      try {
        player.setVolume(Math.round(clamp01(v) * 100));
      } catch {
        /* not ready */
      }
    },
    destroy: () => {
      try {
        player.destroy();
      } catch {
        /* already gone */
      }
    },
  };
}

let idCounter = 0;

export async function createEmbedVolumeController(
  provider: EmbedProvider,
  iframe: HTMLIFrameElement,
  initialVolume: number,
): Promise<EmbedVolumeController | null> {
  if (provider === 'youtube') {
    if (!iframe.id) iframe.id = `yt-embed-${(idCounter += 1)}`;
    const YT = await whenYouTubeReady();
    const player = new YT.Player(iframe, {
      events: {
        onReady: () => {
          // The iframe autoplays muted (browsers block audible autoplay), so
          // unmute and apply the real volume once the API is live.
          try {
            player.unMute();
            player.setVolume(Math.round(clamp01(initialVolume) * 100));
            player.playVideo();
          } catch {
            /* player not ready */
          }
        },
      },
    });
    return {
      setVolume: (v) => {
        try {
          player.setVolume(Math.round(clamp01(v) * 100));
        } catch {
          /* not ready yet */
        }
      },
      destroy: () => {
        try {
          player.destroy();
        } catch {
          /* already gone */
        }
      },
    };
  }

  if (provider === 'soundcloud') {
    await loadScript('https://w.soundcloud.com/player/api.js');
    const SC = getGlobal<SCNamespace>('SC');
    if (!SC?.Widget) return null;
    const widget = SC.Widget(iframe);
    let ready = false;
    widget.bind(SC.Widget.Events.READY, () => {
      ready = true;
      widget.setVolume(Math.round(clamp01(initialVolume) * 100));
    });
    return {
      setVolume: (v) => {
        if (!ready) return;
        try {
          widget.setVolume(Math.round(clamp01(v) * 100));
        } catch {
          /* widget gone */
        }
      },
      destroy: () => {
        /* SoundCloud widget has no teardown; iframe removal is enough. */
      },
    };
  }

  if (provider === 'vimeo') {
    await loadScript('https://player.vimeo.com/api/player.js');
    const Vimeo = getGlobal<VimeoNamespace>('Vimeo');
    if (!Vimeo?.Player) return null;
    const player = new Vimeo.Player(iframe);
    // Autoplays muted; setting a non-zero volume unmutes it.
    player.setVolume(clamp01(initialVolume)).catch(() => undefined);
    player.play().catch(() => undefined);
    return {
      setVolume: (v) => {
        player.setVolume(clamp01(v)).catch(() => undefined);
      },
      destroy: () => {
        player.unload().catch(() => undefined);
      },
    };
  }

  return null;
}
