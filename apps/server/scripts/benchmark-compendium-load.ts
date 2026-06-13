import 'dotenv/config';
import { searchMonsters, warmCompendiumCatalog } from '../src/services/compendiumSync';

async function time(label: string, fn: () => Promise<unknown>) {
  const t0 = Date.now();
  const r = await fn();
  const ms = Date.now() - t0;
  const extra = typeof r === 'object' && r && 'total' in (r as object)
    ? ` total=${(r as { total: number }).total}`
    : '';
  console.log(`${label}: ${ms}ms${extra}`);
}

async function main() {
  await time('warm', warmCompendiumCatalog);
  await time('search-all', () => searchMonsters({ limit: 50 }));
  await time('search-abomination-vaults', () => searchMonsters({ source: 'Abomination Vaults', limit: 50 }));
  await time('search-abomination-vaults-2', () => searchMonsters({ source: 'Abomination Vaults', limit: 50 }));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
