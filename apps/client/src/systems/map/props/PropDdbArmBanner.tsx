import { usePropDdbArmStore } from './propDdbArmStore';
import { propActivateCheckDef } from './propActivateChecks';

/** Shows while a prop is waiting for a matching D&D Beyond skill/ability roll. */
export function PropDdbArmBanner() {
  const pending = usePropDdbArmStore((s) => s.pending);
  const clear = usePropDdbArmStore((s) => s.clear);
  if (!pending) return null;

  const check = propActivateCheckDef(pending.checkId)?.label ?? pending.checkId;
  const who = pending.characterName ? ` for ${pending.characterName}` : '';

  return (
    <div
      className="fixed bottom-20 left-1/2 z-[200] -translate-x-1/2 rounded-lg shadow-panel px-3 py-2 flex items-center gap-3 max-w-[min(92vw,28rem)]"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-gold)',
      }}
    >
      <span className="font-ui text-xs" style={{ color: 'var(--color-text-primary)' }}>
        Waiting for <span style={{ color: 'var(--color-accent-gold)' }}>{check}</span> to{' '}
        {pending.kind === 'reveal' ? 'reveal' : 'open'} on D&D Beyond
        {who} · {pending.propName} DC {pending.dc}
      </span>
      <button type="button" className="btn-ghost text-[10px] px-2 py-0.5 shrink-0" onClick={clear}>
        Cancel
      </button>
    </div>
  );
}
