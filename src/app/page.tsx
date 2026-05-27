'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import DropZone from '@/components/upload/DropZone';
import { useEditorStore } from '@/store/editorStore';
import {
  Type, Pen, Highlighter, PenLine, Stamp, FileStack,
  Droplets, Search, Image, RotateCw, Shield, Zap,
} from 'lucide-react';

const features = [
  { icon: Type, title: 'Text Editing', desc: 'Add, edit and style text anywhere on your PDF pages' },
  { icon: Pen, title: 'Draw & Annotate', desc: 'Freehand drawing, shapes, arrows, highlights and underlines' },
  { icon: Highlighter, title: 'Highlights & Comments', desc: 'Yellow highlights, strikethrough, sticky-note comments' },
  { icon: PenLine, title: 'Signatures', desc: 'Draw, type or upload a signature and place it anywhere' },
  { icon: Image, title: 'Image Insertion', desc: 'Insert, resize and rotate images on any page' },
  { icon: Stamp, title: 'Permanent Redaction', desc: 'Black out sensitive content that cannot be recovered' },
  { icon: FileStack, title: 'Page Management', desc: 'Reorder, rotate, duplicate or delete pages with drag & drop' },
  { icon: Droplets, title: 'Watermarks', desc: 'Add diagonal or center text watermarks with custom opacity' },
  { icon: Search, title: 'Search & Replace', desc: 'Find text across all pages and highlight all occurrences' },
  { icon: RotateCw, title: 'Undo / Redo', desc: 'Full undo/redo history for every edit you make' },
  { icon: Shield, title: '100% Private', desc: 'Your file never leaves your browser — zero server uploads' },
  { icon: Zap, title: 'No Install Required', desc: 'Works in any modern browser, no plugins or downloads needed' },
];

export default function HomePage() {
  const router = useRouter();
  const store = useEditorStore();

  const handleFileAccepted = useCallback(
    async (file: File, bytes: ArrayBuffer) => {
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
      GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await getDocument({ data: bytes.slice(0) }).promise;
      store.setPdfFile(file, bytes, pdf.numPages);
      router.push('/editor');
    },
    [store, router]
  );

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center">
      {/* Hero */}
      <section className="w-full max-w-4xl px-6 pt-20 pb-12 flex flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-medium mb-6">
          <Zap size={12} />
          Free · Browser-based · No sign-up
        </div>
        <h1 className="text-5xl sm:text-6xl font-bold text-white leading-tight tracking-tight">
          Edit any PDF<br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-violet-400">
            end to end
          </span>
        </h1>
        <p className="mt-6 text-lg text-zinc-400 max-w-xl">
          The complete browser-based PDF editor. Edit text, draw, annotate, sign,
          redact sensitive data, manage pages — all without installing anything.
        </p>
        <div className="mt-12 w-full max-w-2xl">
          <DropZone onFileAccepted={handleFileAccepted} />
        </div>
      </section>

      {/* Features */}
      <section className="w-full max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-semibold text-white text-center mb-10">
          Everything you need to edit PDFs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex gap-4 p-4 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors"
            >
              <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Icon size={18} className="text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Problems solved */}
      <section className="w-full max-w-4xl px-6 py-8 pb-20">
        <h2 className="text-xl font-semibold text-white text-center mb-6">
          Solving real everyday PDF problems
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            "Can't edit text in an existing PDF without expensive software",
            'Scanned forms with no fillable fields — forced to print & scan',
            'Need to sign a document but only have a computer',
            'Accidentally exposed sensitive info when sharing PDFs',
            'Need to add a company logo or watermark to documents',
            'Want to rearrange or remove pages from a contract',
            'Annotations disappeared when sharing PDF with colleagues',
            'Want to mark up a report before a meeting',
          ].map((problem) => (
            <div
              key={problem}
              className="flex items-start gap-2 px-4 py-3 bg-zinc-900/50 rounded-lg border border-zinc-800"
            >
              <span className="text-green-400 mt-0.5 flex-shrink-0">✓</span>
              <span className="text-sm text-zinc-300">{problem}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="w-full border-t border-zinc-800 py-6 text-center text-xs text-zinc-600">
        PDF Editor · Runs entirely in your browser · Your files are never uploaded to any server
      </footer>
    </main>
  );
}
