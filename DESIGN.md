# PDF Editor — Product Design Document

> Next.js · TypeScript · No Database · Fully Client-Side

---

## 1. Problem Statement — What People Struggle With Every Day

Research from developer forums, productivity communities, and user feedback surfaces these recurring pain points:

| # | Problem | Pain Level |
|---|---------|-----------|
| 1 | **Cannot edit text in-place** — PDFs are "read-only" by design; most free tools don't allow clicking into a sentence and changing a word | 🔴 Critical |
| 2 | **Font/style mismatch after edit** — When tools do allow text edits, the replacement font looks different from the original | 🔴 Critical |
| 3 | **Scanned PDFs are images, not text** — A scanned invoice or contract has zero selectable text without OCR | 🔴 Critical |
| 4 | **Expensive proprietary software** — Adobe Acrobat Pro costs ~$24/month; most users just need occasional edits | 🔴 Critical |
| 5 | **No free, browser-based end-to-end editor** — Most online tools only do one thing (compress, merge, convert) | 🟠 High |
| 6 | **Annotation chaos** — Highlights and comments don't embed properly; colleagues open the file and see nothing | 🟠 High |
| 7 | **Form filling on non-interactive PDFs** — Government or bank forms that are images require printing → fill by hand → scan back | 🟠 High |
| 8 | **Redaction that isn't permanent** — Users draw a black rectangle over text but the underlying text is still selectable/copy-pasteable | 🟠 High |
| 9 | **No undo/redo** — Accidental deletions or marks with no way back | 🟡 Medium |
| 10 | **Page management pain** — Can't easily reorder, rotate, or delete individual pages without buying software | 🟡 Medium |
| 11 | **Adding images/stamps** — Inserting a company logo or rubber-stamp signature is needlessly complex | 🟡 Medium |
| 12 | **Digital signatures** — Drawing or typing a signature and embedding it as an image in the correct spot | 🟡 Medium |
| 13 | **Search & replace text** — Finding a word across many pages and bulk-replacing it | 🟡 Medium |
| 14 | **Watermarks** — Adding or removing "DRAFT / CONFIDENTIAL" watermarks | 🟡 Medium |
| 15 | **Password-protected PDFs** — Cannot open or edit locked documents without the password | 🟡 Medium |
| 16 | **Cross-device inconsistency** — PDF looks different on Windows vs macOS vs mobile | 🟢 Low |
| 17 | **No collaborative review workflow** — Can't share a link and have others comment in real-time | 🟢 Low |

---

## 2. Solution — Browser-Based Full PDF Editor

A **Next.js 14 App Router** application that runs entirely in the browser.  
No server processing. No database. Files never leave the user's device.

---

## 3. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | **Next.js 14** (App Router) | Routing, SSR layout, API routes |
| Language | **TypeScript** | Type safety across all layers |
| Styling | **Tailwind CSS** + shadcn/ui | Utility-first responsive UI |
| PDF Rendering | **PDF.js** (Mozilla) | Render each PDF page to `<canvas>` |
| PDF Manipulation | **pdf-lib** | Modify PDF internals, embed text/images |
| Canvas Overlay | **Fabric.js** | Interactive annotation layer on top of rendered pages |
| State Management | **Zustand** | Global editor state, history stack |
| File Upload | **react-dropzone** | Drag-and-drop upload |
| Signatures | **react-signature-canvas** | Draw signatures |
| Icons | **lucide-react** | Clean SVG icons |
| Storage | **Browser Memory / Blob URLs** | Zero server storage |

---

## 4. Feature Breakdown

### 4.1 Core Features (MVP)

