import { useState } from 'react';
import type { CompendiumItem } from '@grimoire/shared';
import { synthesizeCompendiumItemDescription } from '@grimoire/shared';
import { ToolSection } from '@/systems/map/ToolSection';
import { RollableText } from '@/systems/dice/RollableText';
import { getItem, rollShop, type ShopLine, type ShopStock } from './compendiumApi';
import { placeShopPurchases } from './placeLoot';

function lineKey(section: string, line: ShopLine): string {
  return `${section}:${line.id ?? line.name}`;
}

function StockList({
  title,
  section,
  lines,
  bought,
  openKey,
  onToggle,
  onInspect,
}: {
  title: string;
  section: string;
  lines: ShopLine[];
  bought: Record<string, boolean>;
  openKey: string | null;
  onToggle: (key: string) => void;
  onInspect: (section: string, line: ShopLine) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
        {title}
      </p>
      {lines.map((line) => {
        const key = lineKey(section, line);
        return (
          <div key={key} className="flex items-start gap-1.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={Boolean(bought[key])}
              onChange={() => onToggle(key)}
              aria-label={`Bought ${line.name}`}
            />
            <button
              type="button"
              className="font-ui text-xs leading-snug flex-1 min-w-0 text-left hover:underline"
              style={{ color: openKey === key ? 'var(--color-accent-gold)' : 'var(--color-text-primary)' }}
              onClick={() => onInspect(section, line)}
            >
              {line.name}
              {line.note && line.note !== 'Always' ? (
                <span style={{ color: 'var(--color-text-secondary)' }}> · {line.note}</span>
              ) : null}
            </button>
            <span className="font-ui text-[10px] shrink-0" style={{ color: 'var(--color-accent-gold)' }}>
              {line.cost}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ShopPanel() {
  const [shop, setShop] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stock, setStock] = useState<ShopStock | null>(null);
  const [bought, setBought] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<ShopLine | null>(null);
  const [detail, setDetail] = useState<CompendiumItem | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    setBought({});
    setOpenKey(null);
    setOpenLine(null);
    setDetail(null);
    try {
      setStock(await rollShop(shop));
    } catch {
      setError('Could not stock that shop. The item codex may still be loading.');
    } finally {
      setBusy(false);
    }
  }

  function toggleBought(key: string) {
    setBought((current) => ({ ...current, [key]: !current[key] }));
  }

  async function inspect(section: string, line: ShopLine) {
    const key = lineKey(section, line);
    if (openKey === key) {
      setOpenKey(null);
      setOpenLine(null);
      setDetail(null);
      return;
    }
    setOpenKey(key);
    setOpenLine(line);
    setDetail(null);
    if (!line.id) return;
    setDetailBusy(true);
    try {
      setDetail(await getItem(line.id));
    } catch {
      setDetail(null);
    } finally {
      setDetailBusy(false);
    }
  }

  async function summonBought() {
    if (!stock || busy) return;
    const chosen = [
      ...stock.staples.filter((line) => bought[lineKey('staples', line)]),
      ...stock.visit.filter((line) => bought[lineKey('visit', line)]),
    ];
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const placed = await placeShopPurchases(chosen);
      if (!placed) {
        setError('Open a map before summoning a purchase.');
        return;
      }
      setBought({});
      setNote(`Summoned ${chosen.length} purchase${chosen.length === 1 ? '' : 's'} onto the map.`);
    } catch {
      setError('Could not summon those purchases.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolSection id="shop" title="Shop">
      <label className="block space-y-1">
        <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
          Shop or merchant
        </span>
        <input
          className="input-dark w-full text-xs py-1"
          placeholder="Black market, cursed seller, smith..."
          value={shop}
          maxLength={80}
          onChange={(event) => setShop(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void generate();
          }}
        />
      </label>
      <button type="button" className="btn-primary w-full text-xs py-1.5" disabled={busy} onClick={() => { void generate(); }}>
        {busy ? 'Stocking…' : stock ? 'Reroll this visit' : 'Generate shop'}
      </button>
      {error && (
        <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>
      )}
      {stock && (
        <div className="space-y-2">
          <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            {stock.shop} · {stock.kind}
          </p>
          <StockList
            title="Always in stock"
            section="staples"
            lines={stock.staples}
            bought={bought}
            openKey={openKey}
            onToggle={toggleBought}
            onInspect={(section, line) => { void inspect(section, line); }}
          />
          <StockList
            title={`This visit (${stock.visit.length})`}
            section="visit"
            lines={stock.visit}
            bought={bought}
            openKey={openKey}
            onToggle={toggleBought}
            onInspect={(section, line) => { void inspect(section, line); }}
          />
          {openLine && (
            <div
              className="rounded p-2 space-y-1"
              style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}
            >
              <p className="font-display text-xs" style={{ color: 'var(--color-accent-gold)' }}>{openLine.name}</p>
              <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                {[detail?.type, detail?.rarity, openLine.cost].filter(Boolean).join(' · ')}
              </p>
              {detailBusy ? (
                <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Loading details…</p>
              ) : (
                <RollableText
                  text={
                    detail
                      ? synthesizeCompendiumItemDescription(detail) || 'No description in the codex.'
                      : 'Everyday stock. This seller always carries it.'
                  }
                  className="max-h-40 overflow-y-auto text-xs"
                />
              )}
            </div>
          )}
          <button
            type="button"
            className="btn-primary w-full text-xs py-1.5"
            disabled={busy || !Object.values(bought).some(Boolean)}
            onClick={() => { void summonBought(); }}
          >
            Summon bought
          </button>
          {note && (
            <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{note}</p>
          )}
        </div>
      )}
      <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Type any shop. Click a name to read the details. Tick what was bought, then summon those onto the map.
      </p>
    </ToolSection>
  );
}
