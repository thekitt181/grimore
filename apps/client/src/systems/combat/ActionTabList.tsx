import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatLimitedUses } from '@grimoire/shared';
import { htmlToEntryText, parseEntryBlocks } from '@/systems/compendium/actionDetail';
import { getSpell, searchSpells } from '@/systems/compendium/compendiumApi';
import type { ParsedAction } from '@/systems/compendium/statBlockParser';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export type ActionTabId = 'actions' | 'bonus' | 'reactions' | 'legendary' | 'lair' | 'traits' | 'spells';

const TABS: { id: ActionTabId; label: string }[] = [
  { id: 'actions', label: 'Actions' },
  { id: 'bonus', label: 'Bonus' },
  { id: 'reactions', label: 'Reaction' },
  { id: 'legendary', label: 'Legendary' },
  { id: 'lair', label: 'Lair' },
  { id: 'spells', label: 'Spells' },
  { id: 'traits', label: 'Passive' },
];

export function groupActionsByTab(actions: ParsedAction[]): Record<ActionTabId, ParsedAction[]> {
  const g: Record<ActionTabId, ParsedAction[]> = {
    actions: [],
    bonus: [],
    reactions: [],
    legendary: [],
    lair: [],
    traits: [],
    spells: [],
  };
  for (const action of actions) {
    if (action.isSpellcastingBlock) continue;
    if (action.isSpell) {
      g.spells.push(action);
      continue;
    }
    const key: ActionTabId = action.section === 'bonus' || action.section === 'reactions'
      || action.section === 'legendary' || action.section === 'lair' || action.section === 'traits'
      ? action.section
      : 'actions';
    g[key].push(action);
  }
  return g;
}

