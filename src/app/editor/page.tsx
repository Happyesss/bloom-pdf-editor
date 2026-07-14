'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfFromStorage, clearPdfFromStorage } from '@/lib/pdfStorage';
import { X, Loader2, ChevronLeft, Image, Type } from 'lucide-react';

// We import types only — the engine modules are loaded dynamically
// because they require browser APIs (canvas, DecompressionStream)
import type { PDFDocumentData, RenderResult, TextRun, TextLine, ImageItem, PathItem, DisplayItem, TextWatermark, ImageWatermark, Watermark, DetectedWatermark, AcroFormWidget, BloomPage, DetectedTable, VisualSignature, SignatureLibraryEntry, SignatureField, ManagedIdentity, ValidationReport, LtvStatus, ManagedSignature, RevisionViewEntry } from '@/engine';

import type { EditorTool, ToolDef, PathType, DrawnPath, FloatingText, FloatingImage } from './types';
import { TOOLS } from './types';
import {
  canvasToPdf, pdfToCanvas, hexToRGB,
  hitTestTextLine, findNearestTextLine, caretIndexFromLineX,
  getLineBounds, getOverlayFontFamily, getDisplayFontFamily,
} from './utils';
import { buildDisplayListIndex, hitTestDisplayList, isSelectableDisplayItem, TransactionStack, deleteObject, visualFontSize, resolveRunStyleFlags, transformObject, applyObjectTransform, distributeTextChangeToSegments, segmentAtIndex, createVisualSignature, hitTestSignature, moveSignature, resizeSignature, rotateSignature, setSignatureOpacity, setSignatureLocked, deleteSignature, updateSignature, SignatureHistory, getSignatureLibrary, DEFAULT_SIGNATURE_SIZE, detectSignatureFieldsOnPage, hitTestSignatureField, createSignatureFieldAtPoint, applySignatureFieldAppearanceAsync, getCertificateManager, signDocumentCryptographic, validateDocumentSignatures, enableLongTermValidation, getLtvStatus, listManagedSignatures, buildRevisionViewer, lockSignaturesAfterSigning, pushRecentSignatureId, orderLibraryByRecent, SIGNATURE_SHORTCUTS } from '@/engine';
import type { QuadTree, SelectableItem, EditableObject } from '@/engine';
import { findMatchingFlowLine } from './flowLineMatch';

import { Toolbar } from './components/Toolbar';
import { ToolsSidebar } from './components/ToolsSidebar';
import { PropertiesSidebar } from './components/PropertiesSidebar';
import { EditableLineBox, type OverlaySegmentStyle } from './components/EditableLineBox';
import { LinkPopover, type LinkPopoverMode } from './components/LinkPopover';
import { EmbeddedImageOverlay } from './components/EmbeddedImageOverlay';
import { SignatureOverlay } from './components/SignatureOverlay';
import { SignatureCreateDialog, type SignatureCreateResult } from './components/SignatureCreateDialog';
import { CertificateImportDialog } from './components/CertificateImportDialog';
import { WatermarkPreview } from './components/WatermarkPreview';
import { ThumbnailsSidebar } from './components/ThumbnailsSidebar';
import { FindReplacePanel } from './components/FindReplacePanel';
import { StatusBar } from './components/StatusBar';
import { ExportPanel } from './components/ExportPanel';
import { useTextStyleActions, type TextStyleUI } from './hooks/useTextStyleActions';

/** True if the run is underlined or a thin stroke path sits under it (certificate labels). */
function runHasPathUnderline(run: TextRun, paths: PathItem[]): boolean {
  if (run.isUnderline) return true;
  const fs = visualFontSize(run);
  const yTarget = run.y - fs * 0.12;
  for (const p of paths) {
    if (p.paintType !== 'stroke' && p.paintType !== 'both') continue;
    if (p.height > fs * 0.5) continue;
    if (p.width < fs * 0.4) continue;
    if (p.lineWidth > fs * 0.4) continue;
    const py = p.y + p.height * 0.5;
    if (Math.abs(py - yTarget) > fs * 0.45 && Math.abs(p.y - yTarget) > fs * 0.45) continue;
    const overlapL = Math.max(p.x, run.x);
    const overlapR = Math.min(p.x + p.width, run.x + Math.max(run.width, fs));
    if (overlapR - overlapL < fs * 0.3) continue;
    return true;
  }
  return false;
}

type EditStyleOverride = {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  fontSize?: number;
  fontFamily?: string;
};

