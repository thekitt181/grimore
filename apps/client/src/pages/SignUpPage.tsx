import { SignUp } from '@clerk/clerk-react';
import { grimoireClerkAppearance } from '@/lib/clerkAppearance';

export function SignUpPage() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg-primary)' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎲</div>
          <h1
            className="font-display text-4xl font-black tracking-widest animate-torch"
            style={{ color: 'var(--color-accent-gold)' }}
          >
            GRIMOIRE
          </h1>
          <p className="font-body text-base mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Begin your adventure
          </p>
        </div>

        <SignUp
          routing="path"
          path="/sign-up"
          afterSignUpUrl="/"
          appearance={grimoireClerkAppearance}
        />
      </div>
    </div>
  );
}