function actionInfoText(action: ParsedAction): string {
  const cleaned = htmlToEntryText(action.originalText);
  if (action.isSpell) {
    if (/^\((?:cantrip|level\s*\d+)\)\.?$/i.test(cleaned)) return '';
    return cleaned;
  }
  const name = action.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let body = cleaned.replace(new RegExp(`^${name}\\.\\s+`, 'i'), '').trim();
  body = body.replace(/^,\s*/, '');
  body = body.replace(/^\((?:cantrip|level\s*\d+)\)\.?$/i, '');
  if (/^the \w+ has\.?$/i.test(body)) return '';
  if (/^cantrip$/i.test(body) || /^level\s*\d+$/i.test(body)) return '';
  if (body.length > 0 && body.length < 16 && !/\d/.test(body)) return '';
  if (/\bSTR\s*\d+\s*\(/i.test(body) && /\bDEX\s*\d+/i.test(body)) return '';
  if (/\bChallenge\s+\d+/i.test(body) && /\bpassive Perception\b/i.test(body)) return '';
  return body;
}

function SpellStat({ label, value }: { label: string; value?: string }) {
  if (!value) return <div />;
  return (
    <div>
      <p className="font-ui text-[8px] tracking-wider uppercase mb-0.5" style={{ color: GOLD }}>
        {label}
      </p>
      <p className="font-ui text-[11px] leading-snug" style={{ color: 'var(--color-text-primary)' }}>
        {value}
      </p>
    </div>
  );
}

function ActionDetailText({ action, fallback }: { action: ParsedAction; fallback: string }) {
  const needFetch = Boolean(action.isSpell) && fallback.length < 40;
  const q = useQuery({
    queryKey: ['compendium', 'spell-detail', action.name],
    queryFn: async () => {
      const res = await searchSpells({ q: action.name, limit: 20 });
      const needle = action.name.trim().toLowerCase();
      const hit = (res.items ?? []).find((s) => s.name.trim().toLowerCase() === needle)
        ?? (res.items ?? []).find((s) => s.name.trim().toLowerCase().includes(needle));
      if (!hit) return '';
      const raw = hit.description?.trim()
        ? hit.description
        : (await getSpell(hit.id)).description;
      return raw ? htmlToEntryText(raw) : '';
    },
    enabled: needFetch,
    staleTime: 60 * 60_000,
  });
  const text = (q.data && q.data.length > 20 ? q.data : fallback).trim();
  const blocks = parseEntryBlocks(text);
  const hasMeta = Boolean(
    action.spellCastingTime || action.spellRangeText || action.spellComponents || action.spellDuration || action.spellSchool,
  );

  if (q.isFetching && !text) {
    return (
      <p className="font-ui text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        Loading spell text…
      </p>
    );
  }
  if (!text && !hasMeta) {
    return (
      <p className="font-ui text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        No extra rules text.
      </p>
    );
  }

  const levelLine = [
    action.spellLevel == null ? null : action.spellLevel <= 0 ? 'Cantrip' : `Level ${action.spellLevel}`,
    action.spellSchool,
    action.spellRitual ? 'Ritual' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-2">
      {hasMeta && (
        <>
          {levelLine && (
            <p className="font-ui text-[10px] tracking-wide" style={{ color: GOLD }}>
              {levelLine}
            </p>
          )}
          <div
            className="grid grid-cols-2 gap-x-3 gap-y-2 pb-2 mb-1"
            style={{ borderBottom: `1px solid ${BD}` }}
          >
            <SpellStat label="Casting Time" value={action.spellCastingTime} />
            <SpellStat label="Range" value={action.spellRangeText} />
            <SpellStat label="Components" value={action.spellComponents} />
            <SpellStat label="Duration" value={action.spellDuration} />
          </div>
        </>
      )}
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p key={i} className="font-display text-[12px] pt-1" style={{ color: GOLD }}>
              {block.text}
            </p>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={i} className="space-y-1 pl-3">
              {block.items.map((item) => (
                <li key={item} className="font-ui text-[11px] leading-relaxed list-disc" style={{ color: 'var(--color-text-secondary)' }}>
                  {item}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="font-ui text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

export function ActionTabList({
  actions,
  renderUse,
}: {
  actions: ParsedAction[];
  /** Combat controls (to-hit, damage) shown under the name when info is open. */
  renderUse?: (action: ParsedAction) => ReactNode;
}) {
  const grouped = useMemo(() => groupActionsByTab(actions), [actions]);

  function tabItems(id: ActionTabId): ParsedAction[] {
    const rows = grouped[id].filter((action) => (
      action.isSpell
      || Boolean(actionInfoText(action))
      || action.toHit !== undefined
      || action.damages.length > 0
      || action.spells.length > 0
      || action.save
      || action.aoe
      || (action.usesMax != null && action.usesMax > 0)
    ));
    if (id !== 'spells') return rows;
    return [...rows].sort(
      (a, b) => (a.spellLevel ?? 0) - (b.spellLevel ?? 0) || a.name.localeCompare(b.name),
    );
  }

  const available = TABS.filter((t) => tabItems(t.id).length > 0);
  const [tab, setTab] = useState<ActionTabId | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const active = available.some((t) => t.id === tab) ? tab! : (available[0]?.id ?? 'actions');
  const items = tabItems(active);

  if (available.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-0.5">
        {available.map((t) => {
          const on = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              className="font-ui text-[9px] px-1.5 py-0.5 rounded"
              style={{
                color: on ? GOLD : 'var(--color-text-secondary)',
                border: `1px solid ${on ? GOLD : BD}`,
                background: on ? 'rgba(201,168,76,0.12)' : 'transparent',
              }}
              onClick={() => {
                setTab(t.id);
                setOpenKey(null);
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-1">
        {items.map((action, i) => {
          const key = `${action.name}-${i}`;
          const open = openKey === key;
          const info = actionInfoText(action);
          const uses = formatLimitedUses(action);
          return (
            <div
              key={key}
              className="rounded px-2 py-1"
              style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
            >
              <div className="flex items-center gap-1.5">
                <span className="font-display text-xs flex-1 min-w-0 truncate" style={{ color: GOLD }}>
                  {action.name}
                  {action.isSpell && action.spellLevel != null && (
                    <span className="font-ui font-normal ml-1 opacity-70" style={{ color: 'var(--color-text-secondary)' }}>
                      {action.spellLevel <= 0 ? 'cantrip' : `L${action.spellLevel}`}
                    </span>
                  )}
                </span>
                {uses && (
                  <span className="font-ui text-[9px] shrink-0" style={{ color: GOLD }}>
                    {uses}
                  </span>
                )}
                <button
                  type="button"
                  className="shrink-0 w-5 h-5 rounded-full font-ui text-[10px] flex items-center justify-center"
                  style={{
                    color: open ? '#1a1208' : GOLD,
                    background: open ? GOLD : 'transparent',
                    border: `1px solid ${GOLD}`,
                  }}
                  title={open ? 'Hide details' : 'What this does'}
                  onClick={() => setOpenKey(open ? null : key)}
                >
                  i
                </button>
              </div>
              {open && (
                <div className="mt-1.5 space-y-1.5">
                  {uses && (
                    <p className="font-ui text-[11px]" style={{ color: GOLD }}>
                      {action.usesRemaining ?? action.usesMax}/{action.usesMax} uses left
                      {action.usesReset ? ` · recovers on ${action.usesReset}` : ''}
                    </p>
                  )}
                  <ActionDetailText action={action} fallback={info} />
                  {renderUse?.(action)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
