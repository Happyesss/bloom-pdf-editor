'use client';

import { useState } from 'react';
import { Search, Replace } from 'lucide-react';

interface FindReplacePanelProps {
  onFindReplace: (find: string, replace: string) => Promise<number>;
}

export function FindReplacePanel({ onFindReplace }: FindReplacePanelProps) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!find) return;
    setBusy(true);
    try {
      const n = await onFindReplace(find, replace);
      setCount(n);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3 space-y-3 bg-zinc-900/95">
      <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
        <Search size={12} /> Find & Replace
      </div>
      <input
        value={find}
        onChange={(e) => setFind(e.target.value)}
        placeholder="Find"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
      />
      <input
        value={replace}
        onChange={(e) => setReplace(e.target.value)}
        placeholder="Replace with"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200"
      />
      <button
        onClick={() => void run()}
        disabled={busy || !find}
        className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md text-xs font-semibold disabled:opacity-40"
      >
        <Replace size={12} />
        {busy ? 'Working…' : 'Replace all on page'}
      </button>
      {count != null && (
        <div className="text-[10px] text-zinc-500">{count} replacement(s)</div>
      )}
    </div>
  );
}
