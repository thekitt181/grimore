import {
  formatItemMarketLine,
  resolveItemMarketPrice,
  type ItemPriceQuery,
} from '@grimoire/shared';

export function itemPriceQueryLine(query: ItemPriceQuery): string | null {
  const price = resolveItemMarketPrice(query);
  return price ? formatItemMarketLine(price) : null;
}

export function ItemMarketPrice({
  query,
  className = 'font-ui text-xs',
}: {
  query: ItemPriceQuery;
  className?: string;
}) {
  const price = resolveItemMarketPrice(query);
  if (!price) return null;
  return (
    <p
      className={className}
      title="5e listed buy price. Merchants typically pay half (PHB)."
      style={{ color: 'var(--color-accent-gold)' }}
    >
      Buy {price.buyLabel}
      <span style={{ color: 'var(--color-text-secondary)' }}> · </span>
      Sell {price.sellLabel}
    </p>
  );
}
