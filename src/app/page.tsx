'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import DropZone from '@/components/upload/DropZone';
import { useEditorStore } from '@/store/editorStore';
import {
  Type, Pen, Highlighter, PenLine, Stamp, FileStack,
  Droplets, Search, Image as ImageIcon, Shield, Zap,
  ArrowRight, X, Sparkles, Lock, MousePointer2, FileText,
} from 'lucide-react';

const features = [
  { icon: Type,         title: 'Edit text in place',  desc: 'Click any sentence and rewrite it. We match the original font and size.' },
  { icon: Pen,          title: 'Draw & annotate',     desc: 'Freehand pen, arrows, shapes, lines — every tool you’d sketch a contract with.' },
  { icon: Highlighter,  title: 'Highlight & comment', desc: 'Highlights, strikethrough, sticky notes that stay anchored on export.' },
  { icon: PenLine,      title: 'Real signatures',     desc: 'Draw, type, or upload. Place it once, save it forever.' },
  { icon: ImageIcon,    title: 'Insert images',       desc: 'Logos, stamps, photos. Drag, resize, rotate — like Keynote on a PDF.' },
  { icon: Stamp,        title: 'Permanent redaction', desc: 'Black-out sensitive data and bake it into the file, not just the view.' },
  { icon: FileStack,    title: 'Page management',     desc: 'Reorder, rotate, duplicate, delete — directly from the thumbnail rail.' },
  { icon: Droplets,     title: 'Watermarks',          desc: 'Diagonal, centered, repeating. Any opacity, any colour.' },
  { icon: Search,       title: 'Search & replace',    desc: 'Find any word across every page in milliseconds.' },
];

const steps = [
  { n: '01', title: 'Drop your PDF',     desc: 'Drag a file in. It never leaves your device.' },
  { n: '02', title: 'Edit anything',     desc: 'Text, images, pages, signatures — all in one canvas.' },
  { n: '03', title: 'Download instantly', desc: 'Export a fresh PDF with every change baked in.' },
];

