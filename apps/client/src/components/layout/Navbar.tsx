import { Link } from 'react-router-dom';
import { useGrimoireUser, useGrimoireSignOut } from '@/hooks/useGrimoireAuth';

export function Navbar() {
  const { user } = useGrimoireUser();
  const { signOut } = useGrimoireSignOut();

  const displayName = user?.username ?? user?.firstName ?? 'Adventurer';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header
      className="h-14 flex items-center justify-between px-6 border-b shrink-0"
      style={{
        background: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* Logo */}
      <Link to="/" className="flex items-center gap-3 group">
        <span className="text-2xl select-none">🎲</span>
        <span
          className="font-display text-lg font-bold tracking-widest animate-torch"
          style={{ color: 'var(--color-accent-gold)' }}
        >
          GRIMOIRE
        </span>
        <span
          className="text-xs font-ui tracking-wider uppercase"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          VTT
        </span>
      </Link>

      {/* Nav links */}
      <nav className="hidden md:flex items-center gap-6">
        <Link
          to="/"
          className="font-ui text-sm transition-colors duration-200"
          style={{ color: 'var(--color-text-secondary)' }}
          onMouseEnter={(e) =>
            ((e.target as HTMLElement).style.color = 'var(--color-text-primary)')
          }
          onMouseLeave={(e) =>
            ((e.target as HTMLElement).style.color = 'var(--color-text-secondary)')
          }
        >
          Campaigns
        </Link>
      </nav>

      {/* User controls */}
      <div className="flex items-center gap-3">
        {user && (
          <span className="font-ui text-sm hidden md:block" style={{ color: 'var(--color-text-secondary)' }}>
            {displayName}
          </span>
        )}
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:opacity-90"
          title="Sign out"
        >
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-ui font-semibold shrink-0"
            style={{
              background: 'var(--color-bg-primary)',
              color: 'var(--color-accent-gold)',
              border: '1px solid var(--color-border)',
            }}
          >
            {initial}
          </span>
          <span className="font-ui text-xs hidden sm:block" style={{ color: 'var(--color-text-secondary)' }}>
            Sign out
          </span>
        </button>
      </div>
    </header>
  );
}
