import { useEffect, useRef } from 'react';
import { Application } from 'pixi.js';
import { isMobileClient } from '@/lib/socket';

export interface PixiAppRef {
  app: Application;
}

/**
 * Initialises a PixiJS v8 Application, attaches it to the given container div,
 * and tears it down on unmount.
 *
 * Returns a stable ref to the running Application so callers can build layers on top.
 */
export function usePixiApp(
  containerRef: React.RefObject<HTMLDivElement | null>,
  onReady: (app: Application) => void | (() => void)
) {
  const appRef = useRef<Application | null>(null);
  const cleanupRef = useRef<(() => void) | void>(undefined);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    let destroyed = false;

    async function init() {
      const app = new Application();

      const mobile = isMobileClient();
      await app.init({
        background: '#0a0a0f',
        resizeTo: container,
        antialias: !mobile,
        resolution: mobile
          ? Math.min(window.devicePixelRatio || 1, 1.5)
          : Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        ...(mobile ? {} : { powerPreference: 'high-performance' as const }),
      });

      if (destroyed) {
        app.destroy(true);
        return;
      }

      // Prevent canvas from capturing right-click browser menu
      app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
      container.appendChild(app.canvas);
      appRef.current = app;

      cleanupRef.current = onReady(app);
    }

    void init();

    return () => {
      destroyed = true;
      if (typeof cleanupRef.current === 'function') {
        cleanupRef.current();
      }
      if (appRef.current) {
        // Remove canvas first to avoid flash
        appRef.current.canvas.remove();
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
    // onReady is intentionally excluded — it's a stable callback passed once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  return appRef as React.RefObject<Application | null>;
}