/** Reveal-on-scroll wrapper. Pure CSS + IntersectionObserver. */
function Reveal({
  children,
  className = '',
  delay = 0,
}: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShown(true); obs.disconnect(); } },
      { rootMargin: '-10% 0px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ animationDelay: `${delay}ms` }}
      className={`${shown ? 'animate-fade-up' : 'opacity-0'} ${className}`}
    >
      {children}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const setPdfFile = useEditorStore((s) => s.setPdfFile);
  const [uploadOpen, setUploadOpen] = useState(false);

  const openUpload = useCallback(() => setUploadOpen(true), []);
  const closeUpload = useCallback(() => setUploadOpen(false), []);

  useEffect(() => {
    if (!uploadOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeUpload(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uploadOpen, closeUpload]);

  const handleFileAccepted = useCallback(
    async (file: File, bytes: ArrayBuffer) => {
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
      GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await getDocument({ data: bytes.slice(0) }).promise;
      setPdfFile(file, bytes, pdf.numPages);
      router.push('/editor');
    },
    [setPdfFile, router]
  );

  return (
    <main className="relative min-h-screen bg-black text-[var(--foreground)] overflow-x-hidden">
      {/* ── Sticky frosted nav ─────────────────────────────────────────── */}
      <nav className="glass fixed top-0 inset-x-0 z-40 border-b border-white/5">
        <div className="max-w-6xl mx-auto h-12 px-5 flex items-center justify-between">
          <a href="#top" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="w-6 h-6 rounded-md bg-gradient-to-br from-[#2997ff] to-[#af52de] flex items-center justify-center">
              <FileText size={13} className="text-white" />
            </span>
            <span>PDF Editor</span>
          </a>
          <div className="hidden sm:flex items-center gap-6 text-[12px] text-white/70">
            <a href="#features" className="hover:text-white transition">Features</a>
            <a href="#how"      className="hover:text-white transition">How it works</a>
            <a href="#privacy"  className="hover:text-white transition">Privacy</a>
          </div>
          <button
            onClick={openUpload}
            className="h-7 px-3 rounded-full bg-white text-black text-[12px] font-medium hover:bg-white/90 active:scale-95 transition"
          >
            Edit PDF
          </button>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section id="top" className="relative pt-32 pb-24 px-6">
        <div className="absolute inset-0 hero-halo pointer-events-none animate-glow" />
        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 text-[11px] text-white/70 animate-fade-in">
            <Sparkles size={11} className="text-[var(--accent)]" />
            Free · Browser-based · No sign-up
          </div>

          <h1 className="mt-7 text-[44px] sm:text-[64px] lg:text-[80px] leading-[1.02] font-semibold tracking-[-0.04em] animate-fade-up">
            Edit any PDF.
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#2997ff] via-[#af52de] to-[#ff375f]">
              Right in your browser.
            </span>
          </h1>

          <p className="mt-7 max-w-2xl mx-auto text-[17px] sm:text-[19px] leading-relaxed text-white/65 animate-fade-up delay-200">
            Text, images, signatures, redaction, watermarks, page management —
            the full editor, nothing installed, nothing uploaded.
          </p>

          <div className="mt-10 flex items-center justify-center gap-3 animate-fade-up delay-300">
            <button
              onClick={openUpload}
              className="group relative h-12 px-7 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[15px] font-medium shadow-[0_8px_30px_rgba(41,151,255,0.4)] active:scale-[0.97] transition-all duration-300"
            >
              <span className="flex items-center gap-2">
                Edit PDF
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
            <a
              href="#features"
              className="h-12 px-5 rounded-full border border-white/15 text-white/85 text-[15px] font-medium hover:bg-white/5 transition flex items-center"
            >
              See what’s inside
            </a>
          </div>

          {/* Product mockup */}
          <div className="mt-20 animate-fade-up delay-500">
            <ProductMockup />
          </div>
        </div>
      </section>

      {/* ── Features grid ──────────────────────────────────────────────── */}
      <section id="features" className="relative py-28 px-6">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--accent)] font-medium text-center">
              Everything you need
            </p>
            <h2 className="mt-3 text-[34px] sm:text-[48px] font-semibold tracking-[-0.03em] text-center">
              A complete editor, in a tab.
            </h2>
            <p className="mt-4 max-w-2xl mx-auto text-center text-white/60 text-[16px]">
              Nine tools you’d expect from desktop software — running on PDF.js,
              pdf-lib and Fabric, all client-side.
            </p>
          </Reveal>

          <div className="mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map(({ icon: Icon, title, desc }, i) => (
              <Reveal key={title} delay={i * 60}>
                <div className="group h-full p-6 rounded-2xl bg-gradient-to-b from-white/[0.04] to-white/[0.015] border border-white/10 hover:border-white/25 hover:bg-white/[0.06] transition-all duration-500">
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/15 border border-[var(--accent)]/25 flex items-center justify-center transition-transform duration-500 group-hover:scale-110">
                    <Icon size={18} className="text-[var(--accent)]" />
                  </div>
                  <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{title}</h3>
                  <p className="mt-1.5 text-[14px] text-white/55 leading-relaxed">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────── */}
      <section id="how" className="relative py-28 px-6 border-t border-white/5">
        <div className="max-w-5xl mx-auto">
          <Reveal>
            <p className="text-[13px] uppercase tracking-[0.18em] text-[var(--accent)] font-medium text-center">
              Three steps
            </p>
            <h2 className="mt-3 text-[34px] sm:text-[48px] font-semibold tracking-[-0.03em] text-center">
              From dropped to done.
            </h2>
          </Reveal>

          <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map((s, i) => (
              <Reveal key={s.n} delay={i * 120}>
                <div className="relative p-8 rounded-3xl bg-white/[0.03] border border-white/10 h-full">
                  <span className="text-[11px] font-semibold tracking-[0.18em] text-[var(--accent)]">
                    {s.n}
                  </span>
                  <h3 className="mt-3 text-[22px] font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-2 text-white/55 text-[15px] leading-relaxed">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Privacy band ───────────────────────────────────────────────── */}
      <section id="privacy" className="relative py-28 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto text-center">
          <Reveal>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400/20 to-emerald-600/10 border border-emerald-400/25">
              <Lock size={22} className="text-emerald-400" />
            </div>
            <h2 className="mt-6 text-[32px] sm:text-[44px] font-semibold tracking-[-0.03em]">
              Your file never leaves your device.
            </h2>
            <p className="mt-5 max-w-2xl mx-auto text-white/60 text-[16px] leading-relaxed">
              There is no server, no upload, no telemetry. Everything you do
              happens inside this tab. Close it and it’s gone.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              {[
                { icon: Shield,        label: 'Zero uploads' },
                { icon: Zap,           label: 'No install' },
                { icon: MousePointer2, label: 'Works offline' },
              ].map(({ icon: Icon, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/[0.05] border border-white/10 text-[12px] text-white/75"
                >
                  <Icon size={12} /> {label}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="relative py-32 px-6 border-t border-white/5">
        <div className="max-w-3xl mx-auto text-center">
          <Reveal>
            <h2 className="text-[36px] sm:text-[56px] font-semibold tracking-[-0.03em]">
              Ready to edit?
            </h2>
            <p className="mt-4 text-white/60 text-[17px]">
              Drop in any PDF and start. No accounts. No watermarks.
            </p>
            <button
              onClick={openUpload}
              className="group mt-9 inline-flex items-center gap-2 px-8 py-3.5 rounded-full bg-white text-black text-[16px] font-medium hover:bg-white/90 active:scale-[0.97] transition-all duration-300 shadow-[0_8px_40px_rgba(255,255,255,0.15)]"
            >
              Edit PDF
              <ArrowRight size={17} className="transition-transform group-hover:translate-x-0.5" />
            </button>
          </Reveal>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-10 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-[12px] text-white/40">
          <span>PDF Editor — runs entirely in your browser.</span>
          <span>© {new Date().getFullYear()} · Built with PDF.js, pdf-lib & Fabric</span>
        </div>
      </footer>

      {/* ── Upload sheet ───────────────────────────────────────────────── */}
      {uploadOpen && (
        <UploadSheet onClose={closeUpload} onFileAccepted={handleFileAccepted} />
      )}
    </main>
  );
}

/** Stylised editor preview that lives under the hero. Purely decorative. */
function ProductMockup() {
  return (
    <div className="relative mx-auto max-w-4xl">
      <div className="absolute -inset-x-20 -inset-y-10 bg-gradient-to-r from-[#2997ff]/20 via-[#af52de]/20 to-[#ff375f]/20 blur-3xl rounded-full opacity-60 animate-glow" />
      <div className="relative rounded-2xl border border-white/10 bg-[#0a0a0a] overflow-hidden shadow-[0_30px_120px_-20px_rgba(0,0,0,0.8)] animate-float">
        <div className="flex items-center gap-1.5 px-4 h-9 bg-white/[0.04] border-b border-white/5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[11px] text-white/40">contract-v3.pdf</span>
        </div>
        <div className="flex items-center gap-1 px-3 h-10 bg-white/[0.02] border-b border-white/5">
          {[Type, Pen, Highlighter, PenLine, ImageIcon, Stamp, Droplets, Search].map((Icon, i) => (
            <div
              key={i}
              className={`w-7 h-7 rounded-md flex items-center justify-center ${
                i === 0 ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'text-white/45'
              }`}
            >
              <Icon size={13} />
            </div>
          ))}
        </div>
        <div className="flex">
          <div className="hidden sm:flex flex-col gap-1.5 p-2 w-20 border-r border-white/5 bg-white/[0.01]">
            {[1, 2, 3].map((p) => (
              <div
                key={p}
                className={`h-16 rounded ${p === 1 ? 'bg-[var(--accent)]/15 border border-[var(--accent)]/40' : 'bg-white/[0.04]'}`}
              />
            ))}
          </div>
          <div className="flex-1 p-6 bg-white/[0.02]">
            <div className="mx-auto max-w-md aspect-[1/1.3] bg-white rounded-md shadow-2xl p-6 text-black">
              <div className="h-3 w-24 bg-black/80 rounded-sm" />
              <div className="mt-4 space-y-2">
                <div className="h-1.5 w-full bg-black/15 rounded" />
                <div className="h-1.5 w-[92%] bg-black/15 rounded" />
                <div className="h-1.5 w-[78%] bg-black/15 rounded" />
              </div>
              <div className="mt-4 inline-block px-1 py-0.5 bg-yellow-300/80 rounded-sm">
                <div className="h-1.5 w-20 bg-black/60 rounded" />
              </div>
              <div className="mt-4 space-y-2">
                <div className="h-1.5 w-full bg-black/15 rounded" />
                <div className="h-1.5 w-[88%] bg-black/15 rounded" />
              </div>
              <div className="mt-6 flex items-end justify-end">
                <svg viewBox="0 0 120 40" className="w-24 h-8 text-[var(--accent)]">
                  <path
                    d="M2,30 C 15,5 25,35 38,18 S 65,5 80,25 S 110,15 118,28"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Centered upload modal that mounts the existing DropZone. */
function UploadSheet({
  onClose,
  onFileAccepted,
}: {
  onClose: () => void;
  onFileAccepted: (file: File, bytes: ArrayBuffer) => void;
}) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-3xl bg-[#0c0c0e] border border-white/10 shadow-2xl p-6 sm:p-8 animate-scale-in"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center text-white/70 hover:text-white transition"
        >
          <X size={15} />
        </button>

        <div className="text-center mb-6">
          <h3 className="text-[22px] sm:text-[26px] font-semibold tracking-[-0.02em]">
            Open a PDF
          </h3>
          <p className="mt-1.5 text-[13px] text-white/55">
            Drag a file here or click to browse. Up to 100 MB.
          </p>
        </div>

        <DropZone onFileAccepted={onFileAccepted} />

        <div className="mt-5 flex items-center justify-center gap-2 text-[11px] text-white/40">
          <Lock size={11} />
          Files stay on this device. We never upload them.
        </div>
      </div>
    </div>
  );
}
