/**
 * Load PDF from IndexedDB and parse with the engine.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfFromStorage } from '@/lib/pdfStorage';
import type { PDFDocumentData } from '@/engine';

export function usePdfDocument(onParsed?: (doc: PDFDocumentData, engine: typeof import('@/engine')) => void) {
  const router = useRouter();
  const engineRef = useRef<typeof import('@/engine') | null>(null);
  const [doc, setDoc] = useState<PDFDocumentData | null>(null);
  const [fileName, setFileName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modifiedKeys] = useState(() => new Set<string>());

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const stored = await loadPdfFromStorage();
        if (!stored) { router.push('/'); return; }
        if (cancelled) return;
        setFileName(stored.fileName);

        const engine = await import('@/engine');
        engineRef.current = engine;

        const pdfBytes = new Uint8Array(stored.bytes);
        const parsed = await engine.parsePDF(pdfBytes);
        if (cancelled) return;

        setDoc(parsed);
        onParsed?.(parsed, engine);
        setIsLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error('[Editor] Init failed:', e);
        setError(`Failed to parse PDF: ${e instanceof Error ? e.message : String(e)}`);
        setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [router, onParsed]);

  const markModified = useCallback((key: string) => {
    modifiedKeys.add(key);
  }, [modifiedKeys]);

  const download = useCallback(async (mode: 'quick' | 'optimized' = 'optimized') => {
    if (!doc || !engineRef.current) return;
    const engine = engineRef.current;
    const bytes = mode === 'quick'
      ? await engine.saveQuick(doc, modifiedKeys)
      : await engine.saveOptimized(doc);

    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.replace(/\.pdf$/i, '') + (mode === 'optimized' ? '-edited.pdf' : '-quick.pdf');
    a.click();
    URL.revokeObjectURL(url);
  }, [doc, fileName, modifiedKeys]);

  return {
    engineRef,
    doc,
    setDoc,
    fileName,
    setFileName,
    isLoading,
    error,
    setError,
    modifiedKeys,
    markModified,
    download,
  };
}
