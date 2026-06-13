import { useEffect } from 'react';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useHandoutJournalStore } from './handoutJournalStore';
import { useHandoutViewerStore } from '@/systems/compendium/handoutViewerStore';

interface HandoutJournalPanelProps {
  campaignId: string;
  onClose: () => void;
}

export function HandoutJournalPanel({ campaignId, onClose }: HandoutJournalPanelProps) {
  const entries = useHandoutJournalStore((s) => s.entries);
  const loading = useHandoutJournalStore((s) => s.loading);
  const loadJournal = useHandoutJournalStore((s) => s.loadJournal);
  const receiptToViewerContent = useHandoutJournalStore((s) => s.receiptToViewerContent);
  const openContent = useHandoutViewerStore((s) => s.openContent);

  useEffect(() => {
    void loadJournal(campaignId);
  }, [campaignId, loadJournal]);

  return (
    <DraggablePanel
      title="Journal"
      subtitle="Handouts revealed to you"
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, window.innerWidth - 360), y: 96 }}
      width={340}
      maxHeight="75vh"
      zIndex={154}
    >
      <div className="p-3">
        {loading && (
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>
        )}
        {!loading && entries.length === 0 && (
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            No handouts yet. The GM reveals items via right-click on a map handout → Give to players.
          </p>
        )}
        <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="w-full text-left rounded-lg p-2 transition-colors"
                style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)' }}
                onClick={() => openContent({ ...receiptToViewerContent(entry), animate: true })}
              >
                <p className="font-display text-sm" style={{ color: 'var(--color-text-primary)' }}>
                  {entry.title}
                </p>
                <p className="font-ui text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {entry.type.replace('_', ' ').toLowerCase()}
                  {' · '}
                  {new Date(entry.receivedAt).toLocaleString()}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </DraggablePanel>
  );
}