/** Map sidebar font names to a CSS font-family stack for the edit overlay. */
function cssFontFamilyFromUI(name: string): string {
  const n = name.trim();
  if (!n) return 'Helvetica, Arial, sans-serif';
  const lower = n.toLowerCase();
  if (lower === 'helvetica') return 'Helvetica, Arial, sans-serif';
  if (lower === 'times-roman' || lower === 'times') return '"Times New Roman", Times, serif';
  if (lower === 'courier') return '"Courier New", Courier, monospace';
  if (lower.includes('mono') || lower.includes('consolas') || lower.includes('courier')) {
    return `"${n}", "Courier New", monospace`;
  }
  if (lower.includes('serif') || lower.includes('times') || lower.includes('georgia') || lower.includes('garamond') || lower.includes('palatino') || lower.includes('cambria')) {
    return `"${n}", "Times New Roman", serif`;
  }
  return `"${n}", Helvetica, Arial, sans-serif`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter();

  // ── Core state ──
  const [doc, setDoc] = useState<PDFDocumentData | null>(null);
  const [fileName, setFileName] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [thumbnailKey, setThumbnailKey] = useState(0);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);

  // ── Phase 4 state ──
  const [activeTool, setActiveTool] = useState<EditorTool>('text');
  const [selectedLine, setSelectedLine] = useState<TextLine | null>(null);
  const [editingLineState, setEditingLineState] = useState<TextLine | null>(null);
  const editingLineRef = useRef<TextLine | null>(null);
  const editingLine = editingLineState;
  const setEditingLine = useCallback((line: TextLine | null | ((prev: TextLine | null) => TextLine | null)) => {
    if (typeof line === 'function') {
      setEditingLineState((prev: TextLine | null) => {
        const next = line(prev);
        editingLineRef.current = next;
        return next;
      });
    } else {
      editingLineRef.current = line;
      setEditingLineState(line);
    }
  }, []);
  const initialRunTextRef = useRef<string>('');
  const editAnchorLineRef = useRef<TextLine | null>(null);
  /** Pending style patches queued while typing, each with a char range. */
  const pendingStylesRef = useRef<Array<{ patch: Partial<TextStyleUI>; start: number; end: number }>>([]);
  /** Word-like typing style: applies to newly typed chars when caret is collapsed. */
  const typingStyleRef = useRef<Partial<Pick<TextStyleUI, 'bold' | 'italic' | 'underline' | 'color' | 'fontSize' | 'fontFamily'>>>({});
  /** True while the pointer is over the link popover (keeps hover open). */
  const linkPopoverHoverRef = useRef(false);
  const editTextRef = useRef('');
  const [editText, setEditText] = useState('');
  const [caretPos, setCaretPos] = useState(0); // character index for caret
  const editSelRef = useRef({ start: 0, end: 0 });
  const [editSel, setEditSel] = useState({ start: 0, end: 0 });
  /** Live style overrides for the edit overlay (selection-scoped). */
  const [editStyleOverrides, setEditStyleOverrides] = useState<EditStyleOverride[]>([]);
  /** CSS-pixel offset of the edit box from its natural position. */
  const [editOffsetCss, setEditOffsetCss] = useState({ x: 0, y: 0 });
  /** Manual size override in CSS px (null = auto-grow from content). */
  const [editManualSize, setEditManualSize] = useState<{ w: number | null; h: number | null }>({ w: null, h: null });
  const [isSaving, setIsSaving] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  // Bloom Engine — Word-like page model (source of truth for text editing)
  const [bloomPage, setBloomPage] = useState<BloomPage | null>(null);
  const bloomPageRef = useRef<BloomPage | null>(null);
  const editingBlockIdRef = useRef<string | null>(null);
  const setBloomPageBoth = useCallback((page: BloomPage | null) => {
    bloomPageRef.current = page;
    setBloomPage(page);
  }, []);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPaths, setDrawnPaths] = useState<DrawnPath[]>([]);
  const currentDrawPath = useRef<{ x: number; y: number }[]>([]);
  /** True after a freehand highlight/draw stroke so click doesn't also add a PDF annotation. */
  const skipNextHighlightClickRef = useRef(false);
  /** True once the pointer moved enough during highlight/draw to count as a drag. */
  const drawDraggedRef = useRef(false);
  /** Last eraser sample point — used to interpolate when the pointer jumps. */
  const lastErasePosRef = useRef<{ x: number; y: number } | null>(null);
  const [pageLinks, setPageLinks] = useState<import('@/engine').PageLinkInfo[]>([]);
  const [selectedLink, setSelectedLink] = useState<import('@/engine').PageLinkInfo | null>(null);
  const [linkDraftUrl, setLinkDraftUrl] = useState('');
  const [linkDisplayDraft, setLinkDisplayDraft] = useState('');
  /** Only after "Scan for links" — highlights + hover popovers on the PDF. */
  const [linksHighlighted, setLinksHighlighted] = useState(false);
  const [linkPopoverMode, setLinkPopoverMode] = useState<LinkPopoverMode | null>(null);
  const linkHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Pending "add link" flow: waiting for URL in the text sidebar. */
  const [linkCreatePending, setLinkCreatePending] = useState(false);


  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [activeFloatingTextId, setActiveFloatingTextId] = useState<string | null>(null);

  const [floatingImages, setFloatingImages] = useState<FloatingImage[]>([]);
  const [activeFloatingImageId, setActiveFloatingImageId] = useState<string | null>(null);
  const replacingImageIdRef = useRef<string | null>(null);
  /** When set, next file pick replaces this embedded PDF image in-place. */
  const replacingEmbeddedImageRef = useRef<ImageItem | null>(null);

  const dragInfo = useRef<{ id: string; type: 'text' | 'image'; startX: number; startY: number; startPdfX: number; startPdfY: number } | null>(null);

  /** Viewport grab-to-pan while zoomed (or Space held). */
  const [isPanning, setIsPanning] = useState(false);
  const [spacePanHeld, setSpacePanHeld] = useState(false);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null>(null);

  // Tool properties
  const [drawColor, setDrawColor] = useState('#ff3b30');
  const [drawSize, setDrawSize] = useState(2);
  const [highlightColor, setHighlightColor] = useState('#fffb00');
  const [highlightSize, setHighlightSize] = useState(16);
  const [eraserSize, setEraserSize] = useState(20);

  // Watermark tool properties
  const [watermarkType, setWatermarkType] = useState<'text' | 'image' | 'shape'>('text');
  const [watermarkShapeType, setWatermarkShapeType] = useState<'rectangle' | 'circle' | 'pill'>('circle');
  const [watermarkShapeColor, setWatermarkShapeColor] = useState('#000000');
  const [watermarkText, setWatermarkText] = useState('Bloom PDF');
  const [watermarkFontName, setWatermarkFontName] = useState('Arial');
  const [watermarkOpacity, setWatermarkOpacity] = useState(50);
  const [watermarkRotation, setWatermarkRotation] = useState(45);
  const [watermarkSize, setWatermarkSize] = useState(50);
  const [watermarkPosition, setWatermarkPosition] = useState('center');
  const [watermarkMosaic, setWatermarkMosaic] = useState(false);
  const [watermarkLivePreview, setWatermarkLivePreview] = useState(true);
  const [showApplySuccessModal, setShowApplySuccessModal] = useState(false);
  const [watermarkPageFrom, setWatermarkPageFrom] = useState(1);
  const [watermarkPageTo, setWatermarkPageTo] = useState(1);
  const [watermarkLayer, setWatermarkLayer] = useState<'above' | 'below'>('above');
  const [watermarkColor, setWatermarkColor] = useState('#000000');
  const [watermarkImageFile, setWatermarkImageFile] = useState<File | null>(null);
  const [watermarkImageBytes, setWatermarkImageBytes] = useState<Uint8Array | null>(null);
  const [watermarkImageDims, setWatermarkImageDims] = useState<{ width: number; height: number } | null>(null);
  const [watermarkBlendMode, setWatermarkBlendMode] = useState('Normal');

  const [detectedWatermarks, setDetectedWatermarks] = useState<DetectedWatermark[] | null>(null);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);

  // Display items (images/paths) for selection overlays
  const [displayItems, setDisplayItems] = useState<(ImageItem | PathItem)[]>([]);
  /** Thin stroke paths (underlines) excluded from selection but needed for edit overlay. */
  const [strokePaths, setStrokePaths] = useState<PathItem[]>([]);
  const [selectedDisplayItem, setSelectedDisplayItem] = useState<ImageItem | PathItem | null>(null);
  const spatialIndexRef = useRef<QuadTree<SelectableItem> | null>(null);

  // AcroForm fields on current page
  const [formFields, setFormFields] = useState<AcroFormWidget[]>([]);
  const [selectedFormField, setSelectedFormField] = useState<AcroFormWidget | null>(null);
  const [formFieldDraft, setFormFieldDraft] = useState('');
  /** Auto-detected PDF tables (grid of text cells). */
  const [detectedTables, setDetectedTables] = useState<DetectedTable[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);

  // Undo/redo via TransactionStack (+ visual signature history)
  const txStackRef = useRef(new TransactionStack());
  const signatureHistoryRef = useRef(new SignatureHistory());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoSnapshotRef = useRef<{ pageIndex: number; contentBytes: Uint8Array } | null>(null);

  const syncTxState = useCallback(() => {
    setCanUndo(txStackRef.current.canUndo() || signatureHistoryRef.current.canUndo());
    setCanRedo(txStackRef.current.canRedo() || signatureHistoryRef.current.canRedo());
  }, []);
  const [textFontFamily, setTextFontFamily] = useState('Helvetica');
  const [textFontSize, setTextFontSize] = useState(12);
  const [textColor, setTextColor] = useState('#000000');
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [textOpacity, setTextOpacity] = useState(100);
  const [saveMode, setSaveMode] = useState<'quick' | 'optimized'>('optimized');
  const [isDirty, setIsDirty] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showExportPanel, setShowExportPanel] = useState(false);

  // Visual signatures (Phases 1–3) — overlay only, no PDF write
  const [signatures, setSignatures] = useState<VisualSignature[]>([]);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [signatureLibraryEntries, setSignatureLibraryEntries] = useState<SignatureLibraryEntry[]>([]);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [signatureCreateOpen, setSignatureCreateOpen] = useState(false);
  const [pdfSignatureFields, setPdfSignatureFields] = useState<SignatureField[]>([]);
  const [selectedPdfSigFieldId, setSelectedPdfSigFieldId] = useState<string | null>(null);
  /** When true, next empty-page click creates an AcroForm Sig field instead of an overlay. */
  const [createFieldMode, setCreateFieldMode] = useState(false);
  const [certificateImportOpen, setCertificateImportOpen] = useState(false);
  const [certificateIdentities, setCertificateIdentities] = useState<ManagedIdentity[]>([]);
  const [selectedCertificateId, setSelectedCertificateId] = useState<string | null>(null);
  const [cryptoSignBusy, setCryptoSignBusy] = useState(false);
  const [enableTimestamp, setEnableTimestamp] = useState(false);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [ltvStatus, setLtvStatus] = useState<LtvStatus | null>(null);
  const [managedSignatures, setManagedSignatures] = useState<ManagedSignature[]>([]);
  const [revisionEntries, setRevisionEntries] = useState<RevisionViewEntry[]>([]);
  const signaturesRef = useRef<VisualSignature[]>([]);
  signaturesRef.current = signatures;

  const refreshSignatureLibrary = useCallback(() => {
    setSignatureLibraryEntries(orderLibraryByRecent(getSignatureLibrary().list()));
  }, []);

  const pushSignatureSnapshot = useCallback((next: VisualSignature[], label: string) => {
    setSignatures(next);
    signatureHistoryRef.current.push(next, label);
    syncTxState();
    setIsDirty(true);
  }, [syncTxState]);

  useEffect(() => {
    refreshSignatureLibrary();
    signatureHistoryRef.current.seed([], 'init');
  }, [refreshSignatureLibrary]);

  // ── Refs (declared early for hooks that need them) ──
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const engineRef = useRef<typeof import('@/engine') | null>(null);
  const [engineModule, setEngineModule] = useState<typeof import('@/engine') | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const bumpRender = useCallback(() => {
    setIsDirty(true);
    setRenderKey(k => k + 1);
  }, []);

  const getEditSelectionRange = useCallback(() => {
    if (!editingLineRef.current) return null;
    return editSelRef.current;
  }, []);

  const resolveEditStyleRange = useCallback((line: TextLine, start: number, end: number) => {
    let s = Math.max(0, Math.min(start, line.text.length));
    let e = Math.max(s, Math.min(end, line.text.length));
    // Collapsed caret is handled as typing-style (no existing-text restyle).
    if (e <= s) return { start: s, end: s };
    return { start: s, end: e };
  }, []);

  const { applyStyle } = useTextStyleActions(
    engineRef,
    doc,
    currentPage,
    selectedLine,
    bumpRender,
    getEditSelectionRange,
  );

  // Apply style changes from properties sidebar to the PDF
  const queueOrApplyStyle = useCallback((patch: Partial<TextStyleUI>) => {
    if (!selectedLine) return;
    if (editingLineRef.current) {
      const sel = editSelRef.current;
      const line = editAnchorLineRef.current ?? selectedLine;
      // Collapsed caret → typing style only (Word-like). Do NOT restyle existing text.
      if (sel.end <= sel.start) {
        typingStyleRef.current = {
          ...typingStyleRef.current,
          ...(patch.bold != null ? { bold: patch.bold } : {}),
          ...(patch.italic != null ? { italic: patch.italic } : {}),
          ...(patch.underline != null ? { underline: patch.underline } : {}),
          ...(patch.color != null ? { color: patch.color } : {}),
          ...(patch.fontSize != null ? { fontSize: patch.fontSize } : {}),
          ...(patch.fontFamily != null ? { fontFamily: patch.fontFamily } : {}),
        };
        return;
      }
      // Real selection (drag / double-click word / select-all) → style only that range
      const range = resolveEditStyleRange(line, sel.start, sel.end);
      if (range.end <= range.start) return;
      pendingStylesRef.current = [...pendingStylesRef.current, { patch, ...range }];
      setEditStyleOverrides(prev => [
        ...prev,
        {
          start: range.start,
          end: range.end,
          bold: patch.bold,
          italic: patch.italic,
          underline: patch.underline,
          color: patch.color,
          fontSize: patch.fontSize,
          fontFamily: patch.fontFamily,
        },
      ]);
      return;
    }
    void applyStyle(patch);
  }, [selectedLine, applyStyle, resolveEditStyleRange]);

  const handleEditSelection = useCallback((start: number, end: number) => {
    editSelRef.current = { start, end };
    setEditSel({ start, end });
    setCaretPos(start);
    // A real selection clears typing-style (Word-like)
    if (end > start) typingStyleRef.current = {};

    // Sync sidebar toggles from the run under the caret / selection start
    const line = editAnchorLineRef.current;
    if (!line || !renderResult) return;
    const seg = segmentAtIndex(line, start);
    if (!seg) return;
    const run = seg.run;
    const flags = resolveRunStyleFlags(run.fontName, renderResult.fonts.get(run.fontName));
    let bold = flags.bold;
    let italic = flags.italic;
    let underline = !!run.isUnderline || runHasPathUnderline(run, strokePaths);
    let fontSize = visualFontSize(run);
    const fontData = renderResult.fonts.get(run.fontName);
    let fontFamily = getDisplayFontFamily(run.fontName, fontData);
    for (const ov of editStyleOverrides) {
      if (start >= ov.start && start < ov.end) {
        if (ov.bold != null) bold = ov.bold;
        if (ov.italic != null) italic = ov.italic;
        if (ov.underline != null) underline = ov.underline;
        if (ov.fontSize != null) fontSize = ov.fontSize;
        if (ov.fontFamily) fontFamily = ov.fontFamily;
        if (ov.color) setTextColor(ov.color.startsWith('#') ? ov.color : textColor);
      }
    }
    // Collapsed caret: typing style wins (user just toggled bold off to type normal)
    if (start === end) {
      const ts = typingStyleRef.current;
      if (ts.bold != null) bold = ts.bold;
      if (ts.italic != null) italic = ts.italic;
      if (ts.underline != null) underline = ts.underline;
      if (ts.fontSize != null) fontSize = ts.fontSize;
      if (ts.fontFamily) fontFamily = ts.fontFamily;
      if (ts.color) setTextColor(ts.color);
    }
    setTextBold(bold);
    setTextItalic(italic);
    setTextUnderline(underline);
    setTextFontSize(fontSize);
    setTextFontFamily(fontFamily);
    if (!(start === end && typingStyleRef.current.color != null) && run.fillColor) {
      const hasColorOv = editStyleOverrides.some(
        ov => start >= ov.start && start < ov.end && ov.color,
      );
      if (!hasColorOv) {
        const [r, g, b] = run.fillColor;
        const hex = '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        setTextColor(hex);
      }
    }
  }, [renderResult, strokePaths, editStyleOverrides, textFontFamily, textColor]);

  const handleTextBold = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTextBold(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      queueOrApplyStyle({ bold: next });
      return next;
    });
  }, [queueOrApplyStyle]);
  const handleTextItalic = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTextItalic(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      queueOrApplyStyle({ italic: next });
      return next;
    });
  }, [queueOrApplyStyle]);
  const handleTextUnderline = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTextUnderline(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      queueOrApplyStyle({ underline: next });
      return next;
    });
  }, [queueOrApplyStyle]);
  const handleTextFontSize = useCallback((v: number | ((prev: number) => number)) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setTextFontSize(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      queueOrApplyStyle({ fontSize: next });
      return next;
    });
    // Keep the edit box focused after clicking a size preset in the sidebar
    requestAnimationFrame(() => {
      hiddenInputRef.current?.focus({ preventScroll: true });
    });
  }, [queueOrApplyStyle]);
  const handleTextFontFamily = useCallback((v: string) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setTextFontFamily(v);
    queueOrApplyStyle({ fontFamily: v });
    requestAnimationFrame(() => {
      hiddenInputRef.current?.focus({ preventScroll: true });
    });
  }, [queueOrApplyStyle]);
  const handleTextColor = useCallback((v: string) => {
    setTextColor(v);
    queueOrApplyStyle({ color: v });
  }, [queueOrApplyStyle]);
  const handleTextAlign = useCallback((v: 'left' | 'center' | 'right') => {
    setTextAlign(v);
    queueOrApplyStyle({ align: v });
  }, [queueOrApplyStyle]);

  // Warn before leaving with unsaved edits
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Caret blinking
  const caretVisibleRef = useRef(true);
  const caretTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load engine and PDF ──
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
        setEngineModule(engine);

        const pdfBytes = new Uint8Array(stored.bytes);
        const parsed = await engine.parsePDF(pdfBytes);
        if (cancelled) return;

        setDoc(parsed);
        setTotalPages(parsed.pages.length);
        setCurrentPage(0);
        txStackRef.current.clear();
        const page0 = parsed.pages[0];
        const initialBytes = engine.getPageContentBytes(page0, parsed.objects);
        txStackRef.current.push({
          pageIndex: 0,
          contentBytes: new Uint8Array(initialBytes),
          label: 'initial',
          timestamp: Date.now(),
        });
        syncTxState();
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

  // ── Generate thumbnails ──
  useEffect(() => {
    if (!doc || !engineRef.current) return;
    let cancelled = false;

    async function generateThumbnails() {
      setIsGeneratingThumbnails(true);
      const engine = engineRef.current!;
      const thumbs: string[] = [];

      try {
        for (let i = 0; i < doc!.pages.length; i++) {
          if (cancelled) break;
          // Render at 15% scale for a quick thumbnail
          const res = await engine.renderPage(doc!, i, { scale: 0.15, renderText: true, renderPaths: true, renderImages: true });
          if (cancelled) break;
          thumbs.push(res.canvas.toDataURL('image/jpeg', 0.6));
        }
        if (!cancelled) setThumbnails(thumbs);
      } catch (e) {
        console.error('[Editor] Thumbnail generation failed:', e);
      } finally {
        if (!cancelled) setIsGeneratingThumbnails(false);
      }
    }

    generateThumbnails();
    return () => { cancelled = true; };
  }, [doc, thumbnailKey]);

  // Reset edit state when doc or page changes
  useEffect(() => {
    setEditingLine(null);
    setSelectedLine(null);
    setEditText('');
    setSelectedDisplayItem(null);
    setDisplayItems([]);
    spatialIndexRef.current = null;
  }, [doc, currentPage, setEditingLine]);

  // Sync text properties sidebar from selected line (use FontData BaseFont when available)
  useEffect(() => {
    if (selectedLine && selectedLine.runs.length > 0) {
      const run = selectedLine.runs[0];
      // Keep fractional size so overlay matches canvas (rounding caused a visible jump)
      setTextFontSize(visualFontSize(run));
      const fontData = renderResult?.fonts.get(run.fontName);
      setTextFontFamily(getDisplayFontFamily(run.fontName, fontData));
      const flags = resolveRunStyleFlags(run.fontName, fontData);
      setTextBold(flags.bold);
      setTextItalic(flags.italic);
      setTextUnderline(!!run.isUnderline);
      if (run.fillColor) {
        const [r, g, b] = run.fillColor;
        const hex = '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        setTextColor(hex);
      }
    }
  }, [selectedLine, renderResult]);

  // ── Render current page ──
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

        // Extract display items (images, significant paths) for bounding box overlays
        try {
          const pageData = doc!.pages[currentPage];
          const cBytes = engine.getPageContentBytes(pageData, doc!.objects);
          const interpreted = engine.interpretPage(cBytes, pageData, doc!.objects);
          const pageBounds = {
            x: pageData.mediaBox.x,
            y: pageData.mediaBox.y,
            width: pageData.mediaBox.width,
            height: pageData.mediaBox.height,
          };
          // Skip full-page background fills (0 0 612 792 re f) — they steal every click
          const visItems = interpreted.displayList.filter(
            (di: DisplayItem) => isSelectableDisplayItem(di, pageBounds),
          );
          // Keep thin strokes (form-label underlines) for edit-overlay decoration
          const thinStrokes = interpreted.displayList.filter((di: DisplayItem) => {
            if (di.type !== 'path') return false;
            const p = di as PathItem;
            if (p.paintType !== 'stroke' && p.paintType !== 'both') return false;
            // Horizontal underline: short height, meaningful width
            return (p.height || 0) <= 8 && (p.width || 0) >= 10;
          }) as PathItem[];
          if (!cancelled) setDisplayItems(visItems as (ImageItem | PathItem)[]);
          if (!cancelled) setStrokePaths(thinStrokes);
          if (!cancelled) {
            try {
              const lines = result.documentFlow?.lines ?? result.textLines ?? [];
              const allPaths = interpreted.displayList.filter(
                (di: DisplayItem) => di.type === 'path',
              ) as PathItem[];
              const tables = engine.detectTablesOnPage(lines, [...thinStrokes, ...allPaths]);
              setDetectedTables(tables);
            } catch (tblErr) {
              console.warn('[Editor] Table detect failed:', tblErr);
              setDetectedTables([]);
            }
          }
          if (!cancelled && doc) {
            try {
              setPageLinks(engine.listPageLinks(doc!, currentPage));
            } catch {
              setPageLinks([]);
            }
          }
          if (!cancelled) {
            spatialIndexRef.current = buildDisplayListIndex(
              visItems as DisplayItem[],
              pageBounds,
            );
          }

          // Bloom ingest — skip re-ingest while mid-edit with dirty in-memory page
          if (!cancelled && !(editingBlockIdRef.current && bloomPageRef.current?.dirty)) {
            const flow = result.documentFlow ?? engine.buildDocumentFlow(interpreted.textRuns);
            const ingested = engine.ingestPage(interpreted.textRuns, {
              pageIndex: currentPage,
              width: pageData.mediaBox.width,
              height: pageData.mediaBox.height,
              flow,
              displayList: interpreted.displayList,
            });
            setBloomPageBoth(ingested);
          }
        } catch (dispErr) {
          console.warn('[Editor] Display items extraction failed:', dispErr);
          if (!cancelled) setDisplayItems([]);
          if (!cancelled) setStrokePaths([]);
          if (!cancelled) spatialIndexRef.current = null;
        }

        try {
          const fields = engine.detectFormFieldsOnPage(doc!, currentPage);
          if (!cancelled) {
            setFormFields(fields);
            if (selectedFormField) {
              const still = fields.find(f => f.ref.toKey() === selectedFormField.ref.toKey());
              setSelectedFormField(still ?? null);
              setFormFieldDraft(still && typeof still.value === 'string' ? still.value : '');
            }
          }
        } catch {
          if (!cancelled) setFormFields([]);
        }

        try {
          const sigFields = detectSignatureFieldsOnPage(doc!, currentPage);
          if (!cancelled) {
            setPdfSignatureFields(sigFields);
            if (selectedPdfSigFieldId) {
              const still = sigFields.find((f) => f.id === selectedPdfSigFieldId);
              if (!still) setSelectedPdfSigFieldId(null);
            }
          }
        } catch {
          if (!cancelled) setPdfSignatureFields([]);
        }

        // Re-sync editing line only when not in overlay preview mode
        if (editingLineRef.current && !editAnchorLineRef.current) {
          const oldLine = editingLineRef.current;
          const newLine = result.textLines.find((l: TextLine) =>
            l.id === oldLine.id ||
            (Math.abs(l.baseline - oldLine.baseline) < 5 && Math.abs(l.x - oldLine.x) < 30)
          );
          if (newLine) {
            setEditingLine(newLine);
            setSelectedLine(newLine);
          } else {
            setEditingLine(null);
            setSelectedLine(null);
          }
        }

        // Mount canvas
        if (canvasContainerRef.current) {
          const wrapper = canvasContainerRef.current;
          // Remove old PDF canvas
          const oldCanvas = wrapper.querySelector('canvas.pdf-canvas');
          if (oldCanvas) oldCanvas.remove();

          result.canvas.className = 'pdf-canvas';
          result.canvas.style.display = 'block';
          result.canvas.style.position = 'relative';
          result.canvas.style.zIndex = '1';
          pdfCanvasRef.current = result.canvas;
          wrapper.prepend(result.canvas);

          // Size the overlay canvas to match
          const overlay = overlayRef.current;
          if (overlay) {
            const dpr = window.devicePixelRatio || 1;
            overlay.width = result.canvas.width;
            overlay.height = result.canvas.height;
            overlay.style.width = result.canvas.style.width;
            overlay.style.height = result.canvas.style.height;
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, currentPage, scale, renderKey]);

  // ── Draw overlay (caret, freehand paths) — NO boxes or highlights ──
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay || !renderResult) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const page = doc?.pages[currentPage];
    if (!page) return;
    const { mediaBox } = page;

    // ── Edit: white-out only the active line (HTML input shows typed text) ──
    // Match EditableLineBox placement: baseline-aligned. Keep descent small so
    // native path underlines under form labels stay visible on the canvas.
    if (editingLine && editAnchorLineRef.current) {
      const anchor = editAnchorLineRef.current;
      const bounds = getLineBounds(anchor);
      let maxFs = anchor.runs[0] ? visualFontSize(anchor.runs[0]) : anchor.fontSize;
      for (const run of anchor.runs) maxFs = Math.max(maxFs, visualFontSize(run));
      for (const ov of editStyleOverrides) {
        if (ov.fontSize != null) maxFs = Math.max(maxFs, ov.fontSize);
      }
      if (typingStyleRef.current.fontSize != null) {
        maxFs = Math.max(maxFs, typingStyleRef.current.fontSize);
      }
      if (editSel.end <= editSel.start && textFontSize > 0) {
        maxFs = Math.max(maxFs, textFontSize);
      }
      const fontSizeCss = maxFs * scale;
      const baseline = anchor.baseline;
      const ascent = fontSizeCss * 0.85;
      const descent = fontSizeCss * 0.25;

      ctx.save();
      ctx.scale(dpr, dpr);

      const leftPt = pdfToCanvas(
        bounds.x,
        baseline,
        scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
      );
      const growW = Math.max(
        bounds.width * scale,
        editText.length > 0 ? editText.length * fontSizeCss * 0.55 : 0,
      );
      const rx = leftPt.cssX + editOffsetCss.x;
      const ry = leftPt.cssY - ascent + editOffsetCss.y;
      const rw = editManualSize.w ?? growW;
      const rh = editManualSize.h ?? (ascent + descent);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);

      ctx.restore();
    }

    // ── Display item bounding boxes — hide while typing so blue handles don't appear on words ──
    if ((activeTool === 'select' || activeTool === 'text') && displayItems.length > 0 && !editingLine) {
      ctx.save();
      ctx.scale(dpr, dpr);

      for (const item of displayItems) {
        const isImage = item.type === 'image';
        const isSelected = selectedDisplayItem === item;

        const topLeft = pdfToCanvas(
          item.x, item.y + item.height,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const bottomRight = pdfToCanvas(
          item.x + item.width, item.y,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );

        const boxX = topLeft.cssX;
        const boxY = topLeft.cssY;
        const boxW = bottomRight.cssX - topLeft.cssX;
        const boxH = bottomRight.cssY - topLeft.cssY;

        if (boxW < 3 || boxH < 3) continue;

        if (isSelected) {
          ctx.strokeStyle = isImage ? '#3b82f6' : '#22c55e';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.fillStyle = isImage ? 'rgba(59,130,246,0.06)' : 'rgba(34,197,94,0.06)';
          ctx.fillRect(boxX, boxY, boxW, boxH);
          ctx.strokeRect(boxX, boxY, boxW, boxH);

          const hs = 7;
          ctx.fillStyle = isImage ? '#3b82f6' : '#22c55e';
          const corners: [number, number][] = [
            [boxX, boxY], [boxX + boxW, boxY],
            [boxX, boxY + boxH], [boxX + boxW, boxY + boxH],
          ];
          for (const [cx, cy] of corners) {
            ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
          }

          ctx.font = '600 11px Inter, system-ui, sans-serif';
          const label = isImage ? 'Image' : 'Drawing / Signature';
          const labelW = ctx.measureText(label).width;
          const badgePad = 6;
          const badgeH = 20;
          const badgeY2 = boxY - badgeH - 4;
          ctx.fillStyle = isImage ? '#3b82f6' : '#22c55e';
          ctx.beginPath();
          ctx.roundRect(boxX, badgeY2, labelW + badgePad * 2, badgeH, 4);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, boxX + badgePad, badgeY2 + 14);
        } else {
          ctx.strokeStyle = isImage ? 'rgba(59,130,246,0.4)' : 'rgba(34,197,94,0.3)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(boxX, boxY, boxW, boxH);
          ctx.setLineDash([]);
        }
      }

      ctx.restore();
    }

    // ── Table cell overlays (auto-detected grids) disabled for cleaner UI ──

    // ── AcroForm field overlays (Select + Text tools) ──
    if ((activeTool === 'select' || activeTool === 'text') && formFields.length > 0 && renderResult && !editingLine) {
      ctx.save();
      ctx.scale(dpr, dpr);
      for (const field of formFields) {
        const r = field.rect;
        if (!r) continue;
        const topLeft = pdfToCanvas(
          r.x, r.y + r.height,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const bottomRight = pdfToCanvas(
          r.x + r.width, r.y,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const boxX = topLeft.cssX;
        const boxY = topLeft.cssY;
        const boxW = bottomRight.cssX - topLeft.cssX;
        const boxH = bottomRight.cssY - topLeft.cssY;
        const selected = selectedFormField?.ref.toKey() === field.ref.toKey();
        ctx.strokeStyle = selected ? '#f59e0b' : 'rgba(245,158,11,0.45)';
        ctx.lineWidth = selected ? 2 : 1;
        ctx.setLineDash(selected ? [] : [4, 3]);
        ctx.fillStyle = selected ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.04)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.setLineDash([]);
        if (selected || boxH > 14) {
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#f59e0b';
          const label = field.fieldName || field.fieldType;
          ctx.fillText(label, boxX + 3, boxY + 11);
        }
      }
      ctx.restore();
    }

    // ── Link annotation overlays (only after "Scan for links") ──
    if (
      linksHighlighted
      && (activeTool === 'text' || activeTool === 'select' || activeTool === 'addtext')
      && pageLinks.length > 0
      && !editingLine
    ) {
      ctx.save();
      ctx.scale(dpr, dpr);
      for (const link of pageLinks) {
        const topLeft = pdfToCanvas(
          link.rect.x, link.rect.y + link.rect.height,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const bottomRight = pdfToCanvas(
          link.rect.x + link.rect.width, link.rect.y,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const bx = Math.min(topLeft.cssX, bottomRight.cssX);
        const by = Math.min(topLeft.cssY, bottomRight.cssY);
        const bw = Math.abs(bottomRight.cssX - topLeft.cssX);
        const bh = Math.abs(bottomRight.cssY - topLeft.cssY);
        const active = selectedLink?.ref.toKey() === link.ref.toKey();
        ctx.strokeStyle = active ? '#52525b' : 'rgba(37, 99, 235, 0.85)';
        ctx.lineWidth = active ? 2 : 1;
        ctx.setLineDash(active ? [] : [4, 3]);
        ctx.fillStyle = active ? 'rgba(63, 63, 70, 0.28)' : 'rgba(37, 99, 235, 0.06)';
        // Rounded highlight for the active/hovered link
        const r = Math.min(6, bw / 2, bh / 2);
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
        ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
        ctx.arcTo(bx, by + bh, bx, by, r);
        ctx.arcTo(bx, by, bx + bw, by, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // ── Freehand drawing paths ──
    if (drawnPaths.length > 0) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.lineJoin = 'round';
      for (const path of drawnPaths) {
        if (path.points.length < 2) continue;

        ctx.beginPath();
        if (path.type === 'highlight') {
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.35;
          ctx.lineCap = 'butt';
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
          ctx.lineCap = 'round';
        }

        ctx.strokeStyle = path.color;
        ctx.lineWidth = path.size;

        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [editingLine, editText, caretPos, renderResult, doc, currentPage, scale, drawnPaths, activeTool, displayItems, selectedDisplayItem, formFields, selectedFormField, editOffsetCss, editManualSize, editStyleOverrides, editSel, textFontSize, pageLinks, selectedLink, linksHighlighted, detectedTables, activeTableId]);

  // Re-draw overlay whenever edit state changes
  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  // ── Caret blink timer ──
  useEffect(() => {
    if (editingLine) {
      caretVisibleRef.current = true;
      caretTimerRef.current = setInterval(() => {
        caretVisibleRef.current = !caretVisibleRef.current;
        drawOverlay();
      }, 530);
      return () => {
        if (caretTimerRef.current) clearInterval(caretTimerRef.current);
      };
    } else {
      caretVisibleRef.current = false;
      if (caretTimerRef.current) clearInterval(caretTimerRef.current);
    }
  }, [editingLine, drawOverlay]);

  // ── Focus hidden input when entering edit mode (don't collapse selection on caret moves)
  useEffect(() => {
    if (editingLine && hiddenInputRef.current) {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      hiddenInputRef.current.focus({ preventScroll: true });
      const pos = caretPos;
      const sel = editSelRef.current;
      if (sel.end > sel.start) {
        hiddenInputRef.current.setSelectionRange(sel.start, sel.end);
      } else {
        hiddenInputRef.current.setSelectionRange(pos, pos);
      }
    }
    // Only re-focus when the edit session starts, not on every caret tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingLine]);

  // ── Begin an edit session with frozen line anchor + undo snapshot ──
  const beginEditSession = useCallback((line: TextLine, caretAt?: number) => {
    initialRunTextRef.current = line.text;
    editAnchorLineRef.current = {
      ...line,
      runs: line.runs.map(r => ({
        ...r,
        glyphs: r.glyphs.map(g => ({ ...g, tRm: { ...g.tRm } })),
        sourceInstructionIndices: r.sourceInstructionIndices
          ? [...r.sourceInstructionIndices]
          : undefined,
      })),
      segments: line.segments.map(s => ({ ...s, run: s.run })),
    };
    editingBlockIdRef.current = line.id;
    pendingStylesRef.current = [];
    typingStyleRef.current = {};
    setEditStyleOverrides([]);
    setEditOffsetCss({ x: 0, y: 0 });
    setEditManualSize({ w: null, h: null });
    setSelectedDisplayItem(null);
    setActiveTool('text');
    setSelectedLine(line);
    setEditingLine(line);
    // Highlight parent table when editing a cell
    {
      let tableId: string | null = null;
      for (const table of detectedTables) {
        if (table.cells.some(c => c.line.id === line.id || c.line.text === line.text && Math.abs(c.line.baseline - line.baseline) < 2)) {
          tableId = table.id;
          break;
        }
      }
      setActiveTableId(tableId);
    }
    setEditText(line.text);
    editTextRef.current = line.text;
    const caret = caretAt ?? line.text.length;
    setCaretPos(caret);
    editSelRef.current = { start: caret, end: caret };
    setEditSel({ start: caret, end: caret });

    // Sync sidebar styles from the run under the caret (not always runs[0])
    {
      const seg = segmentAtIndex(line, caret) ?? (line.segments[0] ?? null);
      const run = seg?.run ?? line.runs[0];
      if (run) {
        setTextFontSize(visualFontSize(run));
        const fontData = renderResult?.fonts.get(run.fontName);
        setTextFontFamily(getDisplayFontFamily(run.fontName, fontData));
        const flags = resolveRunStyleFlags(run.fontName, fontData);
        setTextBold(flags.bold);
        setTextItalic(flags.italic);
        setTextUnderline(!!run.isUnderline || runHasPathUnderline(run, strokePaths));
        if (run.fillColor) {
          const [r, g, b] = run.fillColor;
          const hex = '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
          setTextColor(hex);
        }
      }
    }

    if (doc && engineRef.current) {
      const page = doc.pages[currentPage];
      const contentBytes = engineRef.current.getPageContentBytes(page, doc.objects);
      undoSnapshotRef.current = {
        pageIndex: currentPage,
        contentBytes: new Uint8Array(contentBytes),
      };
    }
  }, [doc, currentPage, setEditingLine, renderResult, strokePaths, detectedTables]);

  // ── Text edit submit — surgical in-place line edit (preserve positions) ──
  const handleEditSubmit = useCallback(async (closeEdit: boolean = true) => {
    if (!editingLine || !doc || !engineRef.current) return;
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }

    const textChanged = editText !== initialRunTextRef.current;
    const pdfDx = editOffsetCss.x / scale;
    const pdfDy = -editOffsetCss.y / scale; // CSS down is PDF down in screen, PDF y up
    const moved = Math.abs(pdfDx) > 0.5 || Math.abs(pdfDy) > 0.5;
    const pendingStyles = pendingStylesRef.current;
    const hasPendingStyles = pendingStyles.length > 0;

    if (!textChanged && !moved && !hasPendingStyles) {
      editAnchorLineRef.current = null;
      undoSnapshotRef.current = null;
      editingBlockIdRef.current = null;
      pendingStylesRef.current = [];
      typingStyleRef.current = {};
      setEditStyleOverrides([]);
      setEditOffsetCss({ x: 0, y: 0 });
      setEditManualSize({ w: null, h: null });
      if (closeEdit) {
        setEditingLine(null);
        setSelectedLine(null);
      }
      return;
    }

    try {
      setIsSaving(true);
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      const targetLine = editAnchorLineRef.current ?? editingLine;
      const snapshot = undoSnapshotRef.current;
      let bytes = snapshot?.pageIndex === currentPage
        ? new Uint8Array(snapshot.contentBytes)
        : engine.getPageContentBytes(page, doc.objects);

      if (textChanged) {
        const commitText = editTextRef.current || editText;
        const editResult = engine.applyLineTextEdit(
          bytes,
          page,
          doc.objects,
          targetLine,
          commitText,
          renderResult?.documentFlow,
          {
            oldText: initialRunTextRef.current || targetLine.text,
            caretAfter: editSelRef.current.end,
          },
        );

        if (editResult.needsFontAugmentation) {
          try {
            const missing = String.fromCharCode(
              ...editResult.missingCharCodes.filter(c => c < 0x10000),
            );
            engine.augmentFontsForMissingGlyphs(doc, currentPage, missing);
          } catch (augErr) {
            console.warn('[Editor] Font augmentation failed:', augErr);
          }
        }
        bytes = editResult.newContentBytes;
      }

      if (moved) {
        const shifts = targetLine.runs.map(run => ({ run, dx: pdfDx, dy: pdfDy }));
        bytes = engine.applyRunPositionShifts(bytes, shifts);
      }

      await engine.updatePageContent(page.contentRefs, bytes, doc.objects);

      if (hasPendingStyles) {
        const commitText = editTextRef.current || editText;
        // Merge adjacent identical patches so we don't split the same run repeatedly
        const raw = [...pendingStyles]
          .filter(p => p.end > p.start)
          .sort((a, b) => a.start - b.start || a.end - b.end);
        const queued: typeof raw = [];
        for (const item of raw) {
          const prev = queued[queued.length - 1];
          const samePatch = prev && JSON.stringify(prev.patch) === JSON.stringify(item.patch);
          if (samePatch && prev.end >= item.start) {
            prev.end = Math.max(prev.end, item.end);
          } else {
            queued.push({ ...item, patch: { ...item.patch } });
          }
        }
        pendingStylesRef.current = [];
        // Re-interpret so selection ranges map onto the updated line text/runs
        let styleLine: TextLine = targetLine;
        try {
          const freshBytes = engine.getPageContentBytes(page, doc.objects);
          const interpreted = engine.interpretPage(freshBytes, page, doc.objects);
          const flow = engine.buildDocumentFlow(interpreted.textRuns);
          styleLine =
            flow.lines.find((l: TextLine) => l.text === commitText) ??
            findMatchingFlowLine(targetLine, flow.lines) ??
            targetLine;
        } catch (reErr) {
          console.warn('[Editor] Re-interpret for styles failed:', reErr);
        }
        for (const item of queued) {
          const style: Record<string, unknown> = {};
          if (item.patch.fontSize != null) style.fontSize = item.patch.fontSize;
          if (item.patch.fontFamily != null) style.fontFamily = item.patch.fontFamily;
          if (item.patch.color != null) style.color = hexToRGB(item.patch.color);
          if (item.patch.bold != null) style.bold = item.patch.bold;
          if (item.patch.italic != null) style.italic = item.patch.italic;
          if (item.patch.underline != null) style.underline = item.patch.underline;
          if (item.patch.align != null) style.align = item.patch.align;
          if (Object.keys(style).length === 0) continue;
          // Clamp to the committed line length
          const start = Math.max(0, Math.min(item.start, styleLine.text.length));
          const end = Math.max(start, Math.min(item.end, styleLine.text.length));
          if (end <= start) continue;
          await engine.applyStyleToSelectionOnPage(
            doc,
            currentPage,
            styleLine,
            start,
            end,
            style,
          );
        }
      }

      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(
          engine.getPageContentBytes(page, doc.objects),
        ),
        label: 'text-edit',
        timestamp: Date.now(),
      });
      syncTxState();
      editAnchorLineRef.current = null;
      undoSnapshotRef.current = null;
      editingBlockIdRef.current = null;
      pendingStylesRef.current = [];
      typingStyleRef.current = {};
      setEditStyleOverrides([]);
      setEditOffsetCss({ x: 0, y: 0 });
      setEditManualSize({ w: null, h: null });
      setIsDirty(true);
      if (closeEdit) {
        setEditingLine(null);
        setSelectedLine(null);
      }
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Edit failed:', e);
      setError(`Edit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [editingLine, editText, editOffsetCss, scale, doc, currentPage, setEditingLine, renderResult, syncTxState, applyStyle]);

  // ── Edit cancel — discard overlay only; PDF untouched until commit ──
  const handleEditCancel = useCallback(async () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    editAnchorLineRef.current = null;
    undoSnapshotRef.current = null;
    editingBlockIdRef.current = null;
    pendingStylesRef.current = [];
    typingStyleRef.current = {};
    setEditStyleOverrides([]);
    setEditOffsetCss({ x: 0, y: 0 });
    setEditManualSize({ w: null, h: null });
    setEditingLine(null);
    setSelectedLine(null);
    setEditText('');
    setCaretPos(0);
  }, [setEditingLine]);

  // ── Undo ──
  const handleUndo = useCallback(async () => {
    const sigPeek = signatureHistoryRef.current.peek();
    const pdfPeek = txStackRef.current.peek();
    const preferSig =
      signatureHistoryRef.current.canUndo() &&
      (!pdfPeek || !txStackRef.current.canUndo() ||
        (sigPeek != null && pdfPeek != null && sigPeek.timestamp >= pdfPeek.timestamp));

    if (preferSig) {
      const next = signatureHistoryRef.current.undo();
      if (next) {
        setSignatures(next);
        setSelectedSignatureId(null);
        syncTxState();
        return;
      }
    }

    if (!doc || !engineRef.current) return;
    const entry = txStackRef.current.undo();
    if (!entry) return;
    try {
      const engine = engineRef.current;
      const page = doc.pages[entry.pageIndex];
      await engine.updatePageContent(page.contentRefs, entry.contentBytes, doc.objects);
      undoSnapshotRef.current = null;
      setEditingLine(null);
      setSelectedLine(null);
      setEditText('');
      setCaretPos(0);
      if (entry.pageIndex !== currentPage) setCurrentPage(entry.pageIndex);
      syncTxState();
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Undo failed:', e);
    }
  }, [doc, currentPage, setEditingLine, syncTxState]);

  const handleRedo = useCallback(async () => {
    if (signatureHistoryRef.current.canRedo() && (activeTool === 'sign' || selectedSignatureId || !txStackRef.current.canRedo())) {
      const next = signatureHistoryRef.current.redo();
      if (next) {
        setSignatures(next);
        syncTxState();
        return;
      }
    }

    if (!doc || !engineRef.current) return;
    const entry = txStackRef.current.redo();
    if (!entry) {
      // Fallback: signature redo
      const next = signatureHistoryRef.current.redo();
      if (next) {
        setSignatures(next);
        syncTxState();
      }
      return;
    }
    try {
      const engine = engineRef.current;
      const page = doc.pages[entry.pageIndex];
      await engine.updatePageContent(page.contentRefs, entry.contentBytes, doc.objects);
      undoSnapshotRef.current = null;
      setEditingLine(null);
      setSelectedLine(null);
      setEditText('');
      setCaretPos(0);
      if (entry.pageIndex !== currentPage) setCurrentPage(entry.pageIndex);
      syncTxState();
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Redo failed:', e);
    }
  }, [doc, currentPage, setEditingLine, syncTxState, activeTool, selectedSignatureId]);

  const handleFormFieldSelect = useCallback((field: AcroFormWidget) => {
    setSelectedFormField(field);
    setFormFieldDraft(typeof field.value === 'string' ? field.value : '');
    setActiveTool('select');
  }, []);

  /** Place active library signature into a PDF /FT Sig field (writes /AP). */
  const placeLibrarySignatureIntoField = useCallback(async (field: SignatureField) => {
    if (!doc) return;
    const lib = getSignatureLibrary();
    let entry = activeLibraryId ? lib.get(activeLibraryId) : null;
    if (!entry) {
      const list = lib.list();
      entry = list.find((e) => e.favorite) ?? list[0] ?? null;
    }
    if (!entry) {
      setSignatureCreateOpen(true);
      return;
    }
    try {
      await applySignatureFieldAppearanceAsync(doc, field.ref, {
        width: field.rect.width,
        height: field.rect.height,
        imageDataUrl: entry.imageDataUrl,
        typedName: entry.typedText || entry.name,
        date: new Date().toLocaleDateString(),
        backgroundColor: [1, 1, 1],
        borderWidth: 1,
        borderColor: [0.2, 0.25, 0.35],
      });
      // Also keep a visual overlay aligned to the field for immediate feedback
      const overlay = createVisualSignature({
        pageIndex: field.pageIndex,
        x: field.rect.x + field.rect.width / 2,
        y: field.rect.y + field.rect.height / 2,
        appearanceId: entry.id,
        appearanceType:
          entry.source === 'draw' ? 'drawn' : entry.source === 'typed' ? 'typed' : 'uploaded',
        width: field.rect.width,
        height: field.rect.height,
      });
      const withoutOverlapping = signaturesRef.current.filter(
        (s) =>
          !(
            s.pageIndex === field.pageIndex &&
            Math.abs(s.x - overlay.x) < 2 &&
            Math.abs(s.y - overlay.y) < 2
          ),
      );
      pushSignatureSnapshot([...withoutOverlapping, overlay], 'place-in-field');
      setPdfSignatureFields(detectSignatureFieldsOnPage(doc, currentPage));
      setSelectedPdfSigFieldId(field.id);
      setActiveLibraryId(entry.id);
      setIsDirty(true);
      setRenderKey((k) => k + 1);
    } catch (err) {
      console.error('[Editor] Place signature in field failed:', err);
      setError(`Place signature failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [doc, activeLibraryId, currentPage, pushSignatureSnapshot]);

  const refreshCertificateIdentities = useCallback(() => {
    const mgr = getCertificateManager();
    setCertificateIdentities(mgr.list());
    setSelectedCertificateId(mgr.getSelected()?.id ?? null);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(refreshCertificateIdentities, 80);
    return () => window.clearTimeout(t);
  }, [refreshCertificateIdentities]);

  const handleSelectCertificate = useCallback((id: string | null) => {
    getCertificateManager().select(id);
    setSelectedCertificateId(id);
  }, []);

  const handleCryptographicSign = useCallback(async () => {
    if (!doc || !selectedPdfSigFieldId) {
      setError('Select a PDF signature field first.');
      return;
    }
    const field = pdfSignatureFields.find((f) => f.id === selectedPdfSigFieldId);
    if (!field) {
      setError('Signature field not found.');
      return;
    }
    if (field.signed) {
      setError('This field is already signed.');
      return;
    }
    const mgr = getCertificateManager();
    if (selectedCertificateId) mgr.select(selectedCertificateId);
    const keyMat = mgr.getSelectedKey();
    const identity = mgr.getSelected();
    if (!keyMat?.privateKey) {
      setCertificateImportOpen(true);
      setError('Import a certificate with a private key to digitally sign.');
      return;
    }
    setCryptoSignBusy(true);
    setError(null);
    try {
      const leafDer = mgr.getSelectedLeafDer() ?? undefined;
      const result = await signDocumentCryptographic(doc, field.ref, keyMat.privateKey, {
        reason: 'Document approval',
        name: identity?.leaf?.subject.commonName ?? identity?.label ?? 'Signer',
        hashAlgorithm: 'sha256',
        contentsSize: 8192,
        certificateDer: leafDer ?? undefined,
        appearanceText: identity?.leaf?.subject.commonName ?? identity?.label ?? 'Signed',
        enableTimestamp,
      });
      doc.rawBytes = result.bytes;
      setPdfSignatureFields(detectSignatureFieldsOnPage(doc, currentPage));
      pushSignatureSnapshot(
        lockSignaturesAfterSigning(signaturesRef.current, field.pageIndex),
        'lock-after-sign',
      );
      if (activeLibraryId) pushRecentSignatureId(activeLibraryId);
      setManagedSignatures(listManagedSignatures(doc));
      setRevisionEntries(buildRevisionViewer(doc).revisions);
      setLtvStatus(getLtvStatus(doc));
      setIsDirty(true);
      setRenderKey((k) => k + 1);
      if (result.timestampError) {
        console.warn('[Editor] Timestamp fallback:', result.timestampError);
      }
    } catch (err) {
      console.error('[Editor] Cryptographic sign failed:', err);
      setError(`Digital sign failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCryptoSignBusy(false);
    }
  }, [doc, selectedPdfSigFieldId, pdfSignatureFields, selectedCertificateId, currentPage, enableTimestamp, pushSignatureSnapshot, activeLibraryId]);

  const refreshMultiSigPanel = useCallback(() => {
    if (!doc) {
      setManagedSignatures([]);
      setRevisionEntries([]);
      setLtvStatus(null);
      return;
    }
    setManagedSignatures(listManagedSignatures(doc));
    setRevisionEntries(buildRevisionViewer(doc).revisions);
    setLtvStatus(getLtvStatus(doc));
  }, [doc]);

  useEffect(() => {
    refreshMultiSigPanel();
  }, [refreshMultiSigPanel, pdfSignatureFields]);

  const handleValidateSignatures = useCallback(async () => {
    if (!doc) return;
    setValidationBusy(true);
    try {
      const report = await validateDocumentSignatures(doc, { allowSelfSigned: true });
      setValidationReport(report);
      refreshMultiSigPanel();
    } catch (err) {
      setError(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setValidationBusy(false);
    }
  }, [doc, refreshMultiSigPanel]);

  const handleEnableLtv = useCallback(() => {
    if (!doc) return;
    try {
      enableLongTermValidation(doc);
      setLtvStatus(getLtvStatus(doc));
      setIsDirty(true);
      refreshMultiSigPanel();
    } catch (err) {
      setError(`LTV failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [doc, refreshMultiSigPanel]);

  const handleFormFieldChange = useCallback((value: string) => {
    setFormFieldDraft(value);
    if (!doc || !selectedFormField || !engineRef.current) return;
    const engine = engineRef.current;
    if (selectedFormField.fieldType === 'Btn') {
      const checked = value === 'true' || value === 'Yes' || value === 'On';
      engine.setButtonFieldValue(doc, selectedFormField, checked);
      setFormFields(prev => prev.map(f =>
        f.ref.toKey() === selectedFormField.ref.toKey() ? { ...f, value: checked } : f,
      ));
    } else if (selectedFormField.fieldType === 'Ch') {
      engine.setChoiceFieldValue(doc, selectedFormField, value);
      setFormFields(prev => prev.map(f =>
        f.ref.toKey() === selectedFormField.ref.toKey() ? { ...f, value } : f,
      ));
    } else {
      engine.setFormFieldValue(doc, selectedFormField, value);
      setFormFields(prev => prev.map(f =>
        f.ref.toKey() === selectedFormField.ref.toKey() ? { ...f, value } : f,
      ));
    }
    setIsDirty(true);
  }, [doc, selectedFormField]);

  const handleFindReplace = useCallback(async (find: string, replace: string) => {
    if (!doc || !engineRef.current) return 0;
    const engine = engineRef.current;
    const page = doc.pages[currentPage];
    const bytes = engine.getPageContentBytes(page, doc.objects);
    const result = engine.findAndReplace(bytes, page, doc.objects, find, replace);
    await engine.updatePageContent(page.contentRefs, result.newContentBytes, doc.objects);
    setIsDirty(true);
    setRenderKey(k => k + 1);
    return result.missingCharCodes ? 1 : 1; // at least signal work done
  }, [doc, currentPage]);

  const handleRecognizeText = useCallback(async () => {
    if (!doc || !engineRef.current || !pdfCanvasRef.current) return;
    try {
      setIsSaving(true);
      setError(null);
      const { createDefaultOcrAdapter, canvasToImageData, mapOcrWordsToPdf } = await import('@/lib/ocr/adapter');
      const adapter = createDefaultOcrAdapter();
      const canvas = pdfCanvasRef.current;
      const imageData = canvasToImageData(canvas);
      const words = await adapter.recognize(imageData);
      const page = doc.pages[currentPage];
      const dpr = window.devicePixelRatio || 1;
      const mapped = mapOcrWordsToPdf(words, page.mediaBox.height, scale, page.mediaBox.y, dpr);
      if (mapped.length > 0) {
        await engineRef.current.insertInvisibleTextLayer(doc, currentPage, mapped);
        setIsDirty(true);
        setRenderKey(k => k + 1);
        setError(null);
        // Brief success via status — reuse error toast style as info
        console.log(`[OCR] Inserted ${mapped.length} words as invisible text`);
      } else {
        setError('OCR found no text on this page. Try a clearer scan or higher zoom.');
      }
    } catch (e) {
      setError(`OCR failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, currentPage, scale]);

  const handleFlattenForms = useCallback(async () => {
    if (!doc || !engineRef.current || formFields.length === 0) return;
    try {
      setIsSaving(true);
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      await engine.flattenFormFieldsOnPage(doc, currentPage, formFields);
      const afterBytes = engine.getPageContentBytes(page, doc.objects);
      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(afterBytes),
        label: 'flatten-forms',
        timestamp: Date.now(),
      });
      syncTxState();
      setFormFields([]);
      setSelectedFormField(null);
      setFormFieldDraft('');
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Flatten forms failed:', e);
      setError(`Flatten failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, currentPage, formFields, syncTxState]);

  const handleDuplicateLineBelow = useCallback(async () => {
    const line = editAnchorLineRef.current ?? selectedLine ?? editingLine;
    if (!doc || !engineRef.current || !line) return;
    try {
      if (editingLine) await handleEditSubmit(false);
      setIsSaving(true);
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      const bytes = engine.getPageContentBytes(page, doc.objects);
      const next = engine.duplicateLineBelow(bytes, line);
      await engine.updatePageContent(page.contentRefs, next, doc.objects);
      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(engine.getPageContentBytes(page, doc.objects)),
        label: 'duplicate-line',
        timestamp: Date.now(),
      });
      syncTxState();
      setIsDirty(true);
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Duplicate line failed:', e);
      setError(`Duplicate line failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, currentPage, selectedLine, editingLine, handleEditSubmit, syncTxState]);

  // Resolve table cell for the current selection (for sidebar actions)
  const selectedTableCell = (() => {
    const line = selectedLine ?? editingLine;
    if (!line) return null;
    for (const table of detectedTables) {
      for (const cell of table.cells) {
        if (
          Math.abs(cell.line.baseline - line.baseline) < 3 &&
          Math.abs(cell.line.x - line.x) < 8
        ) {
          return { table, cell };
        }
      }
    }
    return null;
  })();

  const handleAddTableRow = useCallback(async () => {
    if (!doc || !engineRef.current || !selectedTableCell) return;
    try {
      if (editingLine) await handleEditSubmit(false);
      setIsSaving(true);
      const { table, cell } = selectedTableCell;
      const rowLines = engineRef.current.getTableRowLines(table, cell.row);
      const page = doc.pages[currentPage];
      const bytes = engineRef.current.getPageContentBytes(page, doc.objects);
      const next = engineRef.current.duplicateTableRowBelow(bytes, rowLines);
      await engineRef.current.updatePageContent(page.contentRefs, next, doc.objects);
      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(engineRef.current.getPageContentBytes(page, doc.objects)),
        label: 'table-add-row',
        timestamp: Date.now(),
      });
      syncTxState();
      setIsDirty(true);
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Add table row failed:', e);
      setError(`Add row failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, currentPage, selectedTableCell, editingLine, handleEditSubmit, syncTxState]);

  const handleAddTableColumn = useCallback(async () => {
    if (!doc || !engineRef.current || !selectedTableCell) return;
    try {
      if (editingLine) await handleEditSubmit(false);
      setIsSaving(true);
      const { table } = selectedTableCell;
      const rows: TextLine[][] = [];
      for (let r = 0; r < table.rows; r++) {
        rows.push(engineRef.current.getTableRowLines(table, r));
      }
      const page = doc.pages[currentPage];
      const bytes = engineRef.current.getPageContentBytes(page, doc.objects);
      const next = engineRef.current.insertTableColumnRight(bytes, rows);
      await engineRef.current.updatePageContent(page.contentRefs, next, doc.objects);
      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(engineRef.current.getPageContentBytes(page, doc.objects)),
        label: 'table-add-column',
        timestamp: Date.now(),
      });
      syncTxState();
      setIsDirty(true);
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Add table column failed:', e);
      setError(`Add column failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, currentPage, selectedTableCell, editingLine, handleEditSubmit, syncTxState]);

  // ── Global keyboard shortcuts for undo/redo ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  const resolveLinkDisplay = useCallback((link: import('@/engine').PageLinkInfo) => {
    const lines = renderResult?.textLines ?? [];
    if (!lines.length) return { text: '', line: null as TextLine | null, start: 0, end: 0 };
    const cx = link.rect.x + link.rect.width / 2;
    const cy = link.rect.y + link.rect.height / 2;
    const line = hitTestTextLine(cx, cy, lines) || findNearestTextLine(cx, cy, lines, 24);
    if (!line) return { text: '', line: null, start: 0, end: 0 };
    const start = caretIndexFromLineX(link.rect.x, line);
    const end = Math.max(start, caretIndexFromLineX(link.rect.x + link.rect.width, line));
    return { text: line.text.slice(start, end), line, start, end };
  }, [renderResult]);

  // ── Canvas click handler — caret-based, no boxes ──
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!renderResult || !doc) return;
    const wrapper = canvasContainerRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const page = doc.pages[currentPage];
    const { mediaBox } = page;
    const { pdfX, pdfY } = canvasToPdf(
      cssX, cssY, scale,
      renderResult.pageWidth, renderResult.pageHeight,
      mediaBox.x, mediaBox.y,
    );

    if (activeTool === 'text' || activeTool === 'select') {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }

      // Signature hit-test (above page contents)
      {
        const sigHit = hitTestSignature(signaturesRef.current, currentPage, pdfX, pdfY);
        if (sigHit) {
          if (editingLine) void handleEditSubmit(false);
          setSelectedSignatureId(sigHit.id);
          setSelectedDisplayItem(null);
          setSelectedLine(null);
          setActiveTool('sign');
          return;
        }
      }

      // Click a form field box → select it for editing
      if (formFields.length > 0 && engineRef.current) {
        const formHit = engineRef.current.hitTestFormField(formFields, pdfX, pdfY);
        if (formHit) {
          if (editingLine) void handleEditSubmit(false);
          handleFormFieldSelect(formHit);
          return;
        }
      }

      // Ctrl/Cmd+click opens an existing link (Acrobat-like)
      if ((e.ctrlKey || e.metaKey) && engineRef.current) {
        const linkHit = engineRef.current.hitTestPageLink(doc, currentPage, pdfX, pdfY);
        if (linkHit?.url) {
          window.open(linkHit.url, '_blank', 'noopener,noreferrer');
          return;
        }
      }

      // Click a highlighted link → open hover/edit popover on the PDF
      if (linksHighlighted && engineRef.current) {
        const linkHit = engineRef.current.hitTestPageLink(doc, currentPage, pdfX, pdfY);
        if (linkHit) {
          if (editingLine) void handleEditSubmit(false);
          setSelectedLine(null);
          setSelectedDisplayItem(null);
          setLinkCreatePending(false);
          setSelectedLink(linkHit);
          setLinkDraftUrl(linkHit.url || '');
          setLinkDisplayDraft(resolveLinkDisplay(linkHit).text);
          setLinkPopoverMode('hover');
          return;
        }
        // Click outside any link while a popover is open → dismiss it
        if (linkPopoverMode) {
          setLinkPopoverMode(null);
          setSelectedLink(null);
          setLinkDraftUrl('');
          setLinkDisplayDraft('');
        }
      }

      // Prefer real flow lines (sourceInstructionIndices) — never edit synthetic Bloom lines
      const startEditOnLine = (line: TextLine, newCaret: number) => {
        const flowLine = findMatchingFlowLine(line, renderResult.textLines) ?? line;
        const caret = Math.min(newCaret, flowLine.text.length);
        if (editingLine?.id === flowLine.id) {
          setCaretPos(caret);
          editSelRef.current = { start: caret, end: caret };
          setEditSel({ start: caret, end: caret });
          caretVisibleRef.current = true;
          setTimeout(() => {
            if (hiddenInputRef.current) {
              hiddenInputRef.current.focus({ preventScroll: true });
              hiddenInputRef.current.setSelectionRange(caret, caret);
            }
          }, 0);
          return;
        }
        const startNew = () => {
          beginEditSession(flowLine, caret);
          setTimeout(() => {
            if (hiddenInputRef.current) {
              hiddenInputRef.current.focus({ preventScroll: true });
              hiddenInputRef.current.setSelectionRange(caret, caret);
            }
          }, 0);
        };
        if (editingLine) {
          void handleEditSubmit(false).then(startNew);
        } else {
          startNew();
        }
      };

      const hit = hitTestTextLine(pdfX, pdfY, renderResult.textLines);
      if (hit) {
        startEditOnLine(hit, caretIndexFromLineX(pdfX, hit));
        return;
      }

      const nearHit = findNearestTextLine(pdfX, pdfY, renderResult.textLines, 12);
      if (nearHit) {
        startEditOnLine(nearHit, caretIndexFromLineX(pdfX, nearHit));
        return;
      }

      {
        const spatialHit = spatialIndexRef.current
          ? hitTestDisplayList(spatialIndexRef.current, pdfX, pdfY)
          : null;
        const itemHit = spatialHit && (spatialHit.data.type === 'image' || spatialHit.data.type === 'path')
          ? spatialHit.data as ImageItem | PathItem
          : null;
        if (itemHit) {
          if (editingLine) handleEditSubmit();
          setSelectedDisplayItem(itemHit);
          setSelectedLine(null);
          setEditingLine(null);
          setActiveTool('select');
          return;
        }
        setSelectedDisplayItem(null);
        if (editingLine) {
          handleEditSubmit();
        } else {
          setEditingLine(null);
          setSelectedLine(null);
        }
        setActiveFloatingTextId(null);
        setActiveFloatingImageId(null);
        setSelectedSignatureId(null);
      }
    } else if (activeTool === 'addtext') {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }

      if (!doc || !renderResult) return;
      const page = doc.pages[currentPage];

      const newBox: FloatingText = {
        id: Math.random().toString(36).substr(2, 9),
        pdfX,
        pdfY,
        text: 'New Text',
        fontSize: textFontSize,
        fontFamily: textFontFamily,
        color: textColor,
      };

      setFloatingTexts(prev => [...prev, newBox]);
      setActiveFloatingTextId(newBox.id);
      setActiveTool('text');

    } else if (activeTool === 'highlight') {
      // Freehand drag already created a stroke — don't also add a full-line PDF bar
      if (skipNextHighlightClickRef.current) {
        skipNextHighlightClickRef.current = false;
        return;
      }
      const hit = hitTestTextLine(pdfX, pdfY, renderResult.textLines);
      if (hit && hit.runs[0] && engineRef.current && doc) {
        setSelectedLine(hit);
        try {
          const [r, g, b] = hexToRGB(highlightColor);
          engineRef.current.addHighlightFromLineSelection(
            doc,
            currentPage,
            hit,
            0,
            hit.text.length,
            [r, g, b],
            'Highlight',
          );
          setIsDirty(true);
          setRenderKey(k => k + 1);
        } catch (err) {
          console.warn('[Editor] Highlight annotation failed:', err);
        }
      }
    } else if (activeTool === 'sign') {
      // Click existing PDF signature field → place library signature into /AP
      const pdfSigHit = hitTestSignatureField(pdfSignatureFields, pdfX, pdfY);
      if (pdfSigHit) {
        setSelectedPdfSigFieldId(pdfSigHit.id);
        setSelectedSignatureId(null);
        setSelectedDisplayItem(null);
        void placeLibrarySignatureIntoField(pdfSigHit);
        return;
      }

      // Select existing visual overlay signature
      const hit = hitTestSignature(signaturesRef.current, currentPage, pdfX, pdfY);
      if (hit) {
        setSelectedSignatureId(hit.id);
        setSelectedDisplayItem(null);
        setSelectedPdfSigFieldId(null);
        return;
      }

      // Create AcroForm signature field mode
      if (createFieldMode && doc) {
        try {
          const created = createSignatureFieldAtPoint(doc, currentPage, pdfX, pdfY, {
            withPlaceholderAppearance: true,
          });
          setPdfSignatureFields(detectSignatureFieldsOnPage(doc, currentPage));
          setSelectedPdfSigFieldId(created.id);
          setCreateFieldMode(false);
          setIsDirty(true);
          setRenderKey((k) => k + 1);
        } catch (err) {
          console.error('[Editor] Create signature field failed:', err);
          setError(`Create signature field failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }

      const lib = getSignatureLibrary();
      let entry = activeLibraryId ? lib.get(activeLibraryId) : null;
      if (!entry) {
        const list = lib.list();
        entry = list.find((e) => e.favorite) ?? list[0] ?? null;
      }
      if (!entry) {
        setSignatureCreateOpen(true);
        return;
      }

      const maxW = DEFAULT_SIGNATURE_SIZE.width;
      const scaleFit = Math.min(1, maxW / Math.max(entry.width, 1));
      const w = Math.max(40, entry.width * scaleFit);
      const h = Math.max(24, entry.height * scaleFit);
      const sig = createVisualSignature({
        pageIndex: currentPage,
        x: pdfX,
        y: pdfY,
        appearanceId: entry.id,
        appearanceType:
          entry.source === 'draw' ? 'drawn' : entry.source === 'typed' ? 'typed' : 'uploaded',
        width: w,
        height: h,
      });
      pushSignatureSnapshot([...signaturesRef.current, sig], 'add-signature');
      setSelectedSignatureId(sig.id);
      setActiveLibraryId(entry.id);
    }
  }, [renderResult, doc, currentPage, scale, activeTool, editingLine, handleEditSubmit, beginEditSession, displayItems, textFontSize, textColor, textFontFamily, highlightColor, formFields, handleFormFieldSelect, linksHighlighted, linkPopoverMode, resolveLinkDisplay, activeLibraryId, pushSignatureSnapshot, pdfSignatureFields, createFieldMode, placeLibrarySignatureIntoField]);

  // Double-click in select mode → enter text edit
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'select' && activeTool !== 'text') return;
    if (!renderResult || !doc) return;
    const wrapper = canvasContainerRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const page = doc.pages[currentPage];
    const { mediaBox } = page;
    const { pdfX, pdfY } = canvasToPdf(
      cssX, cssY, scale,
      renderResult.pageWidth, renderResult.pageHeight,
      mediaBox.x, mediaBox.y,
    );
    const hit =
      hitTestTextLine(pdfX, pdfY, renderResult.textLines) ??
      findNearestTextLine(pdfX, pdfY, renderResult.textLines, 16);
    if (hit) {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      const flowLine = findMatchingFlowLine(hit, renderResult.textLines) ?? hit;
      const newCaret = caretIndexFromLineX(pdfX, flowLine);
      if (editingLine && editingLine.id !== flowLine.id) {
        void handleEditSubmit(false).then(() => beginEditSession(flowLine, newCaret));
        return;
      }
      beginEditSession(flowLine, newCaret);
      setTimeout(() => {
        if (hiddenInputRef.current) {
          hiddenInputRef.current.focus({ preventScroll: true });
          hiddenInputRef.current.setSelectionRange(newCaret, newCaret);
        }
      }, 0);
    }
  }, [renderResult, doc, currentPage, scale, activeTool, editingLine, handleEditSubmit, beginEditSession]);

  const applyEraser = useCallback((x: number, y: number, opts?: { deferAnnotRender?: boolean }) => {
    const eraserRadius = eraserSize / 2;

    // 1) Erase ephemeral overlay strokes
    setDrawnPaths(prev => {
      let newPaths: DrawnPath[] = [];
      let modified = false;
      for (const path of prev) {
        let currentSubPath: { x: number, y: number }[] = [];
        for (const p of path.points) {
          const dx = p.x - x;
          const dy = p.y - y;
          if (Math.sqrt(dx * dx + dy * dy) > eraserRadius) {
            currentSubPath.push(p);
          } else {
            if (currentSubPath.length > 0) {
              newPaths.push({ ...path, id: Math.random().toString(36).substr(2, 9), points: currentSubPath });
              currentSubPath = [];
              modified = true;
            }
          }
        }
        if (currentSubPath.length > 0) {
          if (currentSubPath.length === path.points.length) {
            newPaths.push(path);
          } else {
            newPaths.push({ ...path, id: Math.random().toString(36).substr(2, 9), points: currentSubPath });
            modified = true;
          }
        }
      }
      return modified ? newPaths : prev;
    });

    // 2) Erase committed PDF Highlight / Ink annotations under the cursor
    if (doc && engineRef.current && renderResult) {
      const page = doc.pages[currentPage];
      const { mediaBox } = page;
      const { pdfX, pdfY } = canvasToPdf(
        x, y, scale,
        renderResult.pageWidth, renderResult.pageHeight,
        mediaBox.x, mediaBox.y,
      );
      const pdfRadius = eraserRadius / scale;
      const removed = engineRef.current.eraseAnnotationsAtPoint(
        page.dict,
        doc.objects,
        pdfX,
        pdfY,
        Math.max(pdfRadius, 4),
      );
      if (removed > 0 && !opts?.deferAnnotRender) {
        setIsDirty(true);
        setRenderKey(k => k + 1);
      }
      return removed;
    }
    return 0;
  }, [eraserSize, doc, currentPage, scale, renderResult]);

  /** Sample eraser along a segment so fast strokes don't skip marks. */
  const applyEraserStroke = useCallback((from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const eraserRadius = eraserSize / 2;
    const step = Math.max(2, eraserRadius * 0.35);
    let removed = 0;
    if (!from) {
      removed += applyEraser(to.x, to.y, { deferAnnotRender: true }) || 0;
      return removed;
    }
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(dist / step));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      removed += applyEraser(x, y, { deferAnnotRender: true }) || 0;
    }
    return removed;
  }, [applyEraser, eraserSize]);

  // ── Commit drawings, texts, and images to PDF ──
  const commitDrawingsToPdf = useCallback(async (pathsToCommit?: DrawnPath[], textsToCommit?: FloatingText[], imagesToCommit?: FloatingImage[]) => {
    const paths = pathsToCommit || drawnPaths;
    const fTexts = textsToCommit || floatingTexts;
    const fImages = imagesToCommit || floatingImages;
    if (!doc || !engineRef.current || (paths.length === 0 && fTexts.length === 0 && fImages.length === 0)) return;
    const engine = engineRef.current;
    const page = doc.pages[currentPage];
    let currentObjNum = engine.getNextObjNum(doc);

    const pageHeight = renderResult?.pageHeight || page.mediaBox.height;

    for (const p of paths) {
      if (p.points.length < 2) continue;

      const inkPathsPdf: number[][] = [[]];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      for (const pt of p.points) {
        const { pdfX, pdfY } = canvasToPdf(
          pt.x, pt.y, scale,
          renderResult?.pageWidth || page.mediaBox.width,
          pageHeight,
          page.mediaBox.x, page.mediaBox.y
        );
        inkPathsPdf[0].push(pdfX, pdfY);
        minX = Math.min(minX, pdfX);
        minY = Math.min(minY, pdfY);
        maxX = Math.max(maxX, pdfX);
        maxY = Math.max(maxY, pdfY);
      }

      const lw = p.size / scale;
      const rect = { x: minX - lw, y: minY - lw, width: (maxX - minX) + lw * 2, height: (maxY - minY) + lw * 2 };
      const rgb = hexToRGB(p.color);

      const annotation: import('@/engine').InkAnnotation = {
        type: 'Ink',
        rect,
        color: rgb,
        opacity: p.type === 'highlight' ? 0.4 : 1.0,
        inkPaths: inkPathsPdf,
        lineWidth: lw,
      };

      const { dict, appearanceStream } = engine.createAnnotationDict(annotation, currentObjNum++);
      if (appearanceStream) {
        doc.objects.set(`${currentObjNum}_0`, appearanceStream as import('@/engine').PDFObject);
        currentObjNum++;
      }

      const annotRef = new engine.PDFRef(currentObjNum, 0);
      engine.addAnnotationToPage(page.dict, dict, annotRef, doc.objects);
      currentObjNum++;
    }

    if (fTexts.length > 0 || fImages.length > 0) {
      let contentBytes = engine.getPageContentBytes(page, doc.objects);
      let newContentBytes: any = new Uint8Array(contentBytes);

      for (const ft of fTexts) {
        if (!ft.text.trim()) continue;
        const rgb = hexToRGB(ft.color);

        newContentBytes = engine.insertTextRun(
          newContentBytes, page, doc.objects,
          ft.text, ft.pdfX, ft.pdfY, ft.fontSize, rgb
        );
      }

      for (const fi of fImages) {
        const { newContentBytes: b } = await engine.insertImageRun(
          newContentBytes, page, doc.objects,
          fi.dataUrl, fi.pdfX, fi.pdfY, fi.pdfWidth, fi.pdfHeight,
          () => {
            const num = currentObjNum;
            currentObjNum++;
            return num;
          }
        );
        newContentBytes = b;
      }

      engine.updatePageContent(page.contentRefs, newContentBytes, doc.objects).catch((e: Error) => {
        console.error('[Editor] Failed to commit content:', e);
      });
    }

    setDrawnPaths([]);
    setFloatingTexts([]);
    setFloatingImages([]);
    setActiveFloatingTextId(null);
    setActiveFloatingImageId(null);
    setIsDirty(true);
    setRenderKey(k => k + 1);
  }, [doc, currentPage, drawnPaths, floatingTexts, floatingImages, scale, renderResult]);

  const handleDrawStart = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'draw' && activeTool !== 'highlight' && activeTool !== 'erase') return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    drawDraggedRef.current = false;

    if (activeTool === 'erase') {
      lastErasePosRef.current = { x, y };
      const removed = applyEraserStroke(null, { x, y });
      if (removed > 0) {
        setIsDirty(true);
        setRenderKey(k => k + 1);
      }
    } else {
      lastErasePosRef.current = null;
      currentDrawPath.current = [{ x, y }];
    }
  }, [activeTool, applyEraserStroke]);

  const handleDrawMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === 'erase') {
      const removed = applyEraserStroke(lastErasePosRef.current, { x, y });
      lastErasePosRef.current = { x, y };
      if (removed > 0) {
        setIsDirty(true);
        setRenderKey(k => k + 1);
      }
      return;
    }

    const path = currentDrawPath.current;
    if (path.length > 0) {
      const dx = x - path[0].x;
      const dy = y - path[0].y;
      if (Math.hypot(dx, dy) > 5) drawDraggedRef.current = true;
    }
    // Ignore tiny jitter so a click doesn't become a freehand highlight stroke
    if (!drawDraggedRef.current) return;

    currentDrawPath.current.push({ x, y });

    // Live draw on overlay
    const ctx = overlay.getContext('2d');
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      const pts = currentDrawPath.current;
      if (pts.length >= 2) {
        ctx.save();
        ctx.scale(dpr, dpr);
        if (activeTool === 'highlight') {
          ctx.strokeStyle = highlightColor;
          ctx.lineWidth = highlightSize;
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.35;
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'round';
        } else {
          ctx.strokeStyle = drawColor;
          ctx.lineWidth = drawSize;
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
        }
        ctx.beginPath();
        const prev = pts[pts.length - 2];
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [isDrawing, activeTool, drawColor, drawSize, highlightColor, highlightSize, applyEraserStroke]);

  const handleDrawEnd = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastErasePosRef.current = null;

    if (activeTool === 'erase') return;

    if (drawDraggedRef.current && currentDrawPath.current.length > 1) {
      // Drag produced a freehand stroke — suppress the trailing click annotation
      if (activeTool === 'highlight') {
        skipNextHighlightClickRef.current = true;
      }
      const newPath: DrawnPath = {
        id: Math.random().toString(36).substr(2, 9),
        type: activeTool as PathType,
        color: activeTool === 'draw' ? drawColor : highlightColor,
        size: activeTool === 'draw' ? drawSize : highlightSize,
        points: [...currentDrawPath.current]
      };

      setDrawnPaths(prev => [...prev, newPath]);
    }
    currentDrawPath.current = [];
    drawDraggedRef.current = false;
  }, [isDrawing, activeTool, drawColor, drawSize, highlightColor, highlightSize]);

  const openLinkHover = useCallback((link: import('@/engine').PageLinkInfo) => {
    if (linkHoverTimerRef.current) {
      clearTimeout(linkHoverTimerRef.current);
      linkHoverTimerRef.current = null;
    }
    // Already showing this link — don't reset state (avoids flicker / remount)
    if (
      selectedLink?.ref.toKey() === link.ref.toKey()
      && (linkPopoverMode === 'hover' || linkPopoverMode === 'edit')
    ) {
      return;
    }
    if (linkPopoverMode === 'edit') return;
    setSelectedLink(link);
    setLinkDraftUrl(link.url || '');
    setLinkDisplayDraft(resolveLinkDisplay(link).text);
    setLinkPopoverMode('hover');
  }, [linkPopoverMode, selectedLink, resolveLinkDisplay]);

  const scheduleLinkHoverClose = useCallback(() => {
    if (linkPopoverMode === 'edit') return;
    if (linkPopoverHoverRef.current) return;
    if (linkHoverTimerRef.current) clearTimeout(linkHoverTimerRef.current);
    linkHoverTimerRef.current = setTimeout(() => {
      linkHoverTimerRef.current = null;
      if (linkPopoverHoverRef.current) return;
      setLinkPopoverMode((mode) => {
        if (mode === 'hover') {
          setSelectedLink(null);
          return null;
        }
        return mode;
      });
    }, 700);
  }, [linkPopoverMode]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    handleDrawMove(e);
    if (!linksHighlighted || !doc || !engineRef.current || !renderResult || editingLine) return;
    if (linkPopoverMode === 'edit') return;
    if (['draw', 'highlight', 'erase'].includes(activeTool)) return;
    // Pointer is over the popover — keep it open
    if (linkPopoverHoverRef.current) return;

    const rect = canvasContainerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const page = doc.pages[currentPage];
    const { pdfX, pdfY } = canvasToPdf(
      cssX, cssY, scale,
      renderResult.pageWidth, renderResult.pageHeight,
      page.mediaBox.x, page.mediaBox.y,
    );
    const hit = engineRef.current.hitTestPageLink(doc, currentPage, pdfX, pdfY);
    if (hit) {
      openLinkHover(hit);
    } else if (linkPopoverMode === 'hover') {
      scheduleLinkHoverClose();
    }
  }, [
    handleDrawMove, linksHighlighted, doc, renderResult, editingLine,
    linkPopoverMode, activeTool, currentPage, scale, openLinkHover, scheduleLinkHoverClose,
  ]);

  const handleCanvasMouseLeave = useCallback((e: React.MouseEvent) => {
    handleDrawEnd();
    const next = e.relatedTarget as HTMLElement | null;
    if (next?.closest?.('[data-link-popover]')) return;
    if (linkPopoverMode === 'hover' && !linkPopoverHoverRef.current) {
      scheduleLinkHoverClose();
    }
  }, [handleDrawEnd, linkPopoverMode, scheduleLinkHoverClose]);

  const closeLinkPopover = useCallback(() => {
    if (linkHoverTimerRef.current) {
      clearTimeout(linkHoverTimerRef.current);
      linkHoverTimerRef.current = null;
    }
    setLinkPopoverMode(null);
    setSelectedLink(null);
    setLinkDraftUrl('');
    setLinkDisplayDraft('');
  }, []);

  const saveLinkFromPopover = useCallback(async (andClose = true) => {
    if (!doc || !engineRef.current || !selectedLink) {
      if (andClose) closeLinkPopover();
      return;
    }
    const url = linkDraftUrl.trim();
    if (!url || url === 'https://') {
      if (andClose) closeLinkPopover();
      return;
    }

    try {
      const display = resolveLinkDisplay(selectedLink);
      // Update display text in the PDF if the user changed it
      if (display.line && linkDisplayDraft !== display.text && display.end > display.start) {
        const line = display.line;
        const nextText =
          line.text.slice(0, display.start) + linkDisplayDraft + line.text.slice(display.end);
        const page = doc.pages[currentPage];
        const bytes = engineRef.current.getPageContentBytes(page, doc.objects);
        const editResult = engineRef.current.applyLineTextEdit(
          bytes, page, doc.objects, line, nextText, renderResult?.documentFlow,
        );
        await engineRef.current.updatePageContent(
          page.contentRefs, editResult.newContentBytes, doc.objects,
        );
      }

      if (url !== selectedLink.url) {
        engineRef.current.updatePageLinkUrl(doc, currentPage, selectedLink, url);
      }
      setIsDirty(true);
      setRenderKey(k => k + 1);
      if (andClose) closeLinkPopover();
    } catch (err) {
      console.warn('[Editor] Save link failed:', err);
    }
  }, [
    doc, selectedLink, linkDraftUrl, linkDisplayDraft, resolveLinkDisplay,
    currentPage, renderResult, closeLinkPopover,
  ]);

  const removeLinkFromPopover = useCallback(() => {
    if (!doc || !engineRef.current || !selectedLink) {
      closeLinkPopover();
      return;
    }
    try {
      engineRef.current.removePageLink(doc, currentPage, selectedLink.ref);
      setIsDirty(true);
      setRenderKey(k => k + 1);
      closeLinkPopover();
    } catch (err) {
      console.warn('[Editor] Remove link failed:', err);
    }
  }, [doc, selectedLink, currentPage, closeLinkPopover]);

  const handleFloatingTextPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setActiveFloatingTextId(id);
    setActiveFloatingImageId(null);
    const box = floatingTexts.find(b => b.id === id);
    if (!box) return;
    dragInfo.current = {
      id,
      type: 'text',
      startX: e.clientX,
      startY: e.clientY,
      startPdfX: box.pdfX,
      startPdfY: box.pdfY
    };

    const handleMove = (me: PointerEvent) => {
      if (!dragInfo.current || !doc || !renderResult) return;
      const dx = me.clientX - dragInfo.current.startX;
      const dy = me.clientY - dragInfo.current.startY;
      const pdfDx = dx / scale;
      const pdfDy = -dy / scale;

      const { startPdfX, startPdfY } = dragInfo.current;

      setFloatingTexts(prev => prev.map(p => p.id === id ? {
        ...p,
        pdfX: startPdfX + pdfDx,
        pdfY: startPdfY + pdfDy,
      } : p));
    };

    const handleUp = () => {
      dragInfo.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [floatingTexts, scale, doc, renderResult]);

  const handleFloatingImagePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setActiveFloatingImageId(id);
    setActiveFloatingTextId(null);
    const box = floatingImages.find(b => b.id === id);
    if (!box) return;
    dragInfo.current = {
      id,
      type: 'image',
      startX: e.clientX,
      startY: e.clientY,
      startPdfX: box.pdfX,
      startPdfY: box.pdfY
    };

    const handleMove = (me: PointerEvent) => {
      if (!dragInfo.current || !doc || !renderResult) return;
      const dx = me.clientX - dragInfo.current.startX;
      const dy = me.clientY - dragInfo.current.startY;
      const pdfDx = dx / scale;
      const pdfDy = -dy / scale;

      const { startPdfX, startPdfY } = dragInfo.current;

      setFloatingImages(prev => prev.map(p => p.id === id ? {
        ...p,
        pdfX: startPdfX + pdfDx,
        pdfY: startPdfY + pdfDy,
      } : p));
    };

    const handleUp = () => {
      dragInfo.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [floatingImages, scale, doc, renderResult]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const img = new window.Image();
      img.onload = async () => {
        // Always convert to JPEG — engine image XObjects use DCTDecode
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);

        // Replace embedded PDF image in-place (same cm / bbox)
        if (replacingEmbeddedImageRef.current && doc && engineRef.current) {
          const target = replacingEmbeddedImageRef.current;
          replacingEmbeddedImageRef.current = null;
          try {
            await engineRef.current.replaceImageXObject(doc, currentPage, target, jpegDataUrl);
            const page = doc.pages[currentPage];
            const nextBytes = engineRef.current.getPageContentBytes(page, doc.objects);
            txStackRef.current.push({
              pageIndex: currentPage,
              contentBytes: new Uint8Array(nextBytes),
              label: 'replace-image',
              timestamp: Date.now(),
            });
            syncTxState();
            setIsDirty(true);
            setSelectedDisplayItem(null);
            setRenderKey(k => k + 1);
          } catch (err) {
            console.error('[Editor] Replace embedded image failed:', err);
            setError(`Replace failed: ${err instanceof Error ? err.message : String(err)}`);
          }
          return;
        }

        if (replacingImageIdRef.current) {
          setFloatingImages(prev => prev.map(p => p.id === replacingImageIdRef.current ? { ...p, dataUrl: jpegDataUrl } : p));
          replacingImageIdRef.current = null;
          return;
        }

        // Add new floating image
        if (!doc || !renderResult) return;
        const page = doc.pages[currentPage];

        let pdfWidth = img.width;
        let pdfHeight = img.height;
        const maxDim = 200;
        if (pdfWidth > maxDim || pdfHeight > maxDim) {
          const ratio = Math.min(maxDim / pdfWidth, maxDim / pdfHeight);
          pdfWidth *= ratio;
          pdfHeight *= ratio;
        }

        const pdfX = page.mediaBox.width / 2 - pdfWidth / 2;
        const pdfY = page.mediaBox.height / 2 + pdfHeight / 2;

        const newImg: FloatingImage = {
          id: Math.random().toString(36).substr(2, 9),
          pdfX,
          pdfY,
          pdfWidth,
          pdfHeight,
          dataUrl: jpegDataUrl,
        };
        setFloatingImages(prev => [...prev, newImg]);
        setActiveFloatingImageId(newImg.id);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [doc, currentPage, renderResult, syncTxState]);

  const toEditableImage = useCallback((item: ImageItem): EditableObject => ({
    id: `sel-image-${item.name}`,
    kind: 'image',
    bbox: { x: item.x, y: item.y, width: item.width, height: item.height },
    ctm: item.ctm
      ? [item.ctm.a, item.ctm.b, item.ctm.c, item.ctm.d, item.ctm.e, item.ctm.f]
      : [item.width, 0, 0, item.height, item.x, item.y],
    source: item,
  }), []);

  const handleEmbeddedImageMove = useCallback(async (pdfDx: number, pdfDy: number) => {
    if (!doc || !engineRef.current || selectedDisplayItem?.type !== 'image') return;
    const item = selectedDisplayItem as ImageItem;
    const editable = toEditableImage(item);
    const moved = transformObject(editable, { dx: pdfDx, dy: pdfDy });
    await applyObjectTransform(doc, currentPage, editable, moved.ctm);
    const page = doc.pages[currentPage];
    const nextBytes = engineRef.current.getPageContentBytes(page, doc.objects);
    txStackRef.current.push({
      pageIndex: currentPage,
      contentBytes: new Uint8Array(nextBytes),
      label: 'move-image',
      timestamp: Date.now(),
    });
    syncTxState();
    setIsDirty(true);
    setSelectedDisplayItem(null);
    setRenderKey(k => k + 1);
  }, [doc, currentPage, selectedDisplayItem, toEditableImage, syncTxState]);

  const handleEmbeddedImageResize = useCallback(async (newWidth: number, newHeight: number) => {
    if (!doc || !engineRef.current || selectedDisplayItem?.type !== 'image') return;
    const item = selectedDisplayItem as ImageItem;
    const editable = toEditableImage(item);
    // Keep screen top-left fixed → PDF x fixed, top (y+h) fixed
    const top = item.y + item.height;
    const newY = top - newHeight;
    const newCtm = [newWidth, 0, 0, newHeight, item.x, newY];
    await applyObjectTransform(doc, currentPage, editable, newCtm);
    const page = doc.pages[currentPage];
    const nextBytes = engineRef.current.getPageContentBytes(page, doc.objects);
    txStackRef.current.push({
      pageIndex: currentPage,
      contentBytes: new Uint8Array(nextBytes),
      label: 'resize-image',
      timestamp: Date.now(),
    });
    syncTxState();
    setIsDirty(true);
    setSelectedDisplayItem(null);
    setRenderKey(k => k + 1);
  }, [doc, currentPage, selectedDisplayItem, toEditableImage, syncTxState]);

  const handleReplaceEmbeddedImage = useCallback(() => {
    if (selectedDisplayItem?.type !== 'image') return;
    replacingEmbeddedImageRef.current = selectedDisplayItem as ImageItem;
    replacingImageIdRef.current = null;
    fileInputRef.current?.click();
  }, [selectedDisplayItem]);

  // ── Hidden / line input — preview only; PDF commits on submit ──
  const handleHiddenInput = useCallback((e: React.FormEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!editingLine) return;
    const el = e.target as HTMLTextAreaElement | HTMLInputElement;
    const newVal = el.value;
    const oldVal = editTextRef.current;
    const sel = el.selectionStart ?? newVal.length;
    const delta = newVal.length - oldVal.length;

    // Remap existing style overrides around the edit point
    const remap = (start: number, end: number): { start: number; end: number } | null => {
      const editAt = Math.min(sel - Math.max(0, delta), oldVal.length);
      if (end <= editAt) return { start, end };
      if (start >= editAt) return { start: start + delta, end: end + delta };
      // Edit inside range — expand/shrink end
      return { start, end: Math.max(start, end + delta) };
    };

    if (delta !== 0 || newVal !== oldVal) {
      setEditStyleOverrides(prev => prev.map(ov => {
        const next = remap(ov.start, ov.end);
        return next ? { ...ov, ...next } : ov;
      }).filter(ov => ov.end > ov.start));
      pendingStylesRef.current = pendingStylesRef.current.map(p => {
        const next = remap(p.start, p.end);
        return next ? { ...p, ...next } : p;
      }).filter(p => p.end > p.start);
    }

    // Apply typing style to newly inserted characters only
    const ts = typingStyleRef.current;
    if (
      delta > 0
      && (ts.bold != null || ts.italic != null || ts.underline != null
        || ts.color != null || ts.fontSize != null || ts.fontFamily != null)
    ) {
      const insertStart = sel - delta;
      const insertEnd = sel;
      const patch: Partial<TextStyleUI> = {};
      if (ts.bold != null) patch.bold = ts.bold;
      if (ts.italic != null) patch.italic = ts.italic;
      if (ts.underline != null) patch.underline = ts.underline;
      if (ts.color != null) patch.color = ts.color;
      if (ts.fontSize != null) patch.fontSize = ts.fontSize;
      if (ts.fontFamily != null) patch.fontFamily = ts.fontFamily;
      pendingStylesRef.current = [...pendingStylesRef.current, { patch, start: insertStart, end: insertEnd }];
      setEditStyleOverrides(prev => [
        ...prev,
        {
          start: insertStart,
          end: insertEnd,
          bold: ts.bold,
          italic: ts.italic,
          underline: ts.underline,
          color: ts.color,
          fontSize: ts.fontSize,
          fontFamily: ts.fontFamily,
        },
      ]);
    }

    editTextRef.current = newVal;
    setEditText(newVal);
    setCaretPos(sel);
    const selEnd = el.selectionEnd ?? sel;
    editSelRef.current = { start: sel, end: selEnd };
    setEditSel({ start: sel, end: selEnd });
    caretVisibleRef.current = true;
  }, [editingLine]);

  const handleHiddenKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      handleRedo();
      return;
    }
    if (!editingLine) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      void handleDuplicateLineBelow();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      setTimeout(() => {
        const el = hiddenInputRef.current;
        if (!el) return;
        const start = el.selectionStart ?? caretPos;
        const end = el.selectionEnd ?? start;
        setCaretPos(start);
        editSelRef.current = { start, end };
        setEditSel({ start, end });
        caretVisibleRef.current = true;
      }, 0);
    }
  }, [editingLine, caretPos, handleEditSubmit, handleEditCancel, handleUndo, handleRedo, handleDuplicateLineBelow]);

  const handleHiddenBlur = useCallback(() => {
    if (!editingLine) return;
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    blurTimeoutRef.current = setTimeout(() => {
      blurTimeoutRef.current = null;
      // Sidebar / font <select> uses data-keep-text-edit — keep edit open.
      // Do NOT refocus the textarea here or the native dropdown closes instantly.
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.('[data-keep-text-edit]')) {
        return;
      }
      if (editingLineRef.current) {
        handleEditSubmit();
      }
    }, 150);
  }, [editingLine, handleEditSubmit]);

  // ── Navigation handlers ──
  const goToPrev = useCallback(() => {
    commitDrawingsToPdf();
    closeLinkPopover();
    setLinkCreatePending(false);
    setCurrentPage(p => Math.max(0, p - 1));
  }, [commitDrawingsToPdf, closeLinkPopover]);

  const goToNext = useCallback(() => {
    commitDrawingsToPdf();
    closeLinkPopover();
    setLinkCreatePending(false);
    setCurrentPage(p => Math.min(totalPages - 1, p + 1));
  }, [totalPages, commitDrawingsToPdf, closeLinkPopover]);

  const zoomIn = useCallback(() => {
    setScale(s => Math.min(4, Math.round((s + 0.25) * 100) / 100));
  }, []);

  const zoomOut = useCallback(() => {
    setScale(s => Math.max(0.5, Math.round((s - 0.25) * 100) / 100));
  }, []);

  // Trackpad pinch / Ctrl+wheel zoom (browsers fire wheel+ctrlKey for pinch)
  useEffect(() => {
    if (isLoading || !doc) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const onWheel = (e: WheelEvent) => {
      // Pinch-to-zoom on macOS/Chrome sets ctrlKey; also support Ctrl/Cmd+wheel
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();

      const intensity = Math.max(0.05, Math.min(0.25, Math.abs(e.deltaY) * 0.012));
      const direction = e.deltaY < 0 ? 1 : -1;
      setScale(s => {
        const next = s + direction * intensity;
        const clamped = Math.min(4, Math.max(0.5, next));
        return Math.round(clamped * 100) / 100;
      });
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [doc, isLoading, currentPage]);
  // ── Watermark Handlers ──
  const handleWatermarkImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setWatermarkImageFile(file);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        // Convert the image to JPEG using a canvas because the simplified PDF engine
        // only correctly supports image/jpeg (DCTDecode) without complex FlateDecode logic.
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Fill with white background in case of transparent PNG
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);

          canvas.toBlob(blob => {
            if (blob) {
              blob.arrayBuffer().then(buf => {
                setWatermarkImageBytes(new Uint8Array(buf));
                setWatermarkImageDims({ width: img.naturalWidth, height: img.naturalHeight });

                // Override the file to be considered JPEG
                const jpegFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
                setWatermarkImageFile(jpegFile);
              });
            }
          }, 'image/jpeg', 0.9);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const handleWatermarkImageClear = useCallback(() => {
    setWatermarkImageFile(null);
    setWatermarkImageBytes(null);
    setWatermarkImageDims(null);
  }, []);

  const handleApplyWatermark = useCallback(() => {
    if (!doc || !engineRef.current) return;
    try {
      let wm: Watermark;

      const pageIndices: number[] = [];
      const totalPages = doc.pages.length;
      const fromIdx = Math.max(0, watermarkPageFrom - 1);
      const toIdx = Math.min(totalPages - 1, watermarkPageTo - 1);
      for (let i = fromIdx; i <= toIdx; i++) {
        pageIndices.push(i);
      }

      if (watermarkType === 'text') {
        const r = parseInt(watermarkColor.slice(1, 3), 16) / 255;
        const g = parseInt(watermarkColor.slice(3, 5), 16) / 255;
        const b = parseInt(watermarkColor.slice(5, 7), 16) / 255;

        wm = {
          id: `wm-${Date.now()}`,
          type: 'text',
          text: watermarkText,
          opacity: watermarkOpacity / 100,
          blendMode: watermarkBlendMode,
          color: [r, g, b],
          rotation: watermarkRotation,
          tile: watermarkMosaic,
          layer: watermarkLayer,
          fontName: watermarkFontName,
          fontSize: Math.round(72 * (watermarkSize / 100)),
          position: watermarkPosition as any,
          pageIndices
        };
      } else if (watermarkType === 'shape') {
        const r = parseInt(watermarkColor.slice(1, 3), 16) / 255;
        const g = parseInt(watermarkColor.slice(3, 5), 16) / 255;
        const b = parseInt(watermarkColor.slice(5, 7), 16) / 255;

        const sr = parseInt(watermarkShapeColor.slice(1, 3), 16) / 255;
        const sg = parseInt(watermarkShapeColor.slice(3, 5), 16) / 255;
        const sb = parseInt(watermarkShapeColor.slice(5, 7), 16) / 255;

        const fontSizePt = Math.round(72 * (watermarkSize / 100));
        const textWidth = watermarkText.length * fontSizePt * 0.5;

        let finalWidth = textWidth + 40;
        let finalHeight = fontSizePt + 40;
        if (watermarkShapeType === 'circle') {
          const maxDim = Math.max(finalWidth, finalHeight);
          finalWidth = maxDim;
          finalHeight = maxDim;
        }

        wm = {
          id: `wm-${Date.now()}`,
          type: 'shape',
          shape: watermarkShapeType,
          text: watermarkText,
          fontName: watermarkFontName,
          fontSize: fontSizePt,
          textColor: [r, g, b],
          shapeColor: [sr, sg, sb],
          width: finalWidth,
          height: finalHeight,
          opacity: watermarkOpacity / 100,
          blendMode: watermarkBlendMode,
          rotation: watermarkRotation,
          tile: watermarkMosaic,
          layer: watermarkLayer,
          position: watermarkPosition as any,
          pageIndices
        } as any;
      } else {
        if (!watermarkImageBytes || !watermarkImageDims || !watermarkImageFile) {
          setError('Please upload an image first');
          return;
        }

        const mimeType = watermarkImageFile.type === 'image/png' ? 'image/png' : 'image/jpeg';

        wm = {
          id: `wm-${Date.now()}`,
          type: 'image',
          imageBytes: watermarkImageBytes,
          mimeType,
          width: watermarkImageDims.width * (watermarkSize / 100),
          height: watermarkImageDims.height * (watermarkSize / 100),
          opacity: watermarkOpacity / 100,
          blendMode: watermarkBlendMode,
          rotation: watermarkRotation,
          tile: watermarkMosaic,
          layer: watermarkLayer,
          position: watermarkPosition as any,
          pageIndices
        };
      }

      const results = engineRef.current.applyWatermarks(doc, [wm], () => engineRef.current!.getNextObjNum(doc));

      const updatePromises: Promise<void>[] = [];
      results.forEach((newBytes, pageIdx) => {
        const page = doc.pages[pageIdx];
        updatePromises.push(
          engineRef.current!.updatePageContent(page.contentRefs, newBytes, doc.objects)
        );
      });

      Promise.all(updatePromises).then(() => {
        setDoc({ ...doc });
        setRenderKey(k => k + 1);
        setWatermarkLivePreview(false);
        setShowApplySuccessModal(true);
      }).catch(err => {
        console.error('[Editor] Apply watermark failed:', err);
        setError(`Failed to apply watermark: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (e) {
      console.error('[Editor] Apply watermark failed:', e);
      setError(`Failed to apply watermark: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, watermarkType, watermarkText, watermarkFontName, watermarkOpacity, watermarkRotation, watermarkSize, watermarkPosition, watermarkMosaic, watermarkPageFrom, watermarkPageTo, watermarkLayer, watermarkColor, watermarkShapeColor, watermarkShapeType, watermarkImageBytes, watermarkImageDims, watermarkImageFile, watermarkBlendMode]);

  // ── Signature handlers ──
  const resolveSignatureImage = useCallback((sig: VisualSignature): string | null => {
    const entry = getSignatureLibrary().get(sig.appearanceId);
    return entry?.imageDataUrl ?? null;
  }, []);

  const handleSignatureSelect = useCallback((id: string) => {
    setSelectedSignatureId(id);
    setSelectedDisplayItem(null);
  }, []);

  const handleSignatureMove = useCallback((id: string, dx: number, dy: number) => {
    const next = updateSignature(signaturesRef.current, id, (s) => moveSignature(s, dx, dy));
    pushSignatureSnapshot(next, 'move-signature');
  }, [pushSignatureSnapshot]);

  const handleSignatureResize = useCallback((id: string, width: number, height: number) => {
    const next = updateSignature(signaturesRef.current, id, (s) => resizeSignature(s, width, height));
    pushSignatureSnapshot(next, 'resize-signature');
  }, [pushSignatureSnapshot]);

  const handleSignatureRotate = useCallback((id: string, degrees: number) => {
    const next = updateSignature(signaturesRef.current, id, (s) => rotateSignature(s, degrees));
    pushSignatureSnapshot(next, 'rotate-signature');
  }, [pushSignatureSnapshot]);

  const handleSignatureDelete = useCallback((id: string) => {
    const next = deleteSignature(signaturesRef.current, id);
    pushSignatureSnapshot(next, 'delete-signature');
    if (selectedSignatureId === id) setSelectedSignatureId(null);
  }, [pushSignatureSnapshot, selectedSignatureId]);

  const handleSignatureOpacity = useCallback((id: string, opacity: number) => {
    const next = updateSignature(signaturesRef.current, id, (s) => setSignatureOpacity(s, opacity));
    pushSignatureSnapshot(next, 'opacity-signature');
  }, [pushSignatureSnapshot]);

  const handleSignatureLockToggle = useCallback((id: string) => {
    const next = updateSignature(signaturesRef.current, id, (s) => setSignatureLocked(s, !s.locked));
    pushSignatureSnapshot(next, 'lock-signature');
  }, [pushSignatureSnapshot]);

  const handleSignatureCreateSave = useCallback((result: SignatureCreateResult) => {
    const entry = getSignatureLibrary().add({
      ...result.entry,
      favorite: false,
    });
    refreshSignatureLibrary();
    setActiveLibraryId(entry.id);
  }, [refreshSignatureLibrary]);

  const handleLibraryRename = useCallback((id: string, name: string) => {
    getSignatureLibrary().rename(id, name);
    refreshSignatureLibrary();
  }, [refreshSignatureLibrary]);

  const handleLibraryDelete = useCallback((id: string) => {
    getSignatureLibrary().delete(id);
    if (activeLibraryId === id) setActiveLibraryId(null);
    refreshSignatureLibrary();
  }, [activeLibraryId, refreshSignatureLibrary]);

  const handleLibraryDuplicate = useCallback((id: string) => {
    const dup = getSignatureLibrary().duplicate(id);
    if (dup) {
      setActiveLibraryId(dup.id);
      refreshSignatureLibrary();
    }
  }, [refreshSignatureLibrary]);

  const handleLibraryFavorite = useCallback((id: string) => {
    getSignatureLibrary().toggleFavorite(id);
    refreshSignatureLibrary();
  }, [refreshSignatureLibrary]);

  const handleScanWatermarks = useCallback(() => {
    if (!doc || !engineRef.current) return;
    try {
      const detections = engineRef.current.detectWatermarks(doc);
      setDetectedWatermarks(detections);
    } catch (e) {
      console.error('[Editor] Scan watermarks failed:', e);
      setError(`Failed to scan watermarks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc]);

  const handleConfirmRemoveWatermarks = useCallback(() => {
    setIsConfirmingRemoval(true);
  }, []);

  const executeRemoveWatermarks = useCallback(() => {
    if (!doc || !engineRef.current || !detectedWatermarks) return;
    try {
      const removal = engineRef.current.removeWatermarks(doc, detectedWatermarks);
      console.log('[Editor] Removed watermarks:', removal);
      setDoc({ ...doc });
      setRenderKey(k => k + 1);
      setDetectedWatermarks(null);
      setIsConfirmingRemoval(false);
    } catch (e) {
      console.error('[Editor] Remove watermarks failed:', e);
      setError(`Failed to remove watermarks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, detectedWatermarks]);

  const handleCancelScan = useCallback(() => {
    setDetectedWatermarks(null);
  }, []);


  // ── Download / Save ──
  const handleDownload = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    try {
      setIsSaving(true);
      await commitDrawingsToPdf();
      const engine = engineRef.current;
      const bytes = saveMode === 'quick'
        ? await engine.saveQuick(doc)
        : await engine.saveOptimized(doc);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
      setIsDirty(false);
    } catch (e) {
      console.error('[Editor] Download failed:', e);
      setError(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, fileName, saveMode, commitDrawingsToPdf]);

  // ── Compressed Download ──
  const handleCompressedDownload = useCallback(async (opts: {
    quality: number;
    dpi: number;
    targetBytes?: number;
  }) => {
    if (!doc || !engineRef.current) return;
    try {
      setIsSaving(true);
      setError(null);
      await commitDrawingsToPdf();
      const engine = engineRef.current;
      const originalLen = doc.rawBytes?.length ?? 0;

      const result = await engine.compressDocumentImages(doc, {
        quality: opts.quality,
        dpi: opts.dpi,
        targetBytes: opts.targetBytes,
      });

      // Hard safety: never hand the user a bigger file than they started with
      let outBytes = result.bytes;
      let outLen = result.compressedBytes;
      let note = result.message;
      if (originalLen > 0 && outLen > originalLen) {
        outBytes = doc.rawBytes!;
        outLen = originalLen;
        note = `Compression produced a larger file (${(result.compressedBytes / 1024).toFixed(1)} KB). Kept original ${(originalLen / 1024).toFixed(1)} KB instead.`;
      }

      console.log('[Compress]', note, {
        method: result.method,
        originalBytes: originalLen,
        compressedBytes: outLen,
      });

      const blob = new Blob([outBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const base = (fileName || 'document.pdf').replace(/\.pdf$/i, '');
      a.download =
        outLen < originalLen * 0.98 ? `${base}_compressed.pdf` : `${base}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (result.targetMissed || result.method === 'unchanged' || outLen >= originalLen) {
        setError(note);
      } else {
        setError(null);
      }
      setIsDirty(false);
    } catch (e) {
      console.error('[Editor] Compressed download failed:', e);
      setError(`Compression failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, fileName, commitDrawingsToPdf]);

  const handleClose = useCallback(async () => {
    await clearPdfFromStorage();
    router.push('/');
  }, [router]);

  // ── Page Operations ──
  const refreshAfterPageOp = useCallback((nextDoc: PDFDocumentData, nextCurrentPage?: number) => {
    setDoc({ ...nextDoc });
    setTotalPages(nextDoc.pages.length);
    if (nextCurrentPage != null) {
      setCurrentPage(Math.max(0, Math.min(nextCurrentPage, nextDoc.pages.length - 1)));
    } else if (currentPage >= nextDoc.pages.length) {
      setCurrentPage(Math.max(0, nextDoc.pages.length - 1));
    }
    setIsDirty(true);
    setRenderKey((k) => k + 1);
    setThumbnailKey((k) => k + 1);
  }, [currentPage]);

  const downloadPdfBytes = useCallback((bytes: Uint8Array, name: string) => {
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDeletePage = useCallback((index: number) => {
    if (!doc || !engineRef.current) return;
    try {
      engineRef.current.deletePage(doc, index);
      let nextPage = currentPage;
      if (currentPage === index) {
        nextPage = Math.min(index, doc.pages.length - 1);
      } else if (currentPage > index) {
        nextPage = currentPage - 1;
      }
      refreshAfterPageOp(doc, nextPage);
    } catch (e) {
      setError(`Failed to delete page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage, refreshAfterPageOp]);

  const handleRotatePage = useCallback((index: number) => {
    if (!doc || !engineRef.current) return;
    try {
      engineRef.current.rotatePageBy(doc, index, 90);
      refreshAfterPageOp(doc);
    } catch (e) {
      setError(`Failed to rotate page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, refreshAfterPageOp]);

  const handleReorderPages = useCallback((fromIndex: number, toIndex: number) => {
    if (!doc || !engineRef.current || fromIndex === toIndex) return;
    try {
      engineRef.current.movePage(doc, fromIndex, toIndex);
      let nextPage = currentPage;
      if (currentPage === fromIndex) {
        nextPage = toIndex;
      } else if (fromIndex < toIndex) {
        if (currentPage > fromIndex && currentPage <= toIndex) nextPage = currentPage - 1;
      } else if (currentPage >= toIndex && currentPage < fromIndex) {
        nextPage = currentPage + 1;
      }
      refreshAfterPageOp(doc, nextPage);
    } catch (e) {
      setError(`Failed to reorder pages: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage, refreshAfterPageOp]);

  const handleMergePdf = useCallback(async (file: File) => {
    if (!doc || !engineRef.current) return;
    try {
      const buffer = await file.arrayBuffer();
      const sourceDoc = await engineRef.current.parsePDF(new Uint8Array(buffer));
      const insertAt = doc.pages.length;
      engineRef.current.insertPagesFromDocument(doc, sourceDoc, insertAt);
      refreshAfterPageOp(doc);
    } catch (e) {
      setError(`Failed to merge PDF: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, refreshAfterPageOp]);

  const handleSplitCurrentPage = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    try {
      const engine = engineRef.current;
      const extracted = engine.extractPages(doc, [currentPage]);
      const bytes = await engine.saveQuick(extracted);
      const base = (fileName || 'document').replace(/\.pdf$/i, '');
      downloadPdfBytes(bytes, `${base}-page-${currentPage + 1}.pdf`);
    } catch (e) {
      setError(`Failed to split page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage, fileName, downloadPdfBytes]);

  const handleSplitAllPages = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    if (doc.pages.length < 2) return;
    const ok = window.confirm(
      `Download ${doc.pages.length} separate PDF files (one per page)?`,
    );
    if (!ok) return;
    try {
      const engine = engineRef.current;
      const base = (fileName || 'document').replace(/\.pdf$/i, '');
      for (let i = 0; i < doc.pages.length; i++) {
        const extracted = engine.extractPages(doc, [i]);
        const bytes = await engine.saveQuick(extracted);
        downloadPdfBytes(bytes, `${base}-page-${i + 1}.pdf`);
        // Brief pause so the browser doesn't coalesce / block downloads
        await new Promise((r) => setTimeout(r, 120));
      }
    } catch (e) {
      setError(`Failed to split pages: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, fileName, downloadPdfBytes]);

  const handleRemoveCurrentPage = useCallback(() => {
    if (!doc || doc.pages.length <= 1) return;
    if (!window.confirm(`Remove page ${currentPage + 1}?`)) return;
    handleDeletePage(currentPage);
  }, [doc, currentPage, handleDeletePage]);

  const handleDeleteSelectedDisplayItem = useCallback(async () => {
    if (!doc || !engineRef.current || !selectedDisplayItem) return;
    try {
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      const item = selectedDisplayItem;

      // Warn when removing a near-full-page image (common for scanned certificates)
      if (item.type === 'image') {
        const pageArea = Math.max(1, page.mediaBox.width * page.mediaBox.height);
        const imgArea = Math.max(0, item.width) * Math.max(0, item.height);
        if (imgArea / pageArea >= 0.5) {
          const ok = window.confirm(
            'This image covers most of the page. Deleting it will remove most of what you see. Continue?',
          );
          if (!ok) return;
        }
      }

      const editable: EditableObject = {
        id: `sel-${item.type}`,
        kind: item.type,
        bbox: { x: item.x, y: item.y, width: item.width, height: item.height },
        ctm:
          item.type === 'image' && item.ctm
            ? [item.ctm.a, item.ctm.b, item.ctm.c, item.ctm.d, item.ctm.e, item.ctm.f]
            : [1, 0, 0, 1, 0, 0],
        source: item,
      };

      await deleteObject(doc, currentPage, editable);
      const nextBytes = engine.getPageContentBytes(page, doc.objects);
      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(nextBytes),
        label: `delete-${item.type}`,
        timestamp: Date.now(),
      });
      syncTxState();
      setSelectedDisplayItem(null);
      setIsDirty(true);
      setRenderKey(k => k + 1);
      setThumbnailKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Delete object failed:', e);
      setError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage, selectedDisplayItem, syncTxState]);

  const handleInsertBlankPage = useCallback((index: number) => {
    if (!doc || !engineRef.current) return;
    try {
      engineRef.current.insertBlankPage(doc, index);
      const nextPage = currentPage >= index ? currentPage + 1 : currentPage;
      refreshAfterPageOp(doc, nextPage);
    } catch (e) {
      setError(`Failed to insert blank page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage, refreshAfterPageOp]);

  const handleInsertPdf = useCallback(async (index: number, file: File) => {
    if (!doc || !engineRef.current) return;
    try {
      const buffer = await file.arrayBuffer();
      const sourceDoc = await engineRef.current.parsePDF(new Uint8Array(buffer));
      engineRef.current.insertPagesFromDocument(doc, sourceDoc, index);
      const nextPage = currentPage >= index ? currentPage + sourceDoc.pages.length : currentPage;
      refreshAfterPageOp(doc, nextPage);
    } catch (e) {
      setError(`Failed to insert PDF: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage, refreshAfterPageOp]);


  // ── Keyboard shortcuts (global — NOT during editing) ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept when the hidden input has focus (editing)
      if (editingLine) return;

      // Don't intercept when the user is typing in any text box or input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); goToPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault(); goToNext();
      } else if ((e.key === '+' || e.key === '=') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); zoomIn();
      } else if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); zoomOut();
      } else if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select');
      } else if (e.key === 't' || e.key === 'T') {
        setActiveTool('text');
      } else if (e.key === 'a' || e.key === 'A') {
        setActiveTool('addtext');
      } else if (e.key === 'h' || e.key === 'H') {
        if (!e.metaKey && !e.ctrlKey) setActiveTool('highlight');
      } else if (e.key === 'l' || e.key === 'L') {
        if (!e.metaKey && !e.ctrlKey) setActiveTool('text');
      } else if (e.key === 'd') {
        setActiveTool('draw');
      } else if (e.key === 'e' || e.key === 'E') {
        if (!e.metaKey && !e.ctrlKey) setActiveTool('erase');
      } else if (e.key === 's' || e.key === 'S') {
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) setActiveTool('sign');
      } else if ((e.key === 'v' || e.key === 'V') && e.shiftKey && !e.metaKey && !e.ctrlKey) {
        // SIGNATURE_SHORTCUTS.validate
        if (activeTool === 'sign') {
          e.preventDefault();
          void handleValidateSignatures();
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedSignatureId) {
        e.preventDefault();
        handleSignatureDelete(selectedSignatureId);
      } else if (e.key === 'w' || e.key === 'W') {
        if (!e.metaKey && !e.ctrlKey) setActiveTool('watermark');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToPrev, goToNext, zoomIn, zoomOut, editingLine, selectedSignatureId, handleSignatureDelete, activeTool, handleValidateSignatures]);

  const eraserSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${eraserSize}" height="${eraserSize}" viewBox="0 0 ${eraserSize} ${eraserSize}"><circle cx="${eraserSize / 2}" cy="${eraserSize / 2}" r="${eraserSize / 2 - 1}" fill="rgba(255,255,255,0.4)" stroke="black" stroke-width="1"/></svg>`;
  const eraserCursorUrl = `url('data:image/svg+xml;utf8,${encodeURIComponent(eraserSvg)}') ${eraserSize / 2} ${eraserSize / 2}, auto`;

  const cursorForTool = isPanning ? 'grabbing'
    : spacePanHeld || (scale > 1 && !['draw', 'highlight', 'erase', 'sign'].includes(activeTool)) ? 'grab'
    : activeTool === 'text' ? 'text'
      : activeTool === 'draw' ? 'crosshair'
        : activeTool === 'highlight' ? 'pointer'
          : activeTool === 'erase' ? eraserCursorUrl
            : activeTool === 'sign' ? 'crosshair'
              : activeTool === 'select' ? 'grab'
                : 'default';

  const isPanIgnoreTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return !!target.closest(
      'textarea, input, button, a, [data-no-pan], [contenteditable="true"]',
    );
  }, []);

  const endPanDrag = useCallback((pointerId?: number) => {
    const drag = panDragRef.current;
    if (!drag) return false;
    if (pointerId != null && drag.pointerId !== pointerId) return false;
    const didPan = drag.moved;
    panDragRef.current = null;
    setIsPanning(false);
    const viewport = scrollViewportRef.current;
    try {
      viewport?.releasePointerCapture(drag.pointerId);
    } catch {
      // ignore
    }
    return didPan;
  }, []);

  const handleViewportPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (isPanIgnoreTarget(e.target)) return;

    const middle = e.button === 1;
    const leftPan =
      e.button === 0 &&
      (spacePanHeld ||
        (scale > 1 && !['draw', 'highlight', 'erase'].includes(activeTool)));
    if (!middle && !leftPan) return;

    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    if (
      e.button === 0 &&
      !spacePanHeld &&
      (e.target as Element).closest?.('.absolute.z-20, [data-edit-box], [data-resize-handle]')
    ) {
      return;
    }

    panDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      moved: false,
    };

    if (middle || spacePanHeld) {
      setIsPanning(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      e.preventDefault();
    }
  }, [activeTool, scale, spacePanHeld, isPanIgnoreTarget]);

  const handleViewportPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.abs(dx) <= 3 && Math.abs(dy) <= 3) return;
      drag.moved = true;
      setIsPanning(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    // Flex + justify-center breaks scrollLeft; pan via scroll on a max-content wrapper.
    viewport.scrollLeft = drag.scrollLeft - dx;
    viewport.scrollTop = drag.scrollTop - dy;
  }, []);

  const handleViewportPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const didPan = endPanDrag(e.pointerId);
    if (didPan) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [endPanDrag]);

  // Space = temporary hand tool (Photoshop-style)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || e.repeat) return;
      if (editingLine) return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      e.preventDefault();
      setSpacePanHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      setSpacePanHeld(false);
      if (!panDragRef.current) setIsPanning(false);
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [editingLine]);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="w-8 h-8 border-4 border-zinc-800 border-t-blue-500 rounded-full animate-spin" />
        <p className="mt-4 text-sm font-medium animate-pulse">Processing PDF...</p>
      </div>
    );
  }

  // ── Error state ──
  if (error && !doc) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center font-sans bg-zinc-950 text-zinc-100">
        <p className="text-red-500 text-sm max-w-[400px] text-center leading-relaxed">
          {error}
        </p>
        <button
          onClick={handleClose}
          className="mt-6 px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2"
        >
          <ChevronLeft size={16} /> Go Back
        </button>
      </div>
    );
  }

  // ── Main editor UI ──
  return (
    <div className="flex flex-col h-screen font-sans bg-zinc-950 text-zinc-100 selection:bg-blue-500/30">

      {/* ── Top toolbar ── */}
      <Toolbar
        fileName={fileName}
        currentPage={currentPage}
        totalPages={totalPages}
        scale={scale}
        drawnPaths={drawnPaths}
        isSaving={isSaving}
        canUndo={canUndo}
        canRedo={canRedo}
        onClose={handleClose}
        onPrevPage={goToPrev}
        onNextPage={goToNext}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClearPaths={() => {
          setDrawnPaths([]);
          if (doc && engineRef.current) {
            const page = doc.pages[currentPage];
            const n = engineRef.current.clearMarkupAnnotationsOnPage(page.dict, doc.objects);
            if (n > 0) {
              setIsDirty(true);
              setRenderKey(k => k + 1);
            }
          }
        }}
        onDownload={handleDownload}
        saveMode={saveMode}
        onSaveModeChange={setSaveMode}
        isSearchOpen={isSearchOpen}
        onToggleSearch={() => setIsSearchOpen(!isSearchOpen)}
        onExport={() => setShowExportPanel(true)}
        doc={doc}
        onCompressedDownload={handleCompressedDownload}
      />

      <div className="flex-1 flex overflow-hidden">

        {/* ── Left sidebar (Tools only) ── */}
        <ToolsSidebar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          highlightColor={highlightColor}
        />

        {/* ── Left Sidebar (Properties) ── */}
        <PropertiesSidebar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          selectedRun={selectedLine?.runs[0] ?? null}
          textFontFamily={textFontFamily}
          setTextFontFamily={handleTextFontFamily}
          textFontSize={textFontSize}
          setTextFontSize={handleTextFontSize}
          textBold={textBold}
          setTextBold={handleTextBold}
          textItalic={textItalic}
          setTextItalic={handleTextItalic}
          textUnderline={textUnderline}
          setTextUnderline={handleTextUnderline}
          textColor={textColor}
          setTextColor={handleTextColor}
          textAlign={textAlign}
          setTextAlign={handleTextAlign}
          textOpacity={textOpacity}
          setTextOpacity={setTextOpacity}
          replacingImageIdRef={replacingImageIdRef}
          fileInputRef={fileInputRef}
          drawColor={drawColor}
          setDrawColor={setDrawColor}
          drawSize={drawSize}
          setDrawSize={setDrawSize}
          highlightColor={highlightColor}
          setHighlightColor={setHighlightColor}
          highlightSize={highlightSize}
          setHighlightSize={setHighlightSize}
          eraserSize={eraserSize}
          setEraserSize={setEraserSize}
          pageLinkCount={pageLinks.length}
          linksHighlighted={linksHighlighted}
          onScanLinks={() => {
            if (!doc || !engineRef.current) return;
            try {
              const links = engineRef.current.listPageLinks(doc, currentPage);
              setPageLinks(links);
              setLinksHighlighted(true);
              setLinkCreatePending(false);
              closeLinkPopover();
              if (links.length === 0) {
                window.alert('No links found on this page.');
              }
            } catch (err) {
              console.warn('[Editor] Scan links failed:', err);
            }
          }}
          hasSelectedLink={false}
          linkCreatePending={linkCreatePending}
          selectedLinkUrl={linkDraftUrl}
          onSelectedLinkUrlChange={setLinkDraftUrl}
          onSaveSelectedLink={() => {
            if (!doc || !engineRef.current) return;
            const url = linkDraftUrl.trim();
            if (!url || url === 'https://') return;

            // Create from current text selection / line
            const line = editAnchorLineRef.current ?? selectedLine ?? editingLine;
            if (!line) {
              window.alert('Select or click a text line first, then add a link.');
              return;
            }
            const sel = editSelRef.current;
            let start = 0;
            let end = line.text.length;
            if (editingLine && sel.end > sel.start) {
              start = sel.start;
              end = sel.end;
            } else if (editingLine) {
              const range = resolveEditStyleRange(line, sel.start, sel.end);
              start = range.start;
              end = range.end;
            }
            try {
              const ref = engineRef.current.addLinkFromLineSelection(
                doc, currentPage, line, start, end, url,
              );
              if (ref) {
                setLinkCreatePending(false);
                setLinkDraftUrl('');
                setLinksHighlighted(true);
                setIsDirty(true);
                setRenderKey(k => k + 1);
              } else {
                window.alert('Select some text first, then add a link.');
              }
            } catch (err) {
              console.warn('[Editor] Add link failed:', err);
            }
          }}
          onRemoveSelectedLink={() => {
            setLinkCreatePending(false);
            setLinkDraftUrl('');
          }}
          onAddLink={() => {
            const line = editAnchorLineRef.current ?? selectedLine ?? editingLine;
            if (!line) {
              window.alert('Select or click a text line first, then add a link.');
              return;
            }
            closeLinkPopover();
            setLinkCreatePending(true);
            setLinkDraftUrl('https://');
            setActiveTool('text');
          }}
          selectedDisplayItem={selectedDisplayItem}
          setSelectedDisplayItem={setSelectedDisplayItem}
          onDeleteSelectedDisplayItem={handleDeleteSelectedDisplayItem}
          onReplaceSelectedImage={handleReplaceEmbeddedImage}
          onClearImageReplaceMode={() => { replacingEmbeddedImageRef.current = null; }}
          displayItems={displayItems}
          formFields={formFields}
          selectedFormField={selectedFormField}
          formFieldDraft={formFieldDraft}
          onFormFieldSelect={handleFormFieldSelect}
          onFormFieldChange={handleFormFieldChange}
          onFlattenForms={handleFlattenForms}
          onDuplicateLineBelow={handleDuplicateLineBelow}
          tableInfo={selectedTableCell ? {
            rows: selectedTableCell.table.rows,
            cols: selectedTableCell.table.cols,
            row: selectedTableCell.cell.row,
            col: selectedTableCell.cell.col,
          } : null}
          onAddTableRow={handleAddTableRow}
          onAddTableColumn={handleAddTableColumn}
          watermarkType={watermarkType}
          setWatermarkType={setWatermarkType}
          watermarkShapeType={watermarkShapeType}
          setWatermarkShapeType={setWatermarkShapeType}
          watermarkShapeColor={watermarkShapeColor}
          setWatermarkShapeColor={setWatermarkShapeColor}
          watermarkImageFile={watermarkImageFile}
          onWatermarkImageUpload={handleWatermarkImageUpload}
          onWatermarkImageClear={handleWatermarkImageClear}
          watermarkText={watermarkText}
          setWatermarkText={setWatermarkText}
          watermarkFontName={watermarkFontName}
          setWatermarkFontName={setWatermarkFontName}
          watermarkOpacity={watermarkOpacity}
          setWatermarkOpacity={setWatermarkOpacity}
          watermarkRotation={watermarkRotation}
          setWatermarkRotation={setWatermarkRotation}
          watermarkSize={watermarkSize}
          setWatermarkSize={setWatermarkSize}
          watermarkPosition={watermarkPosition}
          setWatermarkPosition={setWatermarkPosition}
          watermarkBlendMode={watermarkBlendMode}
          setWatermarkBlendMode={setWatermarkBlendMode}
          watermarkMosaic={watermarkMosaic}
          setWatermarkMosaic={setWatermarkMosaic}
          watermarkPageFrom={watermarkPageFrom}
          setWatermarkPageFrom={setWatermarkPageFrom}
          watermarkPageTo={watermarkPageTo}
          setWatermarkPageTo={setWatermarkPageTo}
          watermarkLayer={watermarkLayer}
          setWatermarkLayer={setWatermarkLayer}
          watermarkColor={watermarkColor}
          setWatermarkColor={setWatermarkColor}
          watermarkLivePreview={watermarkLivePreview}
          setWatermarkLivePreview={setWatermarkLivePreview}
          onApplyWatermark={handleApplyWatermark}
          hasScannedWatermarks={detectedWatermarks !== null}
          detectedWatermarksCount={detectedWatermarks?.length}
          onScanWatermarks={handleScanWatermarks}
          onRemoveWatermarks={handleConfirmRemoveWatermarks}
          onCancelScan={handleCancelScan}
          // Signature tool
          signatureLibraryEntries={signatureLibraryEntries}
          activeLibraryId={activeLibraryId}
          setActiveLibraryId={setActiveLibraryId}
          selectedSignatureId={selectedSignatureId}
          selectedSignature={signatures.find((s) => s.id === selectedSignatureId) ?? null}
          onOpenSignatureCreate={() => setSignatureCreateOpen(true)}
          onSignatureDelete={handleSignatureDelete}
          onSignatureOpacity={handleSignatureOpacity}
          onSignatureLockToggle={handleSignatureLockToggle}
          onSignatureRotate={handleSignatureRotate}
          onLibraryRename={handleLibraryRename}
          onLibraryDelete={handleLibraryDelete}
          onLibraryDuplicate={handleLibraryDuplicate}
          onLibraryFavorite={handleLibraryFavorite}
          pdfSignatureFields={pdfSignatureFields}
          selectedPdfSigFieldId={selectedPdfSigFieldId}
          setSelectedPdfSigFieldId={setSelectedPdfSigFieldId}
          createFieldMode={createFieldMode}
          setCreateFieldMode={setCreateFieldMode}
          onPlaceIntoSelectedField={() => {
            const field = pdfSignatureFields.find((f) => f.id === selectedPdfSigFieldId);
            if (field) void placeLibrarySignatureIntoField(field);
          }}
          certificateIdentities={certificateIdentities}
          selectedCertificateId={selectedCertificateId}
          onOpenCertificateImport={() => setCertificateImportOpen(true)}
          onSelectCertificate={handleSelectCertificate}
          onCryptographicSign={() => void handleCryptographicSign()}
          cryptoSignBusy={cryptoSignBusy}
          enableTimestamp={enableTimestamp}
          setEnableTimestamp={setEnableTimestamp}
          onValidateSignatures={() => void handleValidateSignatures()}
          validationBusy={validationBusy}
          validationReport={validationReport}
          onEnableLtv={handleEnableLtv}
          ltvStatus={ltvStatus}
          managedSignatures={managedSignatures}
          revisionEntries={revisionEntries}
        />

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          className="hidden"
          onChange={handleImageUpload}
        />

        {/* ── Canvas area ── */}
        <div
          ref={scrollViewportRef}
          className="flex-1 overflow-auto relative checkerboard"
          style={{ cursor: cursorForTool, touchAction: scale > 1 || spacePanHeld ? 'none' : undefined }}
          onPointerDown={handleViewportPointerDown}
          onPointerMove={handleViewportPointerMove}
          onPointerUp={handleViewportPointerUp}
          onPointerCancel={handleViewportPointerUp}
        >
          {/* Floating Search & OCR Panel (viewport-fixed) */}
          {isSearchOpen && (
            <div className="absolute top-4 right-4 z-40 flex flex-col items-end gap-3 w-64 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-200">
              <div className="pointer-events-auto flex items-center justify-between gap-2 bg-zinc-900/95 backdrop-blur-md px-3 py-2 rounded-lg border border-zinc-700/80 shadow-lg w-full">
                <button
                  onClick={() => void handleRecognizeText()}
                  className="flex items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
                  title="OCR recognize (stub)"
                >
                  <Type size={14} /> Recognize text
                </button>
                {isDirty && <span className="text-[10px] text-amber-400 font-medium border-l border-zinc-700/50 pl-2">Unsaved</span>}
              </div>
              <div className="pointer-events-auto w-full bg-zinc-900/95 backdrop-blur-md rounded-xl border border-zinc-700/80 shadow-2xl overflow-hidden">
                <FindReplacePanel onFindReplace={handleFindReplace} />
              </div>
            </div>
          )}
          {isRendering && (
            <div className="absolute top-4 right-4 z-30 bg-zinc-900/90 backdrop-blur border border-zinc-800 shadow-lg rounded-full px-4 py-2 flex items-center gap-2 text-zinc-300 text-sm font-medium animate-in slide-in-from-top-4 fade-in">
              <Loader2 size={16} className="animate-spin text-blue-500" />
              Rendering...
            </div>
          )}

          {/*
            Centering wrapper: minWidth 100% + width max-content so overflow scroll
            works left/right after zoom (flex justify-center on the scroller breaks scrollLeft).
          */}
          <div
            className="flex justify-center items-start py-12"
            style={{ minWidth: '100%', width: 'max-content', minHeight: '100%' }}
          >
          <div
            ref={canvasContainerRef}
            className="relative inline-block shrink-0 shadow-2xl"
            style={{ cursor: cursorForTool }}
            onClick={(e) => {
              if (panDragRef.current?.moved || isPanning) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              handleCanvasClick(e);
            }}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseDown={handleDrawStart}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleDrawEnd}
            onMouseLeave={handleCanvasMouseLeave}
          >
            {/* PDF canvas is prepended here by the render effect */}

            {/* Overlay canvas for caret / drawings */}
            <canvas
              ref={overlayRef}
              className="absolute top-0 left-0 z-10"
              style={{
                pointerEvents: ['draw', 'highlight', 'erase'].includes(activeTool) ? 'auto' : 'none',
              }}
            />

            {/* DOM overlays for FloatingText */}
            {activeTool === 'watermark' && watermarkLivePreview && (
              <WatermarkPreview
                doc={doc}
                currentPage={currentPage}
                scale={scale}
                watermarkType={watermarkType}
                watermarkText={watermarkText}
                watermarkFontName={watermarkFontName}
                watermarkSize={watermarkSize}
                watermarkColor={watermarkColor}
                watermarkOpacity={watermarkOpacity}
                watermarkRotation={watermarkRotation}
                watermarkMosaic={watermarkMosaic}
                watermarkPosition={watermarkPosition}
                watermarkImageDims={watermarkImageDims}
                watermarkImageFile={watermarkImageFile}
                watermarkShapeType={watermarkShapeType}
                watermarkShapeColor={watermarkShapeColor}
                watermarkBlendMode={watermarkBlendMode}
              />
            )}

            {/* Detected watermarks dotted boxes */}
            {activeTool === 'watermark' && detectedWatermarks?.filter(d => d.pageIndex === currentPage).map(dw =>
              dw.positions.map((pos, i) => {
                const { cssX, cssY } = pdfToCanvas(
                  pos.x,
                  pos.y,
                  scale,
                  doc?.pages[currentPage]?.mediaBox.height || 0,
                  doc?.pages[currentPage]?.mediaBox.x || 0,
                  doc?.pages[currentPage]?.mediaBox.y || 0
                );
                const boxW = (pos.width || 120) * scale;
                const boxH = (pos.height || 60) * scale;
                const rot = pos.rotation ?? dw.rotation ?? 0;

                return (
                  <div
                    key={`det-${dw.id}-${i}`}
                    className="absolute border-2 border-red-500 border-dashed bg-red-500/20 rounded z-50 pointer-events-none animate-in fade-in zoom-in duration-200"
                    style={{
                      left: cssX,
                      top: cssY,
                      width: boxW,
                      height: boxH,
                      transform: `translate(-50%, -50%) rotate(${-rot}deg)`
                    }}
                  />
                );
              })
            )}

            {/* Interactive overlay for selected embedded PDF image */}
            {selectedDisplayItem?.type === 'image' && renderResult && doc && (() => {
              const item = selectedDisplayItem as ImageItem;
              const page = doc.pages[currentPage];
              const { mediaBox } = page;
              return (
                <EmbeddedImageOverlay
                  item={item}
                  scale={scale}
                  toCss={(b) => {
                    const tl = pdfToCanvas(
                      b.x, b.y + b.height,
                      scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
                    );
                    const br = pdfToCanvas(
                      b.x + b.width, b.y,
                      scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
                    );
                    return {
                      left: Math.min(tl.cssX, br.cssX),
                      top: Math.min(tl.cssY, br.cssY),
                      width: Math.abs(br.cssX - tl.cssX),
                      height: Math.abs(br.cssY - tl.cssY),
                    };
                  }}
                  onCommitMove={handleEmbeddedImageMove}
                  onCommitResize={handleEmbeddedImageResize}
                  onReplace={handleReplaceEmbeddedImage}
                  onDeselect={() => setSelectedDisplayItem(null)}
                />
              );
            })()}

            {/* Visual signatures — render above page contents */}
            {renderResult && doc && signatures.filter((s) => s.pageIndex === currentPage).map((sig) => {
              const page = doc.pages[currentPage];
              const { mediaBox } = page;
              return (
                <SignatureOverlay
                  key={sig.id}
                  signature={sig}
                  imageDataUrl={resolveSignatureImage(sig)}
                  scale={scale}
                  selected={selectedSignatureId === sig.id}
                  toCss={(b) => {
                    const tl = pdfToCanvas(
                      b.x, b.y + b.height,
                      scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
                    );
                    const br = pdfToCanvas(
                      b.x + b.width, b.y,
                      scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
                    );
                    return {
                      left: Math.min(tl.cssX, br.cssX),
                      top: Math.min(tl.cssY, br.cssY),
                      width: Math.abs(br.cssX - tl.cssX),
                      height: Math.abs(br.cssY - tl.cssY),
                    };
                  }}
                  onSelect={handleSignatureSelect}
                  onCommitMove={handleSignatureMove}
                  onCommitResize={handleSignatureResize}
                  onCommitRotate={handleSignatureRotate}
                  onDelete={handleSignatureDelete}
                  onDeselect={() => setSelectedSignatureId(null)}
                />
              );
            })}

            {/* PDF AcroForm signature field widgets */}
            {(activeTool === 'sign' || selectedPdfSigFieldId) && renderResult && doc &&
              pdfSignatureFields.map((field) => {
                const page = doc.pages[currentPage];
                const { mediaBox } = page;
                const tl = pdfToCanvas(
                  field.rect.x, field.rect.y + field.rect.height,
                  scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
                );
                const br = pdfToCanvas(
                  field.rect.x + field.rect.width, field.rect.y,
                  scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
                );
                const selected = selectedPdfSigFieldId === field.id;
                return (
                  <div
                    key={`pdf-sig-${field.id}`}
                    className={`absolute z-35 pointer-events-none border-2 border-dashed ${
                      selected ? 'border-emerald-400 bg-emerald-400/10' : 'border-sky-400/80 bg-sky-400/5'
                    }`}
                    style={{
                      left: Math.min(tl.cssX, br.cssX),
                      top: Math.min(tl.cssY, br.cssY),
                      width: Math.abs(br.cssX - tl.cssX),
                      height: Math.abs(br.cssY - tl.cssY),
                    }}
                  >
                    <span className="absolute -top-5 left-0 text-[9px] px-1 rounded bg-sky-700 text-white whitespace-nowrap">
                      {field.fieldName}{field.signed ? ' · signed' : field.hasAppearance ? ' · AP' : ''}
                    </span>
                  </div>
                );
              })}

            {floatingTexts.map(ft => {
              const { cssX, cssY } = pdfToCanvas(
                ft.pdfX,
                ft.pdfY,
                scale,
                doc?.pages[currentPage]?.mediaBox.height || 0,
                doc?.pages[currentPage]?.mediaBox.x || 0,
                doc?.pages[currentPage]?.mediaBox.y || 0
              );
              const isActive = activeFloatingTextId === ft.id;

              return (
                <div
                  key={ft.id}
                  className={`absolute z-20 cursor-move border-2 ${isActive ? 'border-blue-500 border-dashed' : 'border-transparent hover:border-zinc-500 hover:border-dashed'} p-1 -m-1`}
                  style={{
                    left: cssX,
                    top: cssY - (ft.fontSize * scale),
                  }}
                  onPointerDown={(e) => handleFloatingTextPointerDown(e, ft.id)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isActive && (
                    <button
                      className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1 shadow hover:bg-red-600 transition-colors z-30"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFloatingTexts(prev => prev.filter(p => p.id !== ft.id));
                        if (activeFloatingTextId === ft.id) setActiveFloatingTextId(null);
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                  <textarea
                    value={ft.text}
                    onChange={(e) => {
                      setFloatingTexts(prev => prev.map(p => p.id === ft.id ? { ...p, text: e.target.value } : p));
                    }}
                    onFocus={() => setActiveFloatingTextId(ft.id)}
                    className="bg-transparent outline-none overflow-hidden block resize"
                    style={{
                      fontFamily: ft.fontFamily,
                      fontSize: ft.fontSize * scale,
                      color: ft.color,
                      minWidth: '100px',
                      minHeight: `${ft.fontSize * scale * 1.5}px`,
                      width: ft.pdfWidth ? `${ft.pdfWidth * scale}px` : undefined,
                      height: ft.pdfHeight ? `${ft.pdfHeight * scale}px` : undefined,
                    }}
                    onPointerDown={e => {
                      if (isActive) e.stopPropagation();
                    }}
                    onMouseUp={e => {
                      // Capture size after resize handle is released
                      const target = e.target as HTMLTextAreaElement;
                      const w = target.offsetWidth / scale;
                      const h = target.offsetHeight / scale;
                      setFloatingTexts(prev => prev.map(p => p.id === ft.id ? { ...p, pdfWidth: w, pdfHeight: h } : p));
                    }}
                  />
                </div>
              );
            })}

            {/* DOM overlays for FloatingImage */}
            {floatingImages.map(fi => {
              const { cssX, cssY } = pdfToCanvas(
                fi.pdfX,
                fi.pdfY,
                scale,
                doc?.pages[currentPage]?.mediaBox.height || 0,
                doc?.pages[currentPage]?.mediaBox.x || 0,
                doc?.pages[currentPage]?.mediaBox.y || 0
              );
              const isActive = activeFloatingImageId === fi.id;

              return (
                <div
                  key={fi.id}
                  className={`absolute z-20 cursor-move border-2 ${isActive ? 'border-blue-500 border-dashed' : 'border-transparent hover:border-zinc-500 hover:border-dashed'} p-1 -m-1`}
                  style={{
                    left: cssX,
                    top: cssY,
                    width: fi.pdfWidth * scale + 8, // +8 for padding/border
                    height: fi.pdfHeight * scale + 8,
                  }}
                  onPointerDown={(e) => handleFloatingImagePointerDown(e, fi.id)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <img
                    src={fi.dataUrl}
                    alt="floating"
                    className="w-full h-full object-fill pointer-events-none"
                  />

                  {isActive && (
                    <>
                      <button
                        className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1 shadow hover:bg-red-600 transition-colors z-30"
                        title="Delete Image"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFloatingImages(prev => prev.filter(p => p.id !== fi.id));
                          if (activeFloatingImageId === fi.id) setActiveFloatingImageId(null);
                        }}
                      >
                        <X size={12} />
                      </button>
                      <button
                        className="absolute -bottom-3 -right-3 bg-blue-500 text-white rounded-full p-1 shadow hover:bg-blue-600 transition-colors z-30"
                        title="Replace Image"
                        onClick={(e) => {
                          e.stopPropagation();
                          replacingImageIdRef.current = fi.id;
                          fileInputRef.current?.click();
                        }}
                      >
                        <Image size={12} />
                      </button>

                      {/* Dimensions panel in cm */}
                      <div
                        className="absolute top-0 -right-[110px] bg-zinc-900 text-white rounded p-2 shadow-xl border border-zinc-700 text-xs flex flex-col gap-2 z-30 w-24"
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                      >
                        <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider mb-0.5">Dimensions</div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-zinc-500 w-3 text-center">W</span>
                          <input
                            type="number"
                            value={Math.round((fi.pdfWidth * 2.54 * 10) / 72) / 10}
                            onChange={e => {
                              const newW = (parseFloat(e.target.value) * 72) / 2.54;
                              if (newW > 0) setFloatingImages(prev => prev.map(p => p.id === fi.id ? { ...p, pdfWidth: newW } : p));
                            }}
                            className="w-10 bg-zinc-800 rounded px-1 py-0.5 text-right no-spinners outline-none focus:ring-1 focus:ring-blue-500"
                            step="0.1"
                          />
                          <span className="text-zinc-500 text-[10px]">cm</span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-zinc-500 w-3 text-center">H</span>
                          <input
                            type="number"
                            value={Math.round((fi.pdfHeight * 2.54 * 10) / 72) / 10}
                            onChange={e => {
                              const newH = (parseFloat(e.target.value) * 72) / 2.54;
                              if (newH > 0) setFloatingImages(prev => prev.map(p => p.id === fi.id ? { ...p, pdfHeight: newH } : p));
                            }}
                            className="w-10 bg-zinc-800 rounded px-1 py-0.5 text-right no-spinners outline-none focus:ring-1 focus:ring-blue-500"
                            step="0.1"
                          />
                          <span className="text-zinc-500 text-[10px]">cm</span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* CSS Resize Handle (only active when hovered to avoid drag conflict) */}
                  <div
                    className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize bg-blue-500/50"
                    onPointerDown={e => {
                      e.stopPropagation(); // prevent dragging
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const startW = fi.pdfWidth * scale;
                      const startH = fi.pdfHeight * scale;

                      const handleMove = (me: PointerEvent) => {
                        const newW = startW + (me.clientX - startX);
                        const newH = startH + (me.clientY - startY);
                        setFloatingImages(prev => prev.map(p => p.id === fi.id ? { ...p, pdfWidth: Math.max(10, newW / scale), pdfHeight: Math.max(10, newH / scale) } : p));
                      };

                      const handleUp = () => {
                        window.removeEventListener('pointermove', handleMove);
                        window.removeEventListener('pointerup', handleUp);
                      };

                      window.addEventListener('pointermove', handleMove);
                      window.addEventListener('pointerup', handleUp);
                    }}
                  />
                </div>
              );
            })}

            {/* Word-like line editor — same size/position as canvas text */}
            {editingLine && editAnchorLineRef.current && renderResult && doc && (() => {
              const anchor = editAnchorLineRef.current!;
              const bounds = getLineBounds(anchor);
              const page = doc.pages[currentPage];
              const { mediaBox } = page;
              const primaryRun = anchor.runs[0];
              const visualSize = primaryRun ? visualFontSize(primaryRun) : anchor.fontSize;
              // Box height follows the tallest glyph on the line (mixed sizes / overrides)
              let maxFontSizeCss = visualSize * scale;
              for (const run of anchor.runs) {
                maxFontSizeCss = Math.max(maxFontSizeCss, visualFontSize(run) * scale);
              }
              for (const ov of editStyleOverrides) {
                if (ov.fontSize != null) {
                  maxFontSizeCss = Math.max(maxFontSizeCss, ov.fontSize * scale);
                }
              }
              const tsSize = typingStyleRef.current.fontSize;
              if (tsSize != null) {
                maxFontSizeCss = Math.max(maxFontSizeCss, tsSize * scale);
              }
              // Include sidebar size while typing so the box grows with the caret style
              if (editSel.end <= editSel.start && textFontSize > 0) {
                maxFontSizeCss = Math.max(maxFontSizeCss, textFontSize * scale);
              }
              const fontSizeCss = maxFontSizeCss;
              const baseline = anchor.baseline;
              const ascent = fontSizeCss * 0.85;
              const descent = fontSizeCss * 0.25;
              const origin = pdfToCanvas(
                bounds.x,
                baseline,
                scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
              );
              const left = origin.cssX;
              const top = origin.cssY - ascent;
              const naturalWidth = Math.max(20, bounds.width * scale);
              const naturalHeight = ascent + descent;
              const fontData = primaryRun ? renderResult.fonts.get(primaryRun.fontName) : undefined;
              const [r, g, b] = primaryRun?.fillColor || [0, 0, 0];
              const colorCss = textColor.startsWith('#')
                ? textColor
                : `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;

              const pathItems = strokePaths;
              const edits = distributeTextChangeToSegments(
                anchor,
                initialRunTextRef.current || anchor.text,
                editText,
                caretPos,
              );

              type Piece = {
                start: number;
                end: number;
                text: string;
                run: TextRun;
              };
              let pieces: Piece[] = [];
              {
                let pos = 0;
                for (const edit of edits) {
                  pieces.push({
                    start: pos,
                    end: pos + edit.newText.length,
                    text: edit.newText,
                    run: edit.run,
                  });
                  pos += edit.newText.length;
                }
              }

              // Split pieces at override boundaries so bold-off only affects the selection
              for (const ov of editStyleOverrides) {
                if (ov.end <= ov.start) continue;
                const next: Piece[] = [];
                for (const p of pieces) {
                  if (ov.end <= p.start || ov.start >= p.end) {
                    next.push(p);
                    continue;
                  }
                  if (ov.start > p.start) {
                    next.push({
                      ...p,
                      end: ov.start,
                      text: p.text.slice(0, ov.start - p.start),
                    });
                  }
                  const midStart = Math.max(p.start, ov.start);
                  const midEnd = Math.min(p.end, ov.end);
                  next.push({
                    ...p,
                    start: midStart,
                    end: midEnd,
                    text: p.text.slice(midStart - p.start, midEnd - p.start),
                  });
                  if (ov.end < p.end) {
                    next.push({
                      ...p,
                      start: ov.end,
                      text: p.text.slice(ov.end - p.start),
                    });
                  }
                }
                pieces = next.filter(p => p.text.length > 0 || p.end > p.start);
              }

              const overlaySegments: OverlaySegmentStyle[] = pieces.map((piece) => {
                const run = piece.run;
                const fd = renderResult.fonts.get(run.fontName);
                const flags = resolveRunStyleFlags(run.fontName, fd);
                let bold = flags.bold;
                let italic = flags.italic;
                let underline = !!run.isUnderline || runHasPathUnderline(run, pathItems);
                let color = run.fillColor
                  ? `rgb(${Math.round(run.fillColor[0] * 255)}, ${Math.round(run.fillColor[1] * 255)}, ${Math.round(run.fillColor[2] * 255)})`
                  : colorCss;
                let segFontSize = visualFontSize(run) * scale;
                let segFontFamily = getOverlayFontFamily(run.fontName, fd);

                for (const ov of editStyleOverrides) {
                  if (piece.start >= ov.start && piece.end <= ov.end) {
                    if (ov.bold != null) bold = ov.bold;
                    if (ov.italic != null) italic = ov.italic;
                    if (ov.underline != null) underline = ov.underline;
                    if (ov.color) color = ov.color.startsWith('#') ? ov.color : color;
                    if (ov.fontSize != null) segFontSize = ov.fontSize * scale;
                    if (ov.fontFamily) segFontFamily = cssFontFamilyFromUI(ov.fontFamily);
                  }
                }

                return {
                  text: piece.text,
                  fontFamily: segFontFamily,
                  fontSizeCss: segFontSize,
                  fontWeight: bold ? 'bold' : 'normal',
                  fontStyle: italic ? 'italic' : 'normal',
                  underline,
                  color,
                };
              });

              return (
                <EditableLineBox
                  left={left}
                  top={top}
                  naturalWidth={naturalWidth}
                  naturalHeight={naturalHeight}
                  fontSizeCss={fontSizeCss}
                  fontFamily={getOverlayFontFamily(primaryRun?.fontName || '', fontData)}
                  fontWeight={textBold ? 'bold' : 'normal'}
                  fontStyle={textItalic ? 'italic' : 'normal'}
                  underline={textUnderline}
                  color={colorCss}
                  segments={overlaySegments}
                  text={editText}
                  caretStart={editSel.start}
                  caretEnd={editSel.end}
                  textRef={hiddenInputRef}
                  onTextInput={handleHiddenInput}
                  onKeyDown={handleHiddenKeyDown}
                  onSelect={handleEditSelection}
                  onBlur={handleHiddenBlur}
                  offsetCssX={editOffsetCss.x}
                  offsetCssY={editOffsetCss.y}
                  manualWidth={editManualSize.w}
                  manualHeight={editManualSize.h}
                  onOffsetChange={(x, y) => setEditOffsetCss({ x, y })}
                  onSizeChange={(w, h) => setEditManualSize({ w, h })}
                />
              );
            })()}

            {/* Link hover / edit popovers on the PDF (after Scan for links) */}
            {linksHighlighted && selectedLink && linkPopoverMode && renderResult && doc && (() => {
              const page = doc.pages[currentPage];
              const { mediaBox } = page;
              const topLeft = pdfToCanvas(
                selectedLink.rect.x,
                selectedLink.rect.y + selectedLink.rect.height,
                scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
              );
              const bottomRight = pdfToCanvas(
                selectedLink.rect.x + selectedLink.rect.width,
                selectedLink.rect.y,
                scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
              );
              const bx = Math.min(topLeft.cssX, bottomRight.cssX);
              const by = Math.min(topLeft.cssY, bottomRight.cssY);
              const bw = Math.abs(bottomRight.cssX - topLeft.cssX);
              const bh = Math.abs(bottomRight.cssY - topLeft.cssY);
              return (
                <LinkPopover
                  mode={linkPopoverMode}
                  anchorX={bx + bw / 2}
                  anchorY={by + bh}
                  url={linkDraftUrl}
                  displayText={linkDisplayDraft}
                  onUrlChange={setLinkDraftUrl}
                  onDisplayChange={setLinkDisplayDraft}
                  onEdit={() => {
                    if (linkHoverTimerRef.current) {
                      clearTimeout(linkHoverTimerRef.current);
                      linkHoverTimerRef.current = null;
                    }
                    setLinkPopoverMode('edit');
                  }}
                  onOpen={() => {
                    const url = (linkDraftUrl || selectedLink.url || '').trim();
                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                  onRemove={removeLinkFromPopover}
                  onClose={() => { void saveLinkFromPopover(true); }}
                  onPopoverEnter={() => {
                    linkPopoverHoverRef.current = true;
                    if (linkHoverTimerRef.current) {
                      clearTimeout(linkHoverTimerRef.current);
                      linkHoverTimerRef.current = null;
                    }
                  }}
                  onPopoverLeave={() => {
                    linkPopoverHoverRef.current = false;
                    if (linkPopoverMode === 'hover') scheduleLinkHoverClose();
                  }}
                />
              );
            })()}
          </div>
          </div>
        </div>

        {/* ── Right Sidebar: Page Thumbnails ── */}
        <ThumbnailsSidebar
          totalPages={totalPages}
          currentPage={currentPage}
          thumbnails={thumbnails}
          isGeneratingThumbnails={isGeneratingThumbnails}
          onPageSelect={(i) => {
            commitDrawingsToPdf();
            closeLinkPopover();
            setLinkCreatePending(false);
            setCurrentPage(i);
          }}
          onDeletePage={handleDeletePage}
          onInsertBlankPage={handleInsertBlankPage}
          onInsertPdf={handleInsertPdf}
          onRotatePage={handleRotatePage}
          onReorderPages={handleReorderPages}
          onMergePdf={handleMergePdf}
          onSplitCurrentPage={handleSplitCurrentPage}
          onSplitAllPages={handleSplitAllPages}
          onRemoveCurrentPage={handleRemoveCurrentPage}
        />
      </div>

      {/* ── Bottom status bar ── */}
      <div className="shrink-0">
        <StatusBar
          renderResult={renderResult}
          activeTool={activeTool}
          selectedRun={selectedLine?.runs[0] ?? null}
          doc={doc}
          totalPages={totalPages}
        />
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-red-500/10 backdrop-blur-md border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-4 shadow-xl z-[100] animate-in slide-in-from-bottom-5 fade-in">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}
      {isConfirmingRemoval && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 shadow-2xl max-w-sm w-full">
            <h3 className="text-white font-medium text-lg mb-2">Remove Watermarks</h3>
            <p className="text-zinc-400 text-sm mb-6">
              Do you really want to remove the detected watermarks from this document? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setIsConfirmingRemoval(false)}
                className="px-4 py-2 rounded font-medium text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeRemoveWatermarks}
                className="px-4 py-2 rounded font-medium text-sm bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {showApplySuccessModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 shadow-2xl max-w-sm w-full text-center">
            <h3 className="text-white font-medium text-lg mb-4">Watermark Applied</h3>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
              Watermark has been applied and live preview is off. To add more watermarks, turn on the live preview to preview it live.
            </p>
            <button
              onClick={() => setShowApplySuccessModal(false)}
              className="w-full px-4 py-2.5 rounded font-medium text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Okay
            </button>
          </div>
        </div>
      )}

      <SignatureCreateDialog
        open={signatureCreateOpen}
        onOpenChange={setSignatureCreateOpen}
        onSave={handleSignatureCreateSave}
      />
      <CertificateImportDialog
        open={certificateImportOpen}
        onOpenChange={setCertificateImportOpen}
        onChange={(list) => {
          setCertificateIdentities(list);
          setSelectedCertificateId(getCertificateManager().getSelected()?.id ?? null);
        }}
      />

      {/* ── Export Panel ── */}
      <ExportPanel
        isOpen={showExportPanel}
        onClose={() => setShowExportPanel(false)}
        doc={doc}
        engine={engineModule}
        fileName={fileName}
        totalPages={totalPages}
        currentPage={currentPage}
      />
    </div>
  );
}
