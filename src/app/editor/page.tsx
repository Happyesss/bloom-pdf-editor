'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfFromStorage, clearPdfFromStorage } from '@/lib/pdfStorage';

// We import types only — the engine modules are loaded dynamically
// because they require browser APIs (canvas, DecompressionStream)
import type { PDFDocumentData, RenderResult } from '@/engine';

export default function EditorPage() {
  const router = useRouter();
  const [doc, setDoc] = useState<PDFDocumentData | null>(null);
  const [fileName, setFileName] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [isLoading, setIsLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<typeof import('@/engine') | null>(null);

  // Load engine and PDF on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Load PDF from IndexedDB
        const stored = await loadPdfFromStorage();
        if (!stored) {
          router.push('/');
          return;
        }

        if (cancelled) return;
        setFileName(stored.fileName);

        // Dynamically import engine (needs browser APIs)
        const engine = await import('@/engine');
        engineRef.current = engine;

        // Parse the PDF
        const pdfBytes = new Uint8Array(stored.bytes);
        const parsed = await engine.parsePDF(pdfBytes);

        if (cancelled) return;
        setDoc(parsed);
        setTotalPages(parsed.pages.length);
        setCurrentPage(0);
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
  }, [router]);

  // Render current page when doc, page, or scale changes
  useEffect(() => {
    if (!doc || !engineRef.current) return;
    let cancelled = false;

    async function render() {
      setIsRendering(true);
      try {
        const engine = engineRef.current!;
        const result = await engine.renderPage(doc!, currentPage, { scale });

        if (cancelled) return;
        setRenderResult(result);

        // Mount canvas into the container
        if (canvasContainerRef.current) {
          canvasContainerRef.current.innerHTML = '';
          result.canvas.style.display = 'block';
          result.canvas.style.margin = '0 auto';
          canvasContainerRef.current.appendChild(result.canvas);
        }
      } catch (e) {
        if (cancelled) return;
        console.error('[Editor] Render failed:', e);
        setError(`Render failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      setIsRendering(false);
    }

    render();
    return () => { cancelled = true; };
  }, [doc, currentPage, scale]);

  // Navigation handlers
  const goToPrev = useCallback(() => {
    setCurrentPage((p) => Math.max(0, p - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentPage((p) => Math.min(totalPages - 1, p + 1));
  }, [totalPages]);

  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(4, s + 0.25));
  }, []);

  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(0.5, s - 0.25));
  }, []);

  const handleDownload = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    try {
      const engine = engineRef.current;
      const bytes = await engine.serializeDocument(doc);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[Editor] Download failed:', e);
      setError(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, fileName]);

  const handleClose = useCallback(async () => {
    await clearPdfFromStorage();
    router.push('/');
  }, [router]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goToPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        goToNext();
      } else if (e.key === '+' || e.key === '=') {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          zoomIn();
        }
      } else if (e.key === '-') {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          zoomOut();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToPrev, goToNext, zoomIn, zoomOut]);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div style={styles.center}>
        <div style={styles.spinner} />
        <p style={{ color: '#aaa', marginTop: 16, fontSize: 14 }}>
          Parsing PDF with our engine...
        </p>
        <style>{spinnerCSS}</style>
      </div>
    );
  }

  // ── Error state ──
  if (error && !doc) {
    return (
      <div style={styles.center}>
        <p style={{ color: '#ff453a', fontSize: 15, maxWidth: 400, textAlign: 'center' as const, lineHeight: 1.6 }}>
          {error}
        </p>
        <button onClick={handleClose} style={styles.btn}>
          ← Go Back
        </button>
      </div>
    );
  }

  // ── Main editor UI ──
  return (
    <div style={styles.layout}>
      {/* ── Top toolbar ── */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarGroup}>
          <button onClick={handleClose} style={styles.toolBtn} title="Close file">
            ✕
          </button>
          <span style={styles.fileName}>{fileName}</span>
        </div>

        <div style={styles.toolbarGroup}>
          {/* Page navigation */}
          <button onClick={goToPrev} disabled={currentPage === 0} style={styles.toolBtn}>
            ◀
          </button>
          <span style={styles.pageInfo}>
            {currentPage + 1} / {totalPages}
          </span>
          <button onClick={goToNext} disabled={currentPage >= totalPages - 1} style={styles.toolBtn}>
            ▶
          </button>

          <span style={styles.separator} />

          {/* Zoom */}
          <button onClick={zoomOut} disabled={scale <= 0.5} style={styles.toolBtn}>
            −
          </button>
          <span style={styles.zoomInfo}>
            {Math.round(scale * 100)}%
          </span>
          <button onClick={zoomIn} disabled={scale >= 4} style={styles.toolBtn}>
            +
          </button>
        </div>

        <div style={styles.toolbarGroup}>
          <button onClick={handleDownload} style={styles.toolBtn} title="Download PDF">
            ↓ Save
          </button>
        </div>
      </div>

      {/* ── Canvas area ── */}
      <div style={styles.canvasArea}>
        {isRendering && (
          <div style={styles.renderingOverlay}>
            <div style={styles.spinnerSmall} />
          </div>
        )}
        <div ref={canvasContainerRef} style={styles.canvasContainer} />
      </div>

      {/* ── Bottom status bar ── */}
      <div style={styles.statusBar}>
        <span style={styles.statusText}>
          {renderResult
            ? `${renderResult.pageWidth.toFixed(0)} × ${renderResult.pageHeight.toFixed(0)} pt`
            : ''}
        </span>
        <span style={styles.statusText}>
          {renderResult ? `${renderResult.textRuns.length} text runs` : ''}
        </span>
        <span style={styles.statusText}>
          {doc ? `${totalPages} pages | v${doc.version}` : ''}
        </span>
      </div>

      {/* Error toast */}
      {error && (
        <div style={styles.errorToast}>
          {error}
          <button onClick={() => setError(null)} style={styles.errorClose}>✕</button>
        </div>
      )}

      <style>{spinnerCSS}</style>
    </div>
  );
}

// ── Inline styles ──

const styles: Record<string, React.CSSProperties> = {
  center: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #333',
    borderTopColor: '#2997ff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  spinnerSmall: {
    width: 24,
    height: 24,
    border: '2px solid #333',
    borderTopColor: '#2997ff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  layout: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    height: 48,
    background: '#111',
    borderBottom: '1px solid #222',
    flexShrink: 0,
  },
  toolbarGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  toolBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#ccc',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'system-ui',
    lineHeight: '20px',
  },
  btn: {
    background: 'none',
    border: '1px solid #444',
    color: '#ccc',
    padding: '8px 20px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    marginTop: 20,
    fontFamily: 'system-ui',
  },
  fileName: {
    color: '#888',
    fontSize: 13,
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pageInfo: {
    color: '#aaa',
    fontSize: 13,
    minWidth: 60,
    textAlign: 'center',
  },
  zoomInfo: {
    color: '#aaa',
    fontSize: 12,
    minWidth: 44,
    textAlign: 'center',
  },
  separator: {
    width: 1,
    height: 20,
    background: '#333',
    margin: '0 6px',
  },
  canvasArea: {
    flex: 1,
    overflow: 'auto',
    background: '#1a1a1a',
    position: 'relative',
  },
  canvasContainer: {
    padding: '24px 0',
    minHeight: '100%',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  renderingOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    background: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 8,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: 28,
    background: '#0a0a0a',
    borderTop: '1px solid #1a1a1a',
    flexShrink: 0,
  },
  statusText: {
    color: '#555',
    fontSize: 11,
  },
  errorToast: {
    position: 'fixed',
    bottom: 40,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#2a1215',
    border: '1px solid #5c2228',
    color: '#ff6b6b',
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    zIndex: 100,
  },
  errorClose: {
    background: 'none',
    border: 'none',
    color: '#ff6b6b',
    cursor: 'pointer',
    fontSize: 14,
    padding: 0,
  },
};

const spinnerCSS = `@keyframes spin { to { transform: rotate(360deg); } }`;
