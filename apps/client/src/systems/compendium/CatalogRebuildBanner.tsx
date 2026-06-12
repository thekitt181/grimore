import { useCatalogRebuildProgress } from './useCatalogRebuildProgress';

const GOLD = '#c9a84c';

/** Small banner when the compendium catalog is rebuilding after a large import. */
export function CatalogRebuildBanner() {
  const { active, label, percent } = useCatalogRebuildProgress(true);

  if (!active || !label) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] w-[min(420px,calc(100vw-2rem))] rounded-lg px-4 py-3 shadow-lg"
      style={{
        background: 'rgba(10,10,15,0.94)',
        border: '1px solid rgba(201,168,76,0.35)',
      }}
      role="status"
      aria-live="polite"
    >
      {percent != null && (
        <div
          className="h-1.5 w-full rounded overflow-hidden mb-2"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${percent}%`, background: GOLD }}
          />
        </div>
      )}
      <p className="font-ui text-[11px] leading-snug" style={{ color: GOLD }}>
        {label}
      </p>
    </div>
  );
}
