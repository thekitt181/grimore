import { useEffect, useState } from 'react';
import {
  formatDdbImportJobProgress,
  getHiddenDdbImportBannerJobId,
  setHiddenDdbImportBannerJobId,
} from './ddbApi';
import { useDdbImportJob } from './useDdbImportJob';

const GOLD = 'var(--color-accent-gold)';

export function DdbImportJobBanner({ enabled = true }: { enabled?: boolean }) {
  const { job, isRunning, verb, progressPercent, cancelImport, isCancelling } = useDdbImportJob(enabled);
  const [bannerHidden, setBannerHidden] = useState(false);

  useEffect(() => {
    if (!job?.id) {
      setBannerHidden(false);
      return;
    }
    if (job.status !== 'running') {
      setHiddenDdbImportBannerJobId(null);
      setBannerHidden(false);
      return;
    }
    setBannerHidden(getHiddenDdbImportBannerJobId() === job.id);
  }, [job?.id, job?.status]);

  if (!job || !isRunning || bannerHidden) return null;

  const label = job.progress
    ? formatDdbImportJobProgress(job.progress, verb)
    : `Background ${verb} running…`;

  function hideBanner() {
    setHiddenDdbImportBannerJobId(job!.id);
    setBannerHidden(true);
  }

  return (
    <div
      className="font-ui text-xs px-4 py-2 shrink-0"
      style={{
        background: 'rgba(201,168,76,0.12)',
        borderBottom: `1px solid ${GOLD}`,
        color: GOLD,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="leading-snug">
            D&amp;D Beyond {verb} continues in the background — safe to refresh or close this tab.
          </p>
          <p className="text-[10px] opacity-90 leading-snug">{label}</p>
          {progressPercent != null && (
            <div
              className="h-1.5 w-full max-w-md rounded overflow-hidden mt-1"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              <div
                className="h-full transition-all duration-300"
                style={{ width: `${progressPercent}%`, background: GOLD }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="btn-ghost text-[10px] py-0.5 px-2"
            onClick={hideBanner}
            title="Hide this bar — import keeps running"
          >
            Hide
          </button>
          <button
            type="button"
            className="btn-ghost text-[10px] py-0.5 px-2"
            disabled={isCancelling}
            onClick={() => void cancelImport(job.id)}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
