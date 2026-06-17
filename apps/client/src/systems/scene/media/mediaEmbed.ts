/**
 * Detects shareable media links (YouTube, Spotify, SoundCloud, Vimeo, …) and
 * builds iframe-embeddable URLs for them. Direct files (mp3/mp4/data URLs) are
 * left to the native <audio>/<video>/Howler path and return null here.
 */

export type EmbedProvider =
  | 'youtube'
  | 'vimeo'
  | 'spotify'
  | 'soundcloud'
  | 'mixcloud'
  | 'bandcamp'
  | 'twitch'
  | 'applemusic'
  | 'generic';

export interface EmbedOptions {
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
}

export interface EmbedInfo {
  provider: EmbedProvider;
  /** Best-guess of what the link is, used to route audio vs video players. */
  mediaType: 'video' | 'audio';
  title: string;
  /** Build the iframe `src` for the requested playback options. */
  src: (opts: EmbedOptions) => string;
  /** YouTube ids, when applicable, so the IFrame API can build the player. */
  youtube?: { videoId?: string | undefined; listId?: string | undefined };
}

const VIDEO_FILE_RE = /\.(mp4|webm|ogv|mov|m4v)(\?.*)?$/i;
const AUDIO_FILE_RE = /\.(mp3|ogg|oga|wav|flac|aac|m4a|opus|weba)(\?.*)?$/i;

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/** A directly playable media file or data/blob URL (native element / Howler). */
export function isDirectMediaUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  return VIDEO_FILE_RE.test(url) || AUDIO_FILE_RE.test(url);
}

export function directMediaType(url: string): 'video' | 'audio' | null {
  if (url.startsWith('data:video') || VIDEO_FILE_RE.test(url)) return 'video';
  if (url.startsWith('data:audio') || AUDIO_FILE_RE.test(url)) return 'audio';
  return null;
}

function youtubeId(u: URL): { videoId?: string | undefined; listId?: string | undefined } {
  const host = u.hostname.replace(/^www\./, '');
  const list = u.searchParams.get('list') ?? undefined;
  if (host === 'youtu.be') return { videoId: u.pathname.slice(1) || undefined, listId: list };
  if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    const v = u.searchParams.get('v');
    if (v) return { videoId: v, listId: list };
    const parts = u.pathname.split('/').filter(Boolean);
    const idx = parts.findIndex((p) => p === 'embed' || p === 'shorts' || p === 'v' || p === 'live');
    if (idx >= 0 && parts[idx + 1]) return { videoId: parts[idx + 1], listId: list };
    if (list) return { listId: list };
  }
  return {};
}

function buildYoutube(u: URL): EmbedInfo | null {
  const { videoId, listId } = youtubeId(u);
  if (!videoId && !listId) return null;
  return {
    provider: 'youtube',
    mediaType: 'video',
    title: 'YouTube',
    youtube: { videoId, listId },
    src: (o) => {
      const p = new URLSearchParams();
      p.set('autoplay', o.autoplay ? '1' : '0');
      p.set('mute', o.muted ? '1' : '0');
      p.set('controls', o.controls === false ? '0' : '1');
      p.set('rel', '0');
      p.set('modestbranding', '1');
      p.set('playsinline', '1');
      // Required so the IFrame Player API can attach and control volume.
      p.set('enablejsapi', '1');
      if (typeof window !== 'undefined') p.set('origin', window.location.origin);
      if (o.loop) {
        p.set('loop', '1');
        if (videoId) p.set('playlist', videoId);
      }
      if (listId) {
        p.set('list', listId);
        if (!videoId) p.set('listType', 'playlist');
      }
      const base = videoId ? `https://www.youtube.com/embed/${videoId}` : 'https://www.youtube.com/embed/videoseries';
      return `${base}?${p.toString()}`;
    },
  };
}

function buildVimeo(u: URL): EmbedInfo | null {
  const id = u.pathname.split('/').filter(Boolean).find((p) => /^\d+$/.test(p));
  if (!id) return null;
  return {
    provider: 'vimeo',
    mediaType: 'video',
    title: 'Vimeo',
    src: (o) => {
      const p = new URLSearchParams();
      p.set('autoplay', o.autoplay ? '1' : '0');
      p.set('muted', o.muted ? '1' : '0');
      p.set('loop', o.loop ? '1' : '0');
      p.set('playsinline', '1');
      return `https://player.vimeo.com/video/${id}?${p.toString()}`;
    },
  };
}

function buildSpotify(u: URL): EmbedInfo | null {
  // open.spotify.com/{track|album|playlist|episode|show|artist}/{id}
  const parts = u.pathname.split('/').filter(Boolean);
  // Drop locale prefixes like /intl-de/
  const start = parts[0]?.startsWith('intl-') ? 1 : 0;
  const kind = parts[start];
  const id = parts[start + 1];
  const allowed = ['track', 'album', 'playlist', 'episode', 'show', 'artist'];
  if (!kind || !id || !allowed.includes(kind)) return null;
  return {
    provider: 'spotify',
    mediaType: 'audio',
    title: 'Spotify',
    src: () => `https://open.spotify.com/embed/${kind}/${id}?utm_source=grimoire`,
  };
}

