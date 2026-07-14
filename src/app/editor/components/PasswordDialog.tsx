'use client';

import { useState, useCallback, FormEvent } from 'react';
import { Lock, Loader2 } from 'lucide-react';

interface PasswordDialogProps {
  fileName?: string;
  error?: string | null;
  isVerifying?: boolean;
  onSubmit: (password: string) => void;
  onCancel?: () => void;
}

/**
 * Prompt for PDF open password (Security Engine Phase 3 UI).
 */
export function PasswordDialog({
  fileName,
  error,
  isVerifying,
  onSubmit,
  onCancel,
}: PasswordDialogProps) {
  const [password, setPassword] = useState('');

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      onSubmit(password);
    },
    [onSubmit, password],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg bg-zinc-800 p-2 text-amber-400">
            <Lock size={20} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Password required</h2>
            <p className="text-xs text-zinc-400">
              {fileName ? `"${fileName}" is encrypted` : 'This PDF is encrypted'}
            </p>
          </div>
        </div>

        <label className="mb-1 block text-xs font-medium text-zinc-400" htmlFor="pdf-password">
          Document password
        </label>
        <input
          id="pdf-password"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500"
          placeholder="Enter user or owner password"
          disabled={isVerifying}
        />

        {error && (
          <p className="mb-3 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isVerifying}
              className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isVerifying}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-60"
          >
            {isVerifying ? <Loader2 size={14} className="animate-spin" /> : null}
            Unlock
          </button>
        </div>
      </form>
    </div>
  );
}
