import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { fetchAdminConfigured, verifyCompendiumAdminPassword } from './compendiumApi';
import { useCompendiumAdminStore } from './compendiumAdminStore';

const GOLD = 'var(--color-accent-gold)';

export function CompendiumAdminUnlock() {
  const qc = useQueryClient();
  const unlocked = useCompendiumAdminStore((s) => s.unlocked);
  const unlock = useCompendiumAdminStore((s) => s.unlock);
  const lock = useCompendiumAdminStore((s) => s.lock);
  const [password, setPassword] = useState('');
  const [open, setOpen] = useState(false);

  const configuredQ = useQuery({
    queryKey: ['compendium', 'admin-configured'],
    queryFn: fetchAdminConfigured,
    staleTime: 60_000,
  });

  const verifyMut = useMutation({
    mutationFn: verifyCompendiumAdminPassword,
    onSuccess: (ok) => {
      if (ok) {
        unlock(password);
        setPassword('');
        setOpen(false);
        void qc.invalidateQueries({ queryKey: ['compendium', 'sources'] });
        void qc.invalidateQueries({ queryKey: ['compendium'] });
      }
    },
  });

  function getErrorMessage(): string {
    if (!verifyMut.isError) return '';
    const err = verifyMut.error;
    if (axios.isAxiosError(err)) {
      const msg = err.response?.data?.error;
      if (msg) return msg;
      if (err.response?.status === 403) return 'Wrong password';
    }
    return 'Something went wrong';
  }

  if (!configuredQ.data?.configured) return null;

  if (unlocked) {
    return (
      <button
        type="button"
        className="font-ui text-[10px] px-1.5 py-0.5 rounded shrink-0"
        style={{ border: '1px solid var(--color-border)', color: GOLD }}
        onClick={() => {
          lock();
          void qc.invalidateQueries({ queryKey: ['compendium', 'sources'] });
        }}
        title="Compendium admin active — click to preview player view (hides locked/draft content)"
      >
        Admin ✓
      </button>
    );
  }

  return (
    <div className="shrink-0">
      {!open ? (
        <button
          type="button"
          className="font-ui text-[10px] px-1.5 py-0.5 rounded"
          style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
          onClick={() => setOpen(true)}
        >
          Admin unlock
        </button>
      ) : (
        <form
          className="flex gap-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            verifyMut.mutate(password);
          }}
        >
          <input
            type="password"
            className="input-dark text-[10px] py-0.5 flex-1 min-w-0"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-ghost text-[10px] py-0.5 px-1" disabled={verifyMut.isPending}>
            OK
          </button>
          <button type="button" className="btn-ghost text-[10px] py-0.5 px-1" onClick={() => setOpen(false)}>
            ✕
          </button>
        </form>
      )}
      {verifyMut.isError && (
        <p className="font-ui text-[10px] mt-0.5" style={{ color: 'var(--color-accent-red-hot)' }}>
          {getErrorMessage()}
        </p>
      )}
    </div>
  );
}