#### F-01 · Upload & Display
- Drag-and-drop or click-to-browse PDF upload
- Renders all pages as canvas elements via PDF.js
- Thumbnail sidebar for all pages
- Zoom in / out / fit-to-width
- Page navigation (jump to page #)

#### F-02 · Text Editing
- Click any text element on the page to select it
- Inline text editor pops up with the exact content
- Change text, font size, color
- Overlay mechanism: the edit is stored as a Fabric.js text overlay; the original page content is obscured with a white rectangle, and the new text is drawn on top
- Supports multiline text blocks

#### F-03 · Add Text Box
- Toolbar button: "Add Text"
- Click anywhere to place a new draggable, resizable text box
- Font family, size, color, bold/italic controls in properties panel

#### F-04 · Annotations
- **Highlight** — Yellow (or color-picker) translucent rectangle over text
- **Underline** — Blue line beneath selected text region
- **Strikethrough** — Red line through selected text region
- **Comment/Sticky Note** — Anchored comment bubble with text

#### F-05 · Drawing Tools
- Freehand pen (color, stroke width)
- Straight line, arrow
- Rectangle, ellipse (fill + stroke)
- Eraser

#### F-06 · Image Insertion
- Upload image (PNG, JPG, SVG) and place it on a page
- Drag, resize, rotate the image
- Bring to front / send to back

#### F-07 · Page Management
- Thumbnail sidebar with drag-to-reorder
- Rotate page (90°, 180°, 270°)
- Delete page
- Duplicate page
- Insert blank page
- Extract selected pages as new PDF

#### F-08 · Forms & Fields
- Detect existing AcroForm fields and make them fillable
- Add new text field, checkbox, radio button, dropdown
- Tab-through-fields navigation

#### F-09 · Signatures
- **Draw** signature on canvas (react-signature-canvas)
- **Type** signature (stylized font rendering)
- **Upload** image as signature
- Place signature anywhere on the page; drag and resize

#### F-10 · Redaction
- Select region → "Redact" button permanently blacks out the area
- The underlying content in that bounding box is replaced (not just covered) before export

#### F-11 · Search & Replace
- `Ctrl+F` opens search panel
- Highlights all matches across all pages
- Replace one / replace all

#### F-12 · Watermark
- Add text watermark (diagonal/center, opacity, font, color)
- Add image watermark (logo overlay with opacity)

#### F-13 · Export / Download
- Download the modified PDF with all overlays baked in
- Choose quality / compression
- Download as individual pages (PNG/JPG)

### 4.2 Nice-to-Have (Post-MVP)
- Password protect / remove password
- Merge multiple PDFs
- Split PDF into individual pages
- Dark mode
- Keyboard shortcuts panel

---

## 5. Application Architecture

```
pdf-editor/
├── src/
│   ├── app/
│   │   ├── layout.tsx            ← Root layout (fonts, providers)
│   │   ├── page.tsx              ← Landing/Upload page
│   │   └── editor/
│   │       └── page.tsx          ← Main editor page
│   ├── components/
│   │   ├── upload/
│   │   │   └── DropZone.tsx      ← Drag-and-drop upload
│   │   ├── editor/
│   │   │   ├── EditorLayout.tsx  ← Main editor shell
│   │   │   ├── Toolbar.tsx       ← Top toolbar
│   │   │   ├── Sidebar.tsx       ← Page thumbnails + panel
│   │   │   ├── PageCanvas.tsx    ← Single PDF page (PDF.js + Fabric overlay)
│   │   │   ├── PageList.tsx      ← All pages scrollable view
│   │   │   └── PropertiesPanel.tsx ← Right panel for selected object
│   │   ├── tools/
│   │   │   ├── TextTool.tsx
│   │   │   ├── AnnotationTool.tsx
│   │   │   ├── DrawingTool.tsx
│   │   │   ├── SignatureTool.tsx
│   │   │   ├── RedactionTool.tsx
│   │   │   └── WatermarkTool.tsx
│   │   ├── dialogs/
│   │   │   ├── SearchReplaceDialog.tsx
│   │   │   ├── PageManagerDialog.tsx
│   │   │   └── ExportDialog.tsx
│   │   └── ui/                   ← shadcn/ui re-exports
│   ├── hooks/
│   │   ├── usePdfDocument.ts     ← Load & parse PDF with PDF.js
│   │   ├── useFabricCanvas.ts    ← Fabric.js canvas lifecycle
│   │   ├── useEditorHistory.ts   ← Undo / redo stack
│   │   └── useExport.ts          ← Bake overlays → pdf-lib → download
│   ├── store/
│   │   └── editorStore.ts        ← Zustand global state
│   ├── lib/
│   │   ├── pdfUtils.ts           ← pdf-lib helpers
│   │   ├── fabricUtils.ts        ← Fabric.js helpers
│   │   └── constants.ts          ← Tool names, defaults
│   └── types/
│       └── editor.ts             ← Shared TypeScript types
├── public/
│   └── pdf.worker.min.js         ← PDF.js worker (copied from node_modules)
├── DESIGN.md                     ← This document
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## 6. Editor State (Zustand)

```typescript
interface EditorStore {
  // Document
  pdfFile: File | null
  pdfDocument: PDFDocumentProxy | null   // pdf.js parsed doc
  pageCount: number
  currentPage: number

  // Canvas overlays (per page)
  pageOverlays: Record<number, FabricJSON>   // serialized Fabric canvas per page

  // Active tool
  activeTool: ToolType   // 'select' | 'text' | 'draw' | 'highlight' | ...
  toolOptions: ToolOptions

  // History
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]

  // UI
  zoom: number
  sidebarOpen: boolean
  propertiesPanelOpen: boolean
}
```

---

## 7. Edit-and-Export Flow

```
1. User uploads PDF
        ↓
2. PDF.js renders each page to <canvas> (read-only)
        ↓
3. Fabric.js overlay canvas is mounted on top (same width/height)
        ↓
4. User edits: every action creates Fabric objects (text, shapes, images)
        ↓
5. Export triggered:
   a. For each page, Fabric canvas is serialized to PNG (toDataURL)
   b. pdf-lib loads the original PDF bytes
   c. For each page, the overlay PNG is drawn on top using pdf-lib
   d. Redacted regions: solid black rectangles drawn by pdf-lib before embedding
   e. Final PDF bytes are Blob-downloaded to user's device
```

---

## 8. UI/UX Design Principles

- **Google Docs / Figma feel** — familiar toolbar + canvas editing paradigm
- **Dark sidebar, light canvas** — focus stays on the document
- **Contextual toolbar** — toolbar items change based on selected object type
- **Keyboard shortcuts** — `V` select, `T` text, `D` draw, `H` highlight, `S` sign, `Ctrl+Z` undo, `Ctrl+Y` redo, `Ctrl+F` search, `Ctrl+S` save/download
- **Mobile responsive** — toolbar collapses to bottom sheet on small screens
- **Accessibility** — ARIA labels, keyboard navigation through pages and tools

---

## 9. Security & Privacy

- **Zero server uploads** — PDF bytes never leave the browser
- **All processing is client-side** — pdf-lib and PDF.js run in the browser
- **No analytics or tracking**
- **Content Security Policy** headers set in `next.config.js`

---

## 10. Implementation Phases

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Project scaffold + PDF.js rendering + upload | 🔲 TODO |
| **Phase 2** | Fabric overlay + select + add text + draw tools | 🔲 TODO |
| **Phase 3** | Annotations (highlight, underline, strikethrough) | 🔲 TODO |
| **Phase 4** | Signatures, image insertion, watermark | 🔲 TODO |
| **Phase 5** | Page management, redaction, search & replace | 🔲 TODO |
| **Phase 6** | Export bake-down with pdf-lib | 🔲 TODO |
| **Phase 7** | Polish, keyboard shortcuts, responsive | 🔲 TODO |
