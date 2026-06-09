import { SignIn } from '@clerk/clerk-react';
import { grimoireClerkAppearance } from '@/lib/clerkAppearance';

export function SignInPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg-primary)' }}
    >
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎲</div>
          <h1
            className="font-display text-4xl font-black tracking-widest animate-torch"
            style={{ color: 'var(--color-accent-gold)' }}
          >
            GRIMOIRE
          </h1>
          <p className="font-body text-base mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Dark Fantasy Virtual Tabletop
          </p>
        </div>

        <SignIn
          routing="path"
          path="/sign-in"
          afterSignInUrl="/"
          appearance={grimoireClerkAppearance}
        />
      </div>
    </div>
  );
}
