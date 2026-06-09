import { Link, useNavigate } from 'react-router-dom';
import { UserButton, useUser } from '@clerk/clerk-react';

export function Navbar() {
  const { user } = useUser();
  const navigate = useNavigate();

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
      <div className="flex items-center gap-4">
        {user && (
          <span className="font-ui text-sm hidden md:block" style={{ color: 'var(--color-text-secondary)' }}>
            {user.username ?? user.firstName}
          </span>
        )}
        <UserButton
          afterSignOutUrl="/sign-in"
          appearance={{
            elements: {
              avatarBox: 'w-8 h-8 ring-1 ring-[var(--color-accent-gold)] ring-opacity-50',
            },
          }}
        />
      </div>
    </header>
  );
}
