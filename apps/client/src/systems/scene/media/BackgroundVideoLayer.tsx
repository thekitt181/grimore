import { useCallback, useEffect, useRef, useState } from 'react';
import { useSceneMediaStore } from './sceneMediaStore';
import { emitClearSessionVideo } from './useSceneMedia';

interface BackgroundVideoLayerProps {
  sessionId: string;
  /** GM can skip/end for everyone; players still dismiss locally when the clip ends. */
  allowDismiss?: boolean;
}

export function BackgroundVideoLayer({ sessionId, allowDismiss = false }: BackgroundVideoLayerProps) {
  const scene = useSceneMediaStore((s) => s.activeScene);
  const cinemaTakeover = useSceneMediaStore((s) => s.cinemaTakeover);
  const setCinemaTakeover = useSceneMediaStore((s) => s.setCinemaTakeover);
  const clearVideoPlayback = useSceneMediaStore((s) => s.clearVideoPlayback);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsUnmute, setNeedsUnmute] = useState(false);

  const popup = scene?.mediaConfig?.videoPopup;
  const url = popup?.url ?? scene?.backgroundVideoUrl ?? null;
  const cinemaMode = popup?.cinemaMode ?? false;
  const showAsOverlay = !cinemaMode && (popup?.showAsOverlay ?? false);

  useEffect(() => {
    if (url && cinemaMode) setCinemaTakeover(true);
    else if (!url) setCinemaTakeover(false);
  }, [url, cinemaMode, setCinemaTakeover]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    el.load();
    if (popup?.autoplay !== false) {
      el.muted = popup?.muted ?? (cinemaMode ? false : true);
      el.volume = Math.max(0, Math.min(1, popup?.volume ?? 1));
      void el.play()
        .then(() => setNeedsUnmute(false))
        .catch(() => {
          if (!el.muted) {
            el.muted = true;
            void el.play().catch(() => undefined);
            setNeedsUnmute(true);
          }
        });
    }
  }, [url, popup?.autoplay, popup?.muted, popup?.volume, cinemaMode]);

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

  if (!url) return null;

  if (cinemaMode && cinemaTakeover) {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
        style={{ pointerEvents: 'auto' }}
      >
        <video
          ref={videoRef}
          src={url}
          className="h-full w-full object-contain"
          loop={popup?.loop ?? false}
          muted={popup?.muted ?? false}
          playsInline
          autoPlay
          onEnded={handleEnded}
        />
        {needsUnmute && (
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
        <video
          ref={videoRef}
          src={url}
          className="h-full w-full object-cover"
          loop={popup?.loop ?? true}
          muted={popup?.muted ?? true}
          playsInline
          autoPlay
        />
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
        />
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
