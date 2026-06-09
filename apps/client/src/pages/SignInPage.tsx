import { SignIn } from '@clerk/clerk-react';

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
          appearance={{
            variables: {
              colorBackground: '#12121a',
              colorInputBackground: '#0a0a0f',
              colorInputText: '#e8e0d0',
              colorText: '#e8e0d0',
              colorTextSecondary: '#8a8075',
              colorPrimary: '#c9a84c',
              colorDanger: '#d42b2b',
              borderRadius: '6px',
              fontFamily: 'Inter, sans-serif',
            },
            elements: {
              card: 'shadow-panel border border-[#2a2a3a]',
              headerTitle: 'font-display tracking-wider',
            },
          }}
        />
      </div>
    </div>
  );
}
