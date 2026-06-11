import { authClient, getAuthBearerToken, signOutAndClear } from '@/lib/auth-client';

/** Drop-in shape for former Clerk useAuth() call sites. */
export function useGrimoireAuth() {
  const { data: session, isPending, error } = authClient.useSession();

  return {
    isLoaded: !isPending,
    isSignedIn: !!session?.user,
    session,
    error,
    getToken: getAuthBearerToken,
  };
}

export function useGrimoireUser() {
  const { data: session, isPending } = authClient.useSession();
  const user = session?.user;

  return {
    isLoaded: !isPending,
    user: user
      ? {
          id: user.id,
          username: user.name,
          firstName: user.name?.split(/\s+/)[0] ?? user.name,
          fullName: user.name,
          imageUrl: user.image ?? undefined,
          email: user.email,
        }
      : null,
  };
}

export function useGrimoireSignOut() {
  return {
    signOut: async () => {
      await signOutAndClear();
      window.location.href = '/sign-in';
    },
  };
}
