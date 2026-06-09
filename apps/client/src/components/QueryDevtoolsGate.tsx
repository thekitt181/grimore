import { useLocation } from 'react-router-dom';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useSessionStore } from '@/store/sessionStore';

/** TanStack Query devtools — GM/dev only; hidden for players in live sessions. */
export function QueryDevtoolsGate() {
  const myRole = useSessionStore((s) => s.myRole);
  const location = useLocation();

  if (!import.meta.env.DEV) return null;

  const inLiveSession = location.pathname.startsWith('/session/');
  if (inLiveSession && myRole === 'PLAYER') return null;

  return <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />;
}
