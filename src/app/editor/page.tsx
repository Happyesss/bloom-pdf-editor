'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEditorStore } from '@/store/editorStore';
import { loadPdfFromStorage } from '@/lib/pdfStorage';
import dynamic from 'next/dynamic';

const EditorLayout = dynamic(() => import('@/components/editor/EditorLayout'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-zinc-400 text-sm">Loading editor...</p>
      </div>
    </div>
  ),
});

export default function EditorPage() {
  const router = useRouter();
  const pdfBytes = useEditorStore((s) => s.pdfBytes);
  const pdfFileName = useEditorStore((s) => s.pdfFileName);
  const restorePdf = useEditorStore((s) => s.restorePdf);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (pdfBytes) return; // already loaded in memory

    // Try to restore from IndexedDB (survives soft refresh)
    if (pdfFileName) {
      setRestoring(true);
      loadPdfFromStorage()
        .then(async (stored) => {
          if (stored) {
            const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
            GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
            const pdf = await getDocument({ data: stored.bytes.slice(0) }).promise;
            restorePdf(stored.bytes, stored.fileName, pdf.numPages);
          } else {
            router.replace('/');
          }
        })
        .catch(() => router.replace('/'))
        .finally(() => setRestoring(false));
    } else {
      router.replace('/');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (restoring || (!pdfBytes && pdfFileName)) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Restoring your session...</p>
        </div>
      </div>
    );
  }

  if (!pdfBytes) return null;

  return <EditorLayout />;
}
