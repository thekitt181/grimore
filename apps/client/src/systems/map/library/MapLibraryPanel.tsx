import { useRef, useState } from 'react';
import { ToolSection } from '@/systems/map/ToolSection';
import { searchMapLibrary, type LibraryMap } from './searchMapLibrary';

const PRESETS = ['Dungeon', 'Tavern', 'Cave', 'Castle', 'City', 'Forest', 'Temple', 'Ship', 'World', 'Battle'];

export function MapLibraryPanel({ onUse }: { onUse: (map: LibraryMap) => void }) {
  const [query, setQuery] = useState('');
  const [maps, setMaps] = useState<LibraryMap[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usingId, setUsingId] = useState('');
  const requestId = useRef(0);

  async function run(nextQuery: string, nextPage: number, append: boolean) {
    const term = nextQuery.trim();
    if (!term) return;
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setError('');
    try {
      const found = await searchMapLibrary(term, nextPage);
      if (id !== requestId.current) return;
      setMaps((prev) => (append ? mergeMaps(prev, found.maps) : found.maps));
      setPage(nextPage);
      setHasMore(found.hasMore);
      if (!append && found.maps.length === 0) setError('No D&D maps for that search.');
    } catch {
      if (id !== requestId.current) return;
      setError('Could not reach the map libraries.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  function search(term: string) {
    setQuery(term);
    void run(term, 1, false);
  }

  return (
    <ToolSection id="map-library" title="Map library">
      <form
        className="flex gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          search(query);
        }}
      >
        <input
          className="input-dark flex-1 text-xs py-1"
          placeholder="Search a D&D map, like tavern or cave..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button className="btn-primary px-2 py-1 text-xs" type="submit" disabled={loading || !query.trim()}>
          {loading ? '...' : 'Search'}
        </button>
      </form>
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="rounded px-1.5 py-0.5 font-ui text-[10px] border border-[#2a2a3a] hover:border-[#c9a84c66] hover:text-[#e8e0d0]"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => search(preset)}
          >
            {preset}
          </button>
        ))}
      </div>
      {maps.length > 0 && (
        <div className="grid grid-cols-2 gap-1 max-h-80 overflow-y-auto pr-0.5">
          {maps.map((map) => (
            <button
              key={map.id}
              type="button"
              title={credit(map)}
              disabled={usingId === map.id}
              onClick={() => {
                setUsingId(map.id);
                onUse(map);
                window.setTimeout(() => setUsingId(''), 600);
              }}
              className="overflow-hidden rounded border border-[#2a2a3a] text-left hover:border-[#c9a84c66]"
            >
              <img
                src={map.thumbUrl}
                alt=""
                loading="lazy"
                className="h-16 w-full object-cover bg-[#14141c]"
              />
              <span className="block truncate px-1 py-0.5 font-ui text-[9px]" style={{ color: 'var(--color-text-primary)' }}>
                {map.title}
              </span>
              <span className="block truncate px-1 pb-0.5 font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
                {map.source}{map.license ? ` · ${map.license}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>{error}</p>
      )}
      {hasMore && maps.length > 0 && (
        <button
          type="button"
          className="btn-ghost w-full text-xs py-1"
          disabled={loading}
          onClick={() => void run(query, page + 1, true)}
        >
          {loading ? 'Loading…' : 'More maps'}
        </button>
      )}
      <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        D&D battle maps only, from the web and open collections. Click a picture to use only that image as the map.
      </p>
    </ToolSection>
  );
}

function mergeMaps(current: LibraryMap[], next: LibraryMap[]): LibraryMap[] {
  const seen = new Set(current.map((map) => map.imageUrl));
  const added = next.filter((map) => !seen.has(map.imageUrl));
  return [...current, ...added];
}

function credit(map: LibraryMap): string {
  const who = map.creator ? ` by ${map.creator}` : '';
  const license = map.license ? ` (${map.license})` : '';
  return `${map.title}${who}${license} — ${map.source}`;
}
