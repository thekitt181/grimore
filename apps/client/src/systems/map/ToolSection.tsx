import { useSyncExternalStore, type ReactNode } from 'react';

const STORAGE_KEY = 'grimoire-tool-sections';

let collapsedIds = loadCollapsed();
const listeners = new Set<() => void>();

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function toggleCollapsed(id: string) {
  const next = new Set(collapsedIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsedIds = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // private mode can reject storage; the click still collapses for this visit
  }
  emit();
}

function useCollapsed(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => collapsedIds.has(id),
    () => false,
  );
}

export function ToolSection({
  id,
  title,
  children,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useCollapsed(id);

  return (
    <div className={`panel ${collapsed ? '!py-2.5' : 'space-y-2'}`}>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        aria-expanded={!collapsed}
        onClick={() => toggleCollapsed(id)}
      >
        <span className="font-ui text-[10px] leading-none w-2.5 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
          {collapsed ? '▸' : '▾'}
        </span>
        <h3 className="font-display text-xs font-semibold tracking-wider uppercase flex-1" style={{ color: 'var(--color-accent-gold)' }}>
          {title}
        </h3>
      </button>
      {!collapsed && children}
    </div>
  );
}
