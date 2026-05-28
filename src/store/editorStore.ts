import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { savePdfToStorage } from '@/lib/pdfStorage';
import type { ToolType, ToolOptions, PageOverlay, HistoryEntry } from '@/types/editor';

interface EditorState {
  // Document
  pdfFile: File | null;
  pdfBytes: ArrayBuffer | null;
  pdfFileName: string | null;
  pageCount: number;
  currentPage: number; // 1-based

  // Canvas overlays keyed by 0-based page index
  pageOverlays: Record<number, PageOverlay>;

  // ── TRUE INLINE TEXT EDITS (Adobe "Edit PDF" mode) ──
  // pageIndex → blockId → edited text
  textEdits: Record<number, Record<string, string>>;

  // Active tool
  activeTool: ToolType;
  toolOptions: ToolOptions;

  // History (undo/redo)
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];

  // UI state
  zoom: number;
  sidebarOpen: boolean;
  propertiesPanelOpen: boolean;
  searchOpen: boolean;
  signatureDialogOpen: boolean;
  watermarkDialogOpen: boolean;
  exportDialogOpen: boolean;
  pageManagerOpen: boolean;

  // Actions
  setPdfFile: (file: File, bytes: ArrayBuffer, pageCount: number) => void;
  restorePdf: (bytes: ArrayBuffer, fileName: string, pageCount: number) => void;
  setCurrentPage: (page: number) => void;
  setActiveTool: (tool: ToolType) => void;
  setToolOption: <K extends keyof ToolOptions>(key: K, value: ToolOptions[K]) => void;
  setPageOverlay: (pageIndex: number, json: string) => void;
  setTextEdit: (pageIndex: number, blockId: string, text: string) => void;
  deletePage: (pageIndex: number) => Promise<void>;
  pushHistory: (entry: HistoryEntry) => void;
  undo: () => HistoryEntry | undefined;
  redo: () => HistoryEntry | undefined;
  setZoom: (zoom: number) => void;
  setSidebarOpen: (open: boolean) => void;
  setPropertiesPanelOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
  setSignatureDialogOpen: (open: boolean) => void;
  setWatermarkDialogOpen: (open: boolean) => void;
  setExportDialogOpen: (open: boolean) => void;
  setPageManagerOpen: (open: boolean) => void;
  reset: () => void;
}

const defaultToolOptions: ToolOptions = {
  color: '#000000',
  fillColor: 'transparent',
  strokeWidth: 2,
  fontSize: 16,
  fontFamily: 'Arial',
  fontBold: false,
  fontItalic: false,
  opacity: 1,
  stampType: 'APPROVED',
};

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => ({
  pdfFile: null,
  pdfBytes: null,
  pdfFileName: null,
  pageCount: 0,
  currentPage: 1,
  pageOverlays: {},
  textEdits: {},
  activeTool: 'select',
  toolOptions: defaultToolOptions,
  undoStack: [],
  redoStack: [],
  zoom: 1,
  sidebarOpen: true,
  propertiesPanelOpen: false,
  searchOpen: false,
  signatureDialogOpen: false,
  watermarkDialogOpen: false,
  exportDialogOpen: false,
  pageManagerOpen: false,

  setPdfFile: (file, bytes, pageCount) => {
    savePdfToStorage(bytes, file.name).catch(console.error);
    set({ pdfFile: file, pdfBytes: bytes, pdfFileName: file.name, pageCount, currentPage: 1, pageOverlays: {}, textEdits: {}, undoStack: [], redoStack: [] });
  },

  restorePdf: (bytes, fileName, pageCount) => {
    const file = new File([bytes], fileName, { type: 'application/pdf' });
    set({ pdfFile: file, pdfBytes: bytes, pdfFileName: fileName, pageCount });
  },

  setCurrentPage: (page) => set({ currentPage: page }),

  setActiveTool: (tool) => set({ activeTool: tool }),

  setToolOption: (key, value) =>
    set((state) => ({ toolOptions: { ...state.toolOptions, [key]: value } })),

  setPageOverlay: (pageIndex, json) =>
    set((state) => ({ pageOverlays: { ...state.pageOverlays, [pageIndex]: { json } } })),

  setTextEdit: (pageIndex, blockId, text) =>
    set((state) => ({
      textEdits: {
        ...state.textEdits,
        [pageIndex]: {
          ...(state.textEdits[pageIndex] ?? {}),
          [blockId]: text,
        },
      },
    })),

  deletePage: async (pageIndex) => {
    const { pdfBytes, pageCount, pageOverlays, textEdits, currentPage, pdfFileName } = get();
    if (!pdfBytes || pageCount <= 1) return;
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(pdfBytes);
    doc.removePage(pageIndex);
    const out = await doc.save();
    const newBytes = out.buffer.slice(
      out.byteOffset,
      out.byteOffset + out.byteLength
    ) as ArrayBuffer;

    const shift = <T,>(src: Record<number, T>): Record<number, T> => {
      const dst: Record<number, T> = {};
      Object.entries(src).forEach(([k, v]) => {
        const i = Number(k);
        if (i === pageIndex) return;
        dst[i > pageIndex ? i - 1 : i] = v;
      });
      return dst;
    };

    const newCount = pageCount - 1;
    const newCurrent = Math.min(Math.max(1, currentPage), newCount);
    const newFile = pdfFileName ? new File([newBytes], pdfFileName, { type: 'application/pdf' }) : null;

    set({
      pdfBytes: newBytes,
      pdfFile: newFile ?? get().pdfFile,
      pageCount: newCount,
      currentPage: newCurrent,
      pageOverlays: shift(pageOverlays),
      textEdits: shift(textEdits),
      undoStack: [],
      redoStack: [],
    });
    if (pdfFileName) {
      savePdfToStorage(newBytes, pdfFileName).catch(console.error);
    }
  },

  pushHistory: (entry) =>
    set((state) => ({
      undoStack: [...state.undoStack.slice(-49), entry],
      redoStack: [],
    })),

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return undefined;
    const entry = undoStack[undoStack.length - 1];
    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, entry],
    }));
    return entry;
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return undefined;
    const entry = redoStack[redoStack.length - 1];
    set((state) => ({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, entry],
    }));
    return entry;
  },

  setZoom: (zoom) => set({ zoom }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setPropertiesPanelOpen: (open) => set({ propertiesPanelOpen: open }),
  setSearchOpen: (open) => set({ searchOpen: open }),
  setSignatureDialogOpen: (open) => set({ signatureDialogOpen: open }),
  setWatermarkDialogOpen: (open) => set({ watermarkDialogOpen: open }),
  setExportDialogOpen: (open) => set({ exportDialogOpen: open }),
  setPageManagerOpen: (open) => set({ pageManagerOpen: open }),

  reset: () =>
    set({
      pdfFile: null,
      pdfBytes: null,
      pdfFileName: null,
      pageCount: 0,
      currentPage: 1,
      pageOverlays: {},
      textEdits: {},
      activeTool: 'select',
      toolOptions: defaultToolOptions,
      undoStack: [],
      redoStack: [],
      zoom: 1,
      searchOpen: false,
    }),
    }),
    {
      name: 'pdf-editor-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        pdfFileName: state.pdfFileName,
        pageCount: state.pageCount,
        currentPage: state.currentPage,
        pageOverlays: state.pageOverlays,
        textEdits: state.textEdits,
        zoom: state.zoom,
      }),
    }
  )
);
