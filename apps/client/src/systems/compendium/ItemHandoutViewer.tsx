import { DraggablePanel } from '@/components/DraggablePanel';
import { useHandoutViewerStore } from './handoutViewerStore';
import { RollableText } from '@/systems/dice/RollableText';

export function ItemHandoutViewer() {
  const content = useHandoutViewerStore((s) => s.content);
  const close = useHandoutViewerStore((s) => s.close);

  if (!content) return null;

  const meta = [content.itemType, content.rarity, content.source].filter(Boolean).join(' · ');

  return (
    <DraggablePanel
      title={content.title}
      subtitle={meta || 'Item handout'}
      onClose={close}
      defaultPosition={{ x: Math.max(16, (window.innerWidth - 420) / 2), y: 80 }}
      width={420}
      maxHeight="85vh"
      zIndex={155}
    >
      <div className="p-4 space-y-3">
        {content.imageUrl && (
          <img
            src={content.imageUrl}
            alt=""
            className="w-full max-h-48 object-contain rounded"
            style={{ background: 'var(--color-bg-primary)' }}
          />
        )}
        {content.description ? (
          <RollableText text={content.description} className="text-sm" />
        ) : (
          <p className="font-ui text-xs italic" style={{ color: 'var(--color-text-secondary)' }}>No description.</p>
        )}
      </div>
    </DraggablePanel>
  );
}
