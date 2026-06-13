import { Howl } from 'howler';
import type { SceneAudioLayer, SceneMediaConfig, SceneMusicTrack } from '@grimoire/shared';

const FADE_MS = 1200;
const CROSSFADE_MS = 2500;

interface LayerHandle {
  id: string;
  howl: Howl;
}

let ambientLayers: LayerHandle[] = [];
let musicHowl: Howl | null = null;
let musicIndex = 0;
let musicTracks: SceneMusicTrack[] = [];
let musicMode: SceneMediaConfig['musicMode'] = 'crossfade';
let masterVolume = 0.85;
let ambientMuted = false;
let musicMuted = false;
let musicPlaylistToken = 0;

function effectiveVolume(layerVolume: number, kind: 'ambient' | 'music'): number {
  const muted = kind === 'ambient' ? ambientMuted : musicMuted;
  if (muted) return 0;
  return Math.max(0, Math.min(1, layerVolume * masterVolume));
}

function fadeHowl(howl: Howl, to: number, ms = FADE_MS, onEnd?: () => void) {
  const from = howl.volume();
  const steps = 20;
  const stepMs = ms / steps;
  let step = 0;
  const timer = window.setInterval(() => {
    step += 1;
    const t = step / steps;
    howl.volume(from + (to - from) * t);
    if (step >= steps) {
      window.clearInterval(timer);
      onEnd?.();
    }
  }, stepMs);
}

function stopAmbientLayers() {
  for (const layer of ambientLayers) {
    try {
      fadeHowl(layer.howl, 0, FADE_MS, () => layer.howl.unload());
    } catch {
      layer.howl.unload();
    }
  }
  ambientLayers = [];
}

function stopMusic() {
  musicPlaylistToken += 1;
  if (!musicHowl) return;
  const current = musicHowl;
  musicHowl = null;
  fadeHowl(current, 0, FADE_MS, () => current.unload());
}

function playMusicTrack(index: number, token: number) {
  if (token !== musicPlaylistToken || musicTracks.length === 0) return;
  const track = musicTracks[index % musicTracks.length]!;
  if (musicHowl) {
    const prev = musicHowl;
    musicHowl = null;
    fadeHowl(prev, 0, CROSSFADE_MS, () => prev.unload());
  }
  const howl = new Howl({
    src: [track.url],
    loop: musicMode === 'single' || musicMode === 'crossfade',
    volume: effectiveVolume(track.volume, 'music'),
    html5: true,
    onend: () => {
      if (token !== musicPlaylistToken) return;
      if (musicMode === 'playlist' || musicMode === 'crossfade') {
        musicIndex = (index + 1) % musicTracks.length;
        playMusicTrack(musicIndex, token);
      }
    },
  });
  musicHowl = howl;
  howl.play();
}

function startAmbientLayers(layers: SceneAudioLayer[]) {
  stopAmbientLayers();
  for (const layer of layers) {
    const howl = new Howl({
      src: [layer.url],
      loop: layer.loop,
      volume: 0,
      html5: true,
    });
    howl.play();
    fadeHowl(howl, effectiveVolume(layer.volume, 'ambient'), FADE_MS);
    ambientLayers.push({ id: layer.id, howl });
  }
}

function startMusic(tracks: SceneMusicTrack[], mode: SceneMediaConfig['musicMode']) {
  stopMusic();
  musicTracks = tracks;
  musicMode = mode;
  musicIndex = 0;
  if (tracks.length === 0) return;
  const token = musicPlaylistToken;
  playMusicTrack(0, token);
}

/** Apply a full scene media config — fades out old layers and starts new ones. */
export function applySceneMediaConfig(config: SceneMediaConfig): void {
  masterVolume = config.masterVolume;
  startAmbientLayers(config.ambientLayers);
  if (config.musicPlaylist.length > 0) {
    startMusic(config.musicPlaylist, config.musicMode);
  } else {
    stopMusic();
  }
}

export function setMediaMasterVolume(volume: number): void {
  masterVolume = volume;
  for (const layer of ambientLayers) {
    const src = layer.howl;
    // preserve relative layer volume by reading current as proxy — re-apply on next scene apply
    src.volume(effectiveVolume(src.volume() / Math.max(masterVolume, 0.001), 'ambient'));
  }
  if (musicHowl && musicTracks[musicIndex]) {
    musicHowl.volume(effectiveVolume(musicTracks[musicIndex]!.volume, 'music'));
  }
}

export function setAmbientMuted(muted: boolean): void {
  ambientMuted = muted;
  for (const layer of ambientLayers) {
    layer.howl.volume(muted ? 0 : effectiveVolume(layer.howl.volume(), 'ambient'));
  }
}

export function setMusicMuted(muted: boolean): void {
  musicMuted = muted;
  if (musicHowl && musicTracks[musicIndex]) {
    musicHowl.volume(muted ? 0 : effectiveVolume(musicTracks[musicIndex]!.volume, 'music'));
  }
}

export function disposeMediaEngine(): void {
  stopAmbientLayers();
  stopMusic();
}

export function skipMusicTrack(): void {
  if (musicTracks.length === 0) return;
  musicIndex = (musicIndex + 1) % musicTracks.length;
  playMusicTrack(musicIndex, musicPlaylistToken);
}

export function getMediaEngineState() {
  return {
    ambientLayerCount: ambientLayers.length,
    musicTrackCount: musicTracks.length,
    musicIndex,
    masterVolume,
    ambientMuted,
    musicMuted,
  };
}