function buildSoundcloud(u: URL): EmbedInfo {
  return {
    provider: 'soundcloud',
    mediaType: 'audio',
    title: 'SoundCloud',
    src: (o) => {
      const inner = `https://soundcloud.com${u.pathname}`;
      const p = new URLSearchParams();
      p.set('url', inner);
      p.set('auto_play', o.autoplay ? 'true' : 'false');
      p.set('hide_related', 'true');
      p.set('show_comments', 'false');
      p.set('show_user', 'false');
      p.set('visual', 'false');
      return `https://w.soundcloud.com/player/?${p.toString()}`;
    },
  };
}

function buildMixcloud(u: URL): EmbedInfo {
  return {
    provider: 'mixcloud',
    mediaType: 'audio',
    title: 'Mixcloud',
    src: (o) => {
      const p = new URLSearchParams();
      p.set('feed', u.pathname);
      p.set('hide_cover', '1');
      if (o.autoplay) p.set('autoplay', '1');
      return `https://www.mixcloud.com/widget/iframe/?${p.toString()}`;
    },
  };
}

function buildBandcamp(): EmbedInfo {
  // Bandcamp needs numeric album/track ids that aren't in the page URL, so we
  // fall back to a generic embed that at least loads the player chrome.
  return {
    provider: 'bandcamp',
    mediaType: 'audio',
    title: 'Bandcamp',
    src: () => '',
  };
}

function buildTwitch(u: URL): EmbedInfo | null {
  const host = u.hostname.replace(/^www\./, '');
  const parent = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  if (host === 'clips.twitch.tv') {
    const clip = u.pathname.split('/').filter(Boolean)[0];
    if (!clip) return null;
    return {
      provider: 'twitch',
      mediaType: 'video',
      title: 'Twitch',
      src: (o) => `https://clips.twitch.tv/embed?clip=${clip}&parent=${parent}&autoplay=${o.autoplay ? 'true' : 'false'}&muted=${o.muted ? 'true' : 'false'}`,
    };
  }
  const parts = u.pathname.split('/').filter(Boolean);
  const videoIdx = parts.findIndex((p) => p === 'videos');
  if (videoIdx >= 0 && parts[videoIdx + 1]) {
    const vid = parts[videoIdx + 1];
    return {
      provider: 'twitch',
      mediaType: 'video',
      title: 'Twitch',
      src: (o) => `https://player.twitch.tv/?video=${vid}&parent=${parent}&autoplay=${o.autoplay ? 'true' : 'false'}&muted=${o.muted ? 'true' : 'false'}`,
    };
  }
  const channel = parts[0];
  if (!channel) return null;
  return {
    provider: 'twitch',
    mediaType: 'video',
    title: 'Twitch',
    src: (o) => `https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=${o.autoplay ? 'true' : 'false'}&muted=${o.muted ? 'true' : 'false'}`,
  };
}

function buildAppleMusic(u: URL): EmbedInfo {
  return {
    provider: 'applemusic',
    mediaType: 'audio',
    title: 'Apple Music',
    src: () => `https://embed.music.apple.com${u.pathname}${u.search}`,
  };
}

/** Returns embed info for a shareable link, or null for direct files / unknowns. */
export function detectEmbed(rawUrl: string): EmbedInfo | null {
  if (!rawUrl) return null;
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) return null;
  const u = safeUrl(rawUrl);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, '').toLowerCase();

  if (host === 'youtu.be' || host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
    return buildYoutube(u);
  }
  if (host.endsWith('vimeo.com')) return buildVimeo(u);
  if (host === 'open.spotify.com' || host === 'spotify.com') return buildSpotify(u);
  if (host.endsWith('soundcloud.com')) return buildSoundcloud(u);
  if (host.endsWith('mixcloud.com')) return buildMixcloud(u);
  if (host.endsWith('bandcamp.com')) return buildBandcamp();
  if (host.endsWith('twitch.tv')) return buildTwitch(u);
  if (host === 'music.apple.com' || host === 'embed.music.apple.com') return buildAppleMusic(u);
  return null;
}

/** True when the URL must be played through an embed iframe rather than Howler. */
export function isEmbedUrl(url: string): boolean {
  const info = detectEmbed(url);
  return Boolean(info && info.src({ autoplay: true }));
}

/** Natural pixel height for an audio embed player chrome by provider. */
export function embedAudioHeight(provider: EmbedProvider): number {
  switch (provider) {
    case 'spotify':
      return 152;
    case 'soundcloud':
      return 120;
    case 'mixcloud':
      return 120;
    case 'applemusic':
      return 175;
    default:
      return 152;
  }
}
