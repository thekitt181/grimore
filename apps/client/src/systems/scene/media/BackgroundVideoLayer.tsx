import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSceneMediaStore } from './sceneMediaStore';
import { emitClearSessionVideo } from './useSceneMedia';
import { detectEmbed } from './mediaEmbed';

interface BackgroundVideoLayerProps {
  sessionId: string;
  /** GM can skip/end for everyone; players still dismiss locally when the clip ends. */
  allowDismiss?: boolean;
}

export function BackgroundVideoLayer({ sessionId, allowDismiss = false }: BackgroundVideoLayerProps) {
  const scene = useSceneMediaStore((s) => s.activeScene);
  const setCinemaTakeover = useSceneMediaStore((s) => s.setCinemaTakeover);
  const clearVideoPlayback = useSceneMediaStore((s) => s.clearVideoPlayback);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const popup = scene?.mediaConfig?.videoPopup;
  const url = popup?.url ?? scene?.backgroundVideoUrl ?? null;
  const cinemaMode = popup?.cinemaMode ?? false;
  const showAsOverlay = !cinemaMode && (popup?.showAsOverlay ?? false);
  const showPopup = Boolean(url && !cinemaMode && !showAsOverlay);

  const embed = useMemo(() => (url ? detectEmbed(url) : null), [url]);

  useEffect(() => {
    setCinemaTakeover(Boolean(url && cinemaMode));
    if (!url) setLoadError(false);
  }, [url, cinemaMode, setCinemaTakeover]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url || embed) return;

    setLoadError(false);
    el.load();

    if (popup?.autoplay === false) return;

    const wantSound = cinemaMode ? !(popup?.muted ?? false) : !(popup?.muted ?? showAsOverlay);
    el.muted = !wantSound;
    el.volume = Math.max(0, Math.min(1, popup?.volume ?? 1));

    void el.play()
      .then(() => setNeedsUnmute(false))
      .catch(() => {
        if (!el.muted) {
          el.muted = true;
          void el.play().catch(() => undefined);
          if (cinemaMode || showPopup) setNeedsUnmute(true);
        }
      });
  }, [url, embed, popup?.autoplay, popup?.muted, popup?.volume, cinemaMode, showAsOverlay, showPopup]);

  const stopPlayback = useCallback(() => {
    if (allowDismiss) {
      emitClearSessionVideo(sessionId);
      return;
    }
    clearVideoPlayback();
  }, [allowDismiss, sessionId, clearVideoPlayback]);

  const handleEnded = useCallback(() => {
    if (popup?.loop) return;
    stopPlayback();
  }, [popup?.loop, stopPlayback]);

  const handleUnmute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    el.volume = Math.max(0, Math.min(1, popup?.volume ?? 1));
    void el.play().then(() => setNeedsUnmute(false)).catch(() => undefined);
  }, [popup?.volume]);

  useEffect(() => {
    return () => {
      const el = videoRef.current;
      if (!el) return;
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, []);

  if (!url) return null;

  const embedSrc = embed
    ? embed.src({
        autoplay: popup?.autoplay !== false,
        loop: popup?.loop ?? (showAsOverlay || false),
        muted: popup?.muted ?? showAsOverlay,
        controls: !showAsOverlay,
      })
    : null;

  const iframeCommon = {
    src: embedSrc ?? undefined,
    allow:
      'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write',
    allowFullScreen: true,
    referrerPolicy: 'strict-origin-when-cross-origin' as const,
    frameBorder: 0,
    onError: () => setLoadError(true),
  };

  if (cinemaMode) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
        style={{ pointerEvents: 'auto' }}
      >
        {embedSrc ? (
          <iframe {...iframeCommon} title={embed?.title ?? 'Video'} className="h-full w-full" />
        ) : (
          <video
            ref={videoRef}
            src={url}
            className="h-full w-full object-contain"
            loop={popup?.loop ?? false}
            muted={popup?.muted ?? false}
            playsInline
            autoPlay
            onEnded={handleEnded}
            onError={() => setLoadError(true)}
          />
        )}
        {loadError && (
          <p className="absolute bottom-20 left-1/2 -translate-x-1/2 font-ui text-sm text-red-300 px-4 text-center">
            Video failed to load — try a direct MP4 link or a YouTube/Vimeo URL.
          </p>
        )}
        {needsUnmute && !embedSrc && (
          <button
            type="button"
            className="absolute bottom-8 left-1/2 -translate-x-1/2 btn-primary text-sm px-4 py-2"
            onClick={handleUnmute}
          >
            Tap for sound
          </button>
        )}
        {allowDismiss && (
          <button
            type="button"
            className="absolute top-4 right-4 btn-ghost text-sm opacity-70 hover:opacity-100"
            onClick={stopPlayback}
          >
            Skip
          </button>
        )}
      </div>
    );
  }

  if (showAsOverlay) {
    return (
      <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden opacity-40">
        {embedSrc ? (
          <iframe
            {...iframeCommon}
            title={embed?.title ?? 'Video'}
            className="h-full w-full scale-150"
            style={{ pointerEvents: 'none' }}
          />
        ) : (
          <video
            ref={videoRef}
            src={url}
            className="h-full w-full object-cover"
            loop={popup?.loop ?? true}
            muted={popup?.muted ?? true}
            playsInline
            autoPlay
            onError={() => setLoadError(true)}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[50] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.92)' }}
    >
      <div
        className="relative max-w-5xl w-full rounded-xl overflow-hidden shadow-2xl"
        style={{ border: '1px solid var(--color-border)' }}
      >
        {embedSrc ? (
          <iframe
            {...iframeCommon}
            title={embed?.title ?? 'Video'}
            className="w-full aspect-video bg-black"
          />
        ) : (
          <video
            ref={videoRef}
            src={url}
            className="w-full max-h-[80vh] object-contain bg-black"
            loop={popup?.loop ?? false}
            muted={popup?.muted ?? false}
            playsInline
            autoPlay
            controls
            onEnded={handleEnded}
            onError={() => setLoadError(true)}
          />
        )}
        {loadError && (
          <p className="absolute bottom-3 left-3 right-12 font-ui text-xs text-red-300">
            Video failed to load — URL may be blocked or invalid.
          </p>
        )}
        <button
          type="button"
          className="absolute top-3 right-3 btn-ghost text-sm"
          onClick={stopPlayback}
        >
          Close
        </button>
      </div>
    </div>
  );
}
