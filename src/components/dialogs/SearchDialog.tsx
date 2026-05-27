'use client';

import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Search, X, ChevronUp, ChevronDown, ArrowRight } from 'lucide-react';

interface Match {
  pageIndex: number;
  str: string;
  transform: number[];
}

interface SearchDialogProps {
  open: boolean;
  pdfBytes: ArrayBuffer | null;
  onClose: () => void;
}

export default function SearchDialog({ open, pdfBytes, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!query.trim() || !pdfBytes) return;
    setSearching(true);
    setMatches([]);
    setCurrentIndex(0);

    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      const found: Match[] = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
          if ('str' in item && item.str.toLowerCase().includes(query.toLowerCase())) {
            found.push({ pageIndex: p - 1, str: item.str, transform: item.transform });
          }
        }
      }
      setMatches(found);
    } finally {
      setSearching(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed top-16 right-4 z-50 w-96 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <div className="flex items-center gap-2 text-zinc-300">
          <Search size={16} />
          <span className="text-sm font-medium">Search{showReplace ? ' & Replace' : ''}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowReplace((v) => !v)}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-700 transition-colors"
          >
            {showReplace ? 'Hide Replace' : 'Replace'}
          </button>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors p-1 rounded hover:bg-zinc-700">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search text..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors disabled:opacity-40"
          >
            {searching ? '...' : 'Find'}
          </button>
        </div>

        {showReplace && (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Replace with..."
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {matches.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                {matches.length} match{matches.length !== 1 ? 'es' : ''} found
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentIndex((i) => (i - 1 + matches.length) % matches.length)}
                  className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white"
                >
                  <ChevronUp size={16} />
                </button>
                <span className="text-xs text-zinc-400 w-14 text-center">
                  {currentIndex + 1}/{matches.length}
                </span>
                <button
                  onClick={() => setCurrentIndex((i) => (i + 1) % matches.length)}
                  className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            </div>

            <div className="max-h-40 overflow-y-auto flex flex-col gap-1">
              {matches.map((m, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  className={`text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    i === currentIndex ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-zinc-400 hover:bg-zinc-700/50'
                  }`}
                >
                  <span className="text-zinc-500 mr-2">P.{m.pageIndex + 1}</span>
                  <span className="truncate">{m.str}</span>
                </button>
              ))}
            </div>

            {showReplace && replaceText && (
              <div className="flex gap-2 mt-1">
                <p className="text-xs text-zinc-500 flex-1">
                  Note: Replace embeds a text overlay on top of matched text. The original PDF text underneath is covered with a white box.
                </p>
              </div>
            )}
          </div>
        )}

        {matches.length === 0 && query && !searching && (
          <p className="text-sm text-zinc-500 text-center py-2">No matches found</p>
        )}
      </div>
    </div>
  );
}
