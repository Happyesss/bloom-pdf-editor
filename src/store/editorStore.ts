import { create } from 'zustand';
import type { ToolType, ToolOptions, PageOverlay, HistoryEntry } from '@/types/editor';

interface EditorState {
  // Document
  pdfFile: File | null;
  pdfBytes: ArrayBuffer | null;
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
  setCurrentPage: (page: number) => void;
  setActiveTool: (tool: ToolType) => void;
  setToolOption: <K extends keyof ToolOptions>(key: K, value: ToolOptions[K]) => void;
  setPageOverlay: (pageIndex: number, json: string) => void;
  setTextEdit: (pageIndex: number, blockId: string, text: string) => void;
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
};

export const useEditorStore = create<EditorState>((set, get) => ({
  pdfFile: null,
  pdfBytes: null,
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

  setPdfFile: (file, bytes, pageCount) =>
    set({ pdfFile: file, pdfBytes: bytes, pageCount, currentPage: 1, pageOverlays: {}, textEdits: {}, undoStack: [], redoStack: [] }),

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
}));;
