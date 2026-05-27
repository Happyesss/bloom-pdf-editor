'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useEditorStore } from '@/store/editorStore';
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

  useEffect(() => {
    if (!pdfBytes) {
      router.replace('/');
    }
  }, [pdfBytes, router]);

  if (!pdfBytes) return null;

  return <EditorLayout />;
}
