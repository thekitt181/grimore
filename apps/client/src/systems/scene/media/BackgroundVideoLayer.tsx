import { useEffect, useRef, useState } from 'react';
import { useSceneMediaStore } from './sceneMediaStore';

export function BackgroundVideoLayer() {
  const scene = useSceneMediaStore((s) => s.activeScene);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dismissed, setDismissed] = useState(false);

  const popup = scene?.mediaConfig?.videoPopup;
  const url = popup?.url ?? scene?.backgroundVideoUrl ?? null;
  const showAsOverlay = popup?.showAsOverlay ?? false;

  useEffect(() => {
    setDismissed(false);
  }, [scene?.id, url]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    el.load();
    if (popup?.autoplay !== false) {
      void el.play().catch(() => undefined);
    }
  }, [url, popup?.autoplay]);

  if (!url || dismissed) return null;

  if (showAsOverlay) {
    return (
      <div className="pointer-events-none absolute inset-0 z-[12] overflow-hidden opacity-35">
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
      style={{ background: 'rgba(0,0,0,0.72)' }}
    >
      <div
        className="relative max-w-4xl w-full rounded-xl overflow-hidden shadow-2xl"
        style={{ border: '1px solid var(--color-border)' }}
      >
        <video
          ref={videoRef}
          src={url}
          className="w-full max-h-[70vh] object-cover bg-black"
          loop={popup?.loop ?? true}
          muted={popup?.muted ?? true}
          playsInline
          autoPlay
          controls
        />
        <button
          type="button"
          className="absolute top-3 right-3 btn-ghost text-sm"
          onClick={() => setDismissed(true)}
        >
          Close
        </button>
        <div
          className="px-4 py-2 font-ui text-sm"
          style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-secondary)' }}
        >
          {scene?.name ?? 'Scene video'}
        </div>
      </div>
    </div>
  );
}
