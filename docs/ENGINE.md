# 🔬 Bloom Engine — Deep Dive

This document provides a detailed, accurate description of every engine in the Bloom PDF Editor. All information is sourced directly from the codebase — no external claims or aspirational features.

---

## Table of Contents

- [Client-Side Engine (`src/engine/`)](#client-side-engine-srcengine)
  - [Core Types](#core-types)
  - [Parser](#parser)
  - [Content Interpreter](#content-interpreter)
  - [Font System](#font-system)
  - [Renderer](#renderer)
  - [Flow Engine](#flow-engine)
  - [Bloom Document Model](#bloom-document-model)
  - [Editor](#editor)
  - [Writer](#writer)
  - [Signatures](#signatures)
  - [Security](#security)
  - [Forms](#forms)
  - [Editing Infrastructure](#editing-infrastructure)
  - [Color](#color)
  - [Watermark](#watermark)
  - [AI](#ai)
  - [Optimize](#optimize)
  - [OCR (Client)](#ocr-client)
  - [Accessibility](#accessibility)
- [Server-Side Engine (`server/src/engines/`)](#server-side-engine-serversrcengines)
  - [Parser Engine (Server)](#parser-engine-server)
  - [Layout Engine](#layout-engine)
  - [OCR / Recognition Fusion](#ocr--recognition-fusion)
  - [IDM Engine (Intermediate Document Model)](#idm-engine-intermediate-document-model)
  - [Typography Analyzer](#typography-analyzer)
  - [Semantic Structure Engine](#semantic-structure-engine)
  - [Table Detection Engine](#table-detection-engine)
  - [Graphics Reconstruction Engine](#graphics-reconstruction-engine)
  - [Document Structure Engine](#document-structure-engine)
  - [UDM (Unified Document Model)](#udm-unified-document-model)
  - [Export Manager & Plugin SDK](#export-manager--plugin-sdk)
- [Infrastructure](#infrastructure)
  - [Dependency Injection Container](#dependency-injection-container)
  - [Job Queue](#job-queue)
  - [Conversion Worker Pipeline](#conversion-worker-pipeline)
  - [Storage](#storage)
  - [Telemetry](#telemetry)

---

## Client-Side Engine (`src/engine/`)

The client engine is a **dependency-free TypeScript PDF engine** that runs entirely in the browser. It exports 730+ symbols from its public API (`src/engine/index.ts`).

### Core Types

**File:** `src/engine/types.ts`

PDF files are built from a small set of primitive types. Bloom models each as a distinct TypeScript class so `instanceof` checks work throughout the codebase:

| Class | PDF Equivalent | Description |
|-------|---------------|-------------|
| `PDFName` | `/Name` | Immutable name object (e.g., `/Type`, `/Font`) |
| `PDFString` | `(string)` | Literal string, with `toBytes()` for binary access |
| `PDFHexString` | `<hex>` | Hex-encoded string with `toBytes()` and `toText()` |
| `PDFNumber` | `123` / `1.5` | Numeric value wrapper |
| `PDFBoolean` | `true` / `false` | Boolean wrapper |
| `PDFNull` | `null` | Singleton null value |
| `PDFRef` | `1 0 R` | Indirect object reference (object number + generation number) |
| `PDFArray` | `[...]` | Ordered collection of PDF objects, with `asNumbers()` helper |
| `PDFDict` | `<< ... >>` | Key-value dictionary backed by `Map<string, PDFObject>`, with typed accessors (`getName()`, `getNumber()`, `getArray()`, `getDict()`, `getRef()`, etc.) |
| `PDFStream` | `stream...endstream` | Dictionary + raw bytes + optional decoded bytes, with `getFilters()` and `getDecodeParams()` |

**Union type:** `PDFObject = PDFBoolean | PDFNumber | PDFString | PDFHexString | PDFName | PDFNull | PDFArray | PDFDict | PDFStream | PDFRef`

**Higher-level structures:**
- `XRefEntry` — Cross-reference entry with offset, type (`'n'` or `'f'`), and optional compressed object info
- `XRefTable` — `Map<string, XRefEntry>` keyed by `"objNum_genNum"` plus trailer dictionary
- `PDFPageInfo` — Page metadata: dictionary, MediaBox, CropBox, rotation, resources, content refs
- `PDFDocumentData` — Top-level parsed document: version, all objects (`Map<string, PDFObject>`), xref, catalog, pages, info, raw bytes

---

### Parser

**Files:** `src/engine/parser/parser.ts`, `lexer.ts`, `filters.ts`, `xref.ts`

The parser operates directly on raw `Uint8Array` PDF bytes:

1. **Lexer** (`PDFLexer`) — Tokenizes the byte stream into `Token` objects with types: `Number`, `String`, `HexString`, `Name`, `Boolean`, `Null`, `ArrayStart`, `ArrayEnd`, `DictStart`, `DictEnd`, `Ref`, `Obj`, `EndObj`, `Stream`, `EndStream`, `XRef`, `Trailer`, `StartXRef`, `Comment`, `EOF`

2. **Parser** (`parsePDF`) — Recursive descent parser that:
   - Reads the PDF header to extract version
   - Parses the cross-reference table (both table-format and stream-format xrefs)
   - Resolves all indirect objects into a `Map<string, PDFObject>`
   - Walks the page tree to build `PDFPageInfo[]`
   - Returns a complete `PDFDocumentData`

3. **Reference resolution** (`resolveRef`, `deepResolve`) — Follows `PDFRef` chains through the object map

4. **Filters** (`applyFilters`, `flateEncode`) — Decompresses stream data (FlateDecode, ASCII85Decode, ASCIIHexDecode, RunLengthDecode, LZWDecode, etc.)

---

### Content Interpreter

**Files:** `src/engine/content/operator-lexer.ts`, `interpreter.ts`

The content stream interpreter executes PDF drawing operators to produce display items:

- **Operator Lexer** (`parseContentStream`) — Parses content stream bytes into `CSInstruction[]` (operator + operands)
- **Interpreter** (`interpretPage`) — Walks instructions maintaining a `GraphicsState` stack:
  - **Text operators** (Tj, TJ, Tf, Tm, Td, T*, etc.) → `TextRun` objects with `GlyphPosition[]`
  - **Path operators** (m, l, c, re, h, S, f, etc.) → `PathItem` objects with `PathSegment[]`
  - **Image operators** (Do for XObjects) → `ImageItem` objects
  - **State operators** (q, Q, cm, gs, etc.) → Graphics state push/pop/transform

**Key type:** `InterpreterResult = { texts: TextRun[], paths: PathItem[], images: ImageItem[] }`

---

### Font System

**Files:** `src/engine/fonts/font-parser.ts`, `standard14.ts`, `cmap-parser.ts`, `truetype-parser.ts`, `gsub.ts`, `gpos.ts`, `measurement.ts`, `font-augmentation.ts`

The font system handles everything from the 14 standard PDF fonts to embedded TrueType/OpenType binaries:

- **Font loading** (`loadPageFonts`, `loadFont`) — Resolves font dictionaries from page resources
- **Character mapping** (`charCodeToUnicode`) — Maps character codes to Unicode via ToUnicode CMaps, encoding dictionaries, or built-in mappings
- **Standard 14** (`getStandardFont`, `getCSSFontFamily`) — Built-in metrics for Helvetica, Times-Roman, Courier, Symbol, ZapfDingbats, and their variants
- **CMap parser** (`parseCMap`) — Parses both predefined and embedded CMap programs for CIDFont character mapping
- **TrueType parser** (`parseTTF`) — Reads binary TTF/OTF tables: `head`, `hhea`, `maxp`, `cmap`, `loca`, `glyf`, `hmtx`, `name`, `OS/2`, `post`, `GSUB`, `GPOS`, and `kern`
  - `getGlyphOutline` — Extracts glyph contours as `GlyphCommand[]` (moveTo, lineTo, quadTo, cubicTo)
  - `charCodeToGlyphId` — Maps through cmap subtable formats 0, 4, 6, 12
  - `getGlyphWidth` — Reads horizontal metrics from `hmtx`
- **GSUB** (`parseGSUBLigatures`, `applyLigatures`) — Parses OpenType ligature substitution rules and applies them during text shaping
- **GPOS** (`parseGPOSPairAdjustments`, `lookupGPOSPair`) — Reads pair positioning adjustments (kerning) and mark-to-base attachments
- **Measurement** (`measureTextLine`, `measureTextRange`) — Calculates text metrics using font metrics + shaping results
- **Font augmentation** (`ensureFallbackFont`, `augmentFontsForMissingGlyphs`) — Handles missing glyph fallback and ToUnicode CMap generation

---

### Renderer

**Files:** `src/engine/render/renderer.ts`, `color-space.ts`, `graphics-state.ts`, `transparency.ts`, `soft-mask.ts`, `patterns.ts`, `clipping.ts`, `shading.ts`, `type3.ts`

Full Canvas 2D rendering pipeline:

- **Page rendering** (`renderPage`, `renderPageToCanvas`, `renderAllPages`) — Renders PDF pages to HTML Canvas elements at configurable DPI
- **Color spaces** (`parseColorSpace`, `cmykToRGB`, `componentsToCSSColor`) — Supports DeviceRGB, DeviceCMYK, DeviceGray, CalRGB, CalGray, Lab, ICCBased (via ICC profile parsing), Indexed, Separation, DeviceN, Pattern
- **Graphics state** (`GraphicsStateStack`) — Maintains the CTM (Current Transformation Matrix), color, line width, dash pattern, font, etc. as a pushable/poppable stack
- **Transparency** (`toCanvasBlendMode`, `compositeOver`) — Maps PDF blend modes to Canvas composite operations
- **Soft masks** (`parseSoftMask`, `effectiveAlpha`) — Handles luminosity and alpha soft masks for transparency groups
- **Patterns** (`parseTilingPattern`, `createCanvasPattern`) — Renders tiling patterns (colored and uncolored paint types)
- **Clipping** (`applyClipPaths`) — Applies even-odd and non-zero winding clipping paths
- **Shading** (`interpolateShading`, `axialParameter`) — Renders axial (linear) and radial gradients
- **Type 3 fonts** — Renders Type 3 font CharProcs as small content streams

---

### Flow Engine

**Files:** `src/engine/flow/` (multiple files)

Converts positioned text runs into an editable line/paragraph model:

- **Line reconstruction** (`reconstructLines`) — Groups `TextRun` objects into `TextLine[]` based on vertical position and baseline alignment
- **Paragraph detection** (`reconstructParagraphs`) — Groups lines into `Paragraph[]` based on spacing gaps
- **Document flow** (`buildDocumentFlow`) — Full pipeline: text runs → lines → paragraphs → `DocumentFlow`
- **Line breaking** — Three algorithms:
  - `greedyWrap` — Simple greedy line breaking
  - `knuthPlassWrap` — Optimal line breaking using the Knuth-Plass algorithm (minimizes total demerits)
  - `hyphenateBreaks` — Hyphenation-aware breaking
- **BiDi** (`resolveBidiLevels`, `reorderForDisplay`) — Unicode Bidirectional Algorithm implementation for mixed LTR/RTL text
- **Justification** (`analyzeJustification`, `distributeJustifiedSpace`, `distributeGlue`) — Full justification with glue distribution and optical margin adjustment
- **Text shaping** (`shapeText`, `measureText`, `layoutShapedGlyphs`) — Glyph-level text layout with GSUB/GPOS
- **Grapheme clusters** (`graphemeClusters`, `moveCaret`, `snapCaretToGrapheme`) — Proper caret movement respecting grapheme cluster boundaries
- **Hit testing** (`hitTestTextLine`, `findNearestTextLine`, `caretIndexFromLineX`) — Click-to-caret and spatial text queries
- **Style editing** (`applyStyleToSelection`, `applyStyleToLine`) — Bold, italic, underline, font size, color changes applied to text ranges
- **Table detection** (`detectTablesOnPage`, `hitTestTableCell`, `getTableRowLines`) — Client-side table structure detection from text line positions

---

### Bloom Document Model

**Files:** `src/engine/bloom/ingest.ts`, `layout.ts`, `edit.ts`, `compile.ts`, `render.ts`, `types.ts`

A Word-processor-like document model layered on top of the parsed PDF:

- **Ingest** (`ingestPage`, `ingestDocument`) — Converts parsed PDF pages into `BloomPage` objects containing `BloomBlock[]` (each block has `BloomRun[]` with styled text)
- **Layout** (`layoutPage`, `layoutBlock`, `measureWithRuns`) — Measures and positions blocks using font metrics, producing `BloomLineBox[]` layout
- **Edit** (`insertTextAtCaret`, `deleteTextAtCaret`, `replaceRange`, `setBlockText`) — Text mutations that operate on the Bloom model
- **Compile** (`compilePage`, `compileBlocks`) — Converts edited Bloom model back into PDF content stream operators for saving
- **Render** (`renderBloomPage`, `paintBloomOverPdf`, `maskBloomTextRegions`) — Renders Bloom blocks over the original PDF canvas
- **Hit test** (`hitTestBloomPage`, `findNearestBlock`, `caretPdfPosition`) — Maps click coordinates to blocks and caret positions

**Key types:**
- `BloomBlock` — A text block with kind (paragraph, heading, etc.), alignment, bbox, runs, and line boxes
- `BloomRun` — A styled span of text (font, size, bold, italic, color, etc.)
- `BloomPage` — Collection of blocks for a single page, with frames for layout regions
- `BloomDocument` — All pages in the document

---

### Editor

**Files:** `src/engine/editor/text-editor.ts`, `image-editor.ts`, `object-editor.ts`, `redaction.ts`, `highlight.ts`, `annotation-engine.ts`, `stream-compiler.ts`, `link.ts`, `invisible-text.ts`

Low-level PDF editing operations:

- **Text editor** — `applyTextEdits` (batch text mutations), `findTextInPage`, `findAndReplace`, `insertTextRun`
- **Image editor** — `insertImageRun` (add image XObject), `replaceImageXObject`
- **Object editor** — `applyObjectTransform` (move/rotate/scale), `deleteObject`
- **Redaction** — `markRedaction` (draw redaction overlay), `applyRedactions` (permanently remove content under redaction areas)
- **Highlights** — `addHighlightFromSelection`, `addHighlightFromLineSelection`, `addHighlightFromMultiLineSelection` — creates real PDF Highlight annotations
- **Annotations** — `createAnnotationDict`, `addAnnotationToPage`, `removeAnnotationFromPage`, `eraseAnnotationsAtPoint`, `clearMarkupAnnotationsOnPage`
  - **Supported types:** Highlight, FreeText, Ink, Line, Square, Circle, Stamp, Redact, Link
- **Stream compiler** — `compileContentStream`, `updatePageContent`, `serializeObject` — converts modified objects back to PDF binary format
- **Links** — `addLinkFromLineSelection`, `listPageLinks`, `hitTestPageLink`, `removePageLink`, `updatePageLinkUrl`
- **Invisible text** — `insertInvisibleTextLayer` — adds selectable/searchable text behind scanned pages

---

### Writer

**Files:** `src/engine/writer/serializer.ts`, `incremental-writer.ts`, `save-pipeline.ts`, `page-operations.ts`

PDF output and serialization:

- **Serializer** — `serializeDocument` (full PDF write), `serializeDocumentCompact` (optimized output)
- **Incremental writer** — `saveIncremental`, `appendIncrementalUpdate` — append-only updates that preserve the original PDF bytes and add only changed objects. `IncrementalUpdateSession` manages multi-update sessions. `RevisionManager` tracks revision history. `OffsetManager` tracks byte offsets.
- **Save pipeline** — `saveDocument` with modes:
  - `saveQuick` — Incremental append (fast, preserves history)
  - `saveOptimized` — Full rewrite with garbage collection + stream deduplication
- **Page operations** — `deletePage`, `deletePages`, `reorderPages`, `movePage`, `rotatePage`, `rotatePageBy`, `insertBlankPage`, `extractPages`, `insertPagesFromDocument`

---

### Signatures

**Files:** `src/engine/signatures/` (visual, fields, crypto, certificates, validation, appearance, library, and more)

Complete digital signature implementation spanning 14 phases:

- **Visual signatures** — Draw, type, or upload signature images. Move, resize, rotate, set opacity, lock. Full signature library with recent-order tracking.
- **Signature fields** — Create, detect, and hit-test AcroForm signature fields. Place visual signatures into fields.
- **Appearance streams** — Build PDF appearance streams (Normal appearance `/N`), embed images, serialize to content stream operators.
- **Cryptographic signing** — DER/ASN.1 parsing, CMS SignedData construction (`buildDetachedCMS`, `buildDetachedCMSAdvanced`), ByteRange calculation and finalization.
- **Certificate management** — PEM decoding, DER parsing, PKCS#12 import, certificate chain validation, `CertificateManager` singleton.
- **Validation** — `validateDocumentSignatures`, `validateSignatureField`, cryptographic CMS verification, validation status badges.
- **Timestamping** — `buildTimestampRequest`, `parseTimestampResponse`, `requestTimestamp`, RFC 3161 TSA support.
- **Long-Term Validation (LTV)** — Document Security Store (DSS) embedding, `enableLongTermValidation`, LTV status checking.
- **Multi-signature** — `inspectMultiSignatures`, `canAddSignatureWithoutInvalidating`, revision history viewer.
- **Hashing** — `hashBytes`, `hashByteRanges`, MD5/SHA-1/SHA-256/SHA-384/SHA-512 support.

---

### Security

**Files:** `src/engine/security/` (multiple submodules)

Full PDF security engine spanning 10 phases:

| Engine | Class | Purpose |
|--------|-------|---------|
| `SecurityEngine` | `securityEngine` | Top-level coordinator |
| `EncryptionEngine` | `encryptionEngine` | RC4 + AES encrypt/decrypt, object key derivation |
| `PasswordEngine` | `passwordEngine` | User/owner password authentication |
| `PermissionEngine` | `permissionEngine` | Parse/serialize/merge PDF permissions, `allowsOperation()` checks |
| `PublicKeyEncryptionEngine` | `publicKeyEncryptionEngine` | Public-key (certificate-based) encryption + `RecipientManager` |
| `MetadataEngine` | `metadataEngine` | Metadata stripping + validation |
| `EmbeddedFileSecurityEngine` | `embeddedFileSecurityEngine` | Embedded attachment scanning |
| `JavaScriptSecurityEngine` | `javaScriptSecurityEngine` | JavaScript action detection + reporting |
| `RedactionEngine` | `redactionEngine` | Secure redaction with verification |
| `SanitizationEngine` | `sanitizationEngine` | Full document sanitization |
| `IntegrityScanner` | `integrityScanner` | Document integrity verification |
| `SecureOptimizer` | `secureOptimizer` | Security-aware optimization |
| `SecurityPolicyEngine` | `securityPolicyEngine` | Policy-based access control + audit logging |
| `SecurityInspector` | `securityInspector` | Full security inspection report |
| `EnterpriseSecurityLayer` | `enterpriseSecurity` | Enterprise-grade security wrapper |

**Low-level crypto:** `md5`, `rc4`, `padPassword`, `computeObjectKey`, `decryptBytes`, `encryptBytes`, `decryptDocumentObjects`, `encryptDocumentObjects`

---

### Forms

**Files:** `src/engine/forms/`

AcroForm interactive form support:

- `parseAcroFormCatalog` — Reads the document's AcroForm dictionary
- `detectFormFieldsOnPage` — Finds form widgets on a specific page
- `listAllFormWidgets` — Enumerates all widgets across the document
- `hitTestFormField` — Point-in-widget detection
- `setFormFieldValue` — Sets text field values
- `setButtonFieldValue` — Sets checkbox/radio button state
- `setChoiceFieldValue` — Sets dropdown/listbox selections
- `buildAppearanceStream` — Generates widget appearance streams
- `flattenFormFieldsOnPage` / `flattenField` / `flattenWidgets` — Permanently bakes form values into page content
- `regenerateNeedAppearances` — Marks fields for appearance regeneration
- `runCalculationOrder` — Executes AcroForm `/CO` calculation chain

**Field types:** Text, Button (checkbox, radio, push), Choice (dropdown, listbox)

---

### Editing Infrastructure

**Files:** `src/engine/editing/`

Shared editing primitives:

- **QuadTree** — Recursive spatial subdivision for O(log n) hit-testing of display items (`hitTestSpatial`)
- **TransactionStack** — Undo/redo with `captureHistoryEntry` / `EditorHistory` managing snapshots
- **Scene Graph** (`buildSceneGraph`, `hitTestScene`) — Hierarchical scene representation for objects on a page
- **Affine transforms** (`composeTransform`, `invertAffine`, `multiplyAffine`, `transformObject`) — 2D affine transformation matrix operations
- **Snap guides** (`snapToGuides`, `buildPageGuides`, `buildObjectGuides`) — Alignment snapping during object manipulation
- **Display list** (`buildDisplayListIndex`, `hitTestDisplayList`) — Indexed display item list for efficient spatial queries

---

### Color

**Files:** `src/engine/color/`

ICC color management:

- `parseICCProfile` — Reads ICC profile binary format (header, tag table, data)
- `getICCTag` — Extracts specific ICC tags
- `parseICCLutTag` / `parseMft2Table` — Parses multi-dimensional LUT (Look-Up Table) data
- `transformDeviceToPCS` / `transformPCSToDevice` — Color space transforms via Profile Connection Space
- `iccBasedToRGB` — Converts ICC-based colors to sRGB for display

---

### Watermark

**Files:** `src/engine/watermark/watermark-engine.ts`, `watermark-detector.ts`, `watermark-remover.ts`

- **Creation** — `buildTextWatermarkContent`, `buildImageWatermarkContent`, `buildPatternWatermarkContent`, `applyWatermarkToPage`, `applyWatermarks`
- **Detection** — `detectWatermarks`, `detectWatermarksOnPage` — Identifies existing watermarks based on content stream analysis
- **Removal** — `removeWatermarks`, `removeWatermarksFromPage`, `detectAndRemoveAllWatermarks`

---

### AI

**Files:** `src/engine/ai/`

- `chunkDocument` — Splits document into `DocumentChunk[]` for indexing
- `buildSemanticSearchIndex` — Builds a TF-IDF search index over chunks
- `searchSemanticIndex` — Queries the index for relevant hits
- `comparePageText` / `compareDocuments` — Text diff between pages or documents
- `extractPagePlainText` — Extracts plain text from a page

---

### Optimize

**Files:** `src/engine/optimize/`

- `garbageCollect` — Removes unreferenced indirect objects
- `computeReachability` — Traces the object graph from the catalog to find reachable objects
- `deduplicateStreams` — Finds and merges identical streams
- `compressDocumentImages` — Re-encodes images with configurable quality/format

---

### OCR (Client)

**Files:** `src/engine/ocr/`

Client-side layout analysis (not full OCR — that uses Tesseract.js separately):

- `computeHorizontalProjection` — Horizontal projection profile for line detection
- `detectLayoutRegions` — Identifies text/image/whitespace regions
- `detectDeskewAngle` — Estimates page rotation angle
- `analyzePageLayout` — Full page layout analysis pipeline

---

### Accessibility

**Files:** `src/engine/accessibility/`

Currently **scaffolded** — directory exists with planned structure for tagged PDF structure tree support.

---

## Server-Side Engine (`server/src/engines/`)

The server engine provides a **12-stage document intelligence pipeline** for structure-preserving PDF conversion. Every engine is a separate class composed via dependency injection.

### Parser Engine (Server)

**Files:** `server/src/engines/parser/parser-engine.ts`, `document-parser.ts`, `content-extractor.ts`, `lexer.ts`, `object-graph.ts`, `spatial-index.ts`, `raw-model.ts`, `pdf-objects.ts`, `filters.ts`, `font-decode.ts`, `cmap.ts`

**Class:** `ParserEngine` (implements `IParserEngine`)

Converts raw PDF bytes into a `RawDocument`:

1. `parsePdfDocument(bytes)` — Parses the PDF binary format
2. `extractPageRaw(page, objects, content, graph)` — Extracts characters, text runs, images, vectors, annotations, and forms from each page's content stream
3. Builds an `ObjectGraph` — a directed graph (`Map<string, GraphNode>`) where each node has:
   - `id`, `type` (document, page, character, textRun, image, vector, annotation, form)
   - `parentId`, `childIds` — parent-child relationships
   - `pageIndex`, `bbox`, `transform` (6-element affine matrix), `zIndex`
4. Builds a `PageSpatialIndex` — a grid-based spatial index with configurable cell size (default 72pt):
   - `insert(entry)` — Adds an entry to the grid
   - `nearest(x, y, type?)` — O(1) nearest-neighbor lookup via grid cell + fallback linear scan
   - `objectsInRectangle(rect, type?)` — Range query using grid cells
   - `objectsAtPoint(x, y)` — Point containment query
   - `objectsByLayer(layer)` / `objectsByType(type)` — Filtered queries

**Concurrency:** Page parsing runs in parallel using a `mapPool` utility with configurable concurrency (default 4).

---

### Layout Engine

**Files:** `server/src/engines/layout/layout-engine.ts`, `types.ts`, `normalize.ts`, `clustering.ts`, `segmentation.ts`, `classify.ts`, `whitespace.ts`, `reading-order.ts`, `spatial-index.ts`, `algorithms/`

**Class:** `LayoutEngine` (implements `ILayoutEngine`)

Converts `RawDocument` → `LayoutDocument` through a 7-step pipeline per page:

1. **Normalize** — Transforms raw page data into a `NormalizedPage` with consistent coordinate system (`rawToNormalized` matrix)
2. **Spatial Index** — Builds a spatial index for efficient geometric queries
3. **Clustering** — Groups characters into words, words into lines, lines into text clusters. Also categorizes images, vectors, annotations, forms into `ClusteredObject[]` and `LayoutBlock[]`
4. **Whitespace Analysis** — Detects page margins, column gutters, horizontal/vertical gaps using horizontal and vertical projection profiles. Produces `WhitespaceSignals`
5. **Segmentation (XY-Cut)** — Recursively splits the page into `SegmentCandidate[]` using alternating horizontal/vertical cuts based on whitespace gaps
6. **Classification** — Assigns `LayoutRegionKind` labels to segments: `header`, `footer`, `title`, `heading`, `text_block`, `caption`, `image`, `sidebar`, `footnote`, `endnote`, `watermark`, `background`, `margin_note`, `form_area`, `unknown`
7. **Reading Order** — Builds a `ReadingOrderGraph` with topological/column-aware ordering of regions

**Output:** `LayoutDocument` with `LayoutPage[]`, each containing `LayoutRegion[]` with nested `LayoutBlock[]` and a `ReadingOrderGraph`

**Strategies:** The engine uses a strategy pattern (`LayoutStrategies`) — each step is pluggable via `createDefaultStrategies()`.

---

### OCR / Recognition Fusion

**Files:** `server/src/engines/ocr/engine.ts`, `fusion.ts`, `classify.ts`, `fonts.ts`, `language.ts`, `providers.ts`, `preprocess.ts`, `types.ts`

**Class:** `RecognitionFusionEngine` (implements `IOcrManager`)

- **Page classification** — Classifies pages as digital text, scanned image, or mixed
- **Provider system** — Pluggable OCR provider interface for external OCR engines
- **Fusion** — Merges OCR-recognized text with parser-extracted text, resolving conflicts based on confidence scores
- **Language detection** — Identifies primary document language
- **Font matching** — Matches OCR-recognized fonts to parser-detected fonts

**Output:** `RecognitionDocument` with per-page blocks, words, confidence scores, and primary language

---

### IDM Engine (Intermediate Document Model)

**Files:** `server/src/engines/idm/idm-engine.ts`, `reconstruction.ts`, `text-reconstructor.ts`, `document-api.ts`, `serialize.ts`, `types.ts`

**Class:** `IntermediateDocumentEngine` (implements `IIntermediateDocumentEngine`)

Converts `RawDocument` + `LayoutDocument` → `IntermediateDocument`:

The IDM is a **canonical, format-independent document tree**:

```
IntermediateDocument
  ├── sections[]
  │     └── pages[]
  │           ├── blocks[] (paragraph, title, heading, caption, image,
  │           │             table_placeholder, list_placeholder, sidebar,
  │           │             footnote, code_block, quote, unknown)
  │           │     ├── runs[] (styled text spans)
  │           │     ├── words[]
  │           │     └── characters[]
  │           ├── headers[]
  │           └── footers[]
  ├── bookmarks[]
  ├── footnotes[]
  ├── endnotes[]
  └── hyperlinks[]
```

**Key design decisions:**
- The IDM is **immutable** after generation (`immutable: true`)
- Every node has `id`, `parentId`, `childIds`, `previousId`, `nextId` for full tree traversal
- A flat `nodeIndex: Record<string, IdmNodeRef>` provides O(1) lookup by ID
- `styleCandidates` are provisional hints (e.g., "Possible Heading") — later phases decide final classification
- Version is fixed at `IDM_VERSION = '1.0.0'`

**Text reconstruction** (`text-reconstructor.ts`) — Reconstructs paragraph text from raw characters using:
- Character proximity analysis
- Word boundary detection
- Line break insertion
- Run segmentation by style changes

---

### Typography Analyzer

**Files:** `server/src/engines/typography/analyzer.ts`, `clustering.ts`, `style-graph.ts`, `types.ts`

**Class:** `TypographyAnalyzer` (implements `ITypographyAnalyzer`)

Analyzes the IDM to produce `TypographyAnalysis`:

- **Style clustering** — Groups text runs by font name, font size, and font weight into style profiles
- **Style graph** — Builds a graph of style relationships (which styles appear together, parent-child relationships)
- **Statistics** — Computes primary fonts, sample counts, occurrence counts per profile

**Output:** `TypographyAnalysis { profiles[], statistics, graph { nodes[], edges[] } }`

---

### Semantic Structure Engine

**Files:** `server/src/engines/semantic/engine.ts`, `detectors.ts`, `types.ts`

**Class:** `SemanticStructureEngine` (implements `ISemanticStructureEngine`)

Converts IDM + Layout + Typography → `SemanticDocument`:

- **Heading detection** — Uses font size ratio relative to body text, bold weight, and position to classify headings (h1–h6)
- **List detection** — Identifies ordered/unordered lists by bullet characters and numbering patterns
- **Quote detection** — Detects blockquotes by indentation and styling
- **Title/subtitle detection** — Identifies document title from first-page position and font size
- **Code block detection** — Identifies monospace font regions as code blocks

**Output:** `SemanticDocument` with:
- `nodes: Record<string, SemanticNode>` — Flat map of all semantic nodes
- `readingOrder: string[]` — Ordered list of node IDs for document traversal
- `sections[]`, `title`, `quality` metrics

---

### Table Detection Engine

**Files:** `server/src/engines/table/engine.ts`, `candidates.ts`, `cells.ts`, `columns.ts`, `grid.ts`, `headers.ts`, `integrate.ts`, `types.ts`, `algorithms/`

**Class:** `TableDetectionEngine` (implements `ITableDetectionEngine`)

Detects and reconstructs tables from layout and semantic data:

1. **Candidate detection** (`candidates.ts`) — Finds potential table regions using alignment patterns and grid-like spacing
2. **Grid reconstruction** (`grid.ts`) — Builds row/column grid from candidate regions
3. **Cell detection** (`cells.ts`) — Identifies individual cells, handles merged/spanning cells
4. **Column analysis** (`columns.ts`) — Detects column boundaries and alignment
5. **Header detection** (`headers.ts`) — Identifies header rows by style differentiation (bold, background color, position)
6. **Integration** (`integrate.ts`) — Integrates detected tables back into the semantic model

**Supports:** Both bordered tables (detected via vector lines) and borderless tables (detected via text alignment patterns).

**Output:** `LogicalTable[]` — each with `rows[]`, `columns[]`, and `cells[]` (each cell has `rowIndex`, `colIndex`, `rowSpan`, `colSpan`, `text`)

---

### Graphics Reconstruction Engine

**Files:** `server/src/engines/graphics/engine.ts`, `images.ts`, `vectors.ts`, `charts.ts`, `captions.ts`, `grouping.ts`, `wrapping.ts`, `types.ts`, `algorithms/`

**Class:** `GraphicsReconstructionEngine` (implements `IGraphicsReconstructionEngine`)

Reconstructs graphics objects from layout and raw data:

- **Image reconstruction** (`images.ts`) — Identifies and categorizes images (photo, icon, logo, diagram)
- **Vector reconstruction** (`vectors.ts`) — Groups vector paths into logical shapes and decorations
- **Chart detection** (`charts.ts`) — Identifies chart-like vector groupings
- **Caption association** (`captions.ts`) — Links captions to nearby images/figures
- **Grouping** (`grouping.ts`) — Groups related graphics objects into logical units
- **Text wrapping** (`wrapping.ts`) — Analyzes how text wraps around graphics (inline, square, tight, behind, front)

**Output:** `GraphicsModel { objects[], rootIds[], resources: { images }, quality }`

---

### Document Structure Engine

**Files:** `server/src/engines/structure/engine.ts`, `headers.ts`, `footnotes.ts`, `page-numbers.ts`, `sections.ts`, `toc.ts`, `bookmarks.ts`, `hyperlinks.ts`, `types.ts`, `algorithms/`

**Class:** `DocumentStructureEngine` (implements `IDocumentStructureEngine`)

Analyzes document-level structure:

- **Headers/footers** (`headers.ts`) — Detects repeating header/footer content across pages
- **Footnotes/endnotes** (`footnotes.ts`) — Identifies footnote markers and content
- **Page numbers** (`page-numbers.ts`) — Detects and parses page numbering schemes
- **Sections** (`sections.ts`) — Detects section boundaries from heading patterns
- **Table of contents** (`toc.ts`) — Identifies TOC entries from dotted leaders and page references
- **Bookmarks** (`bookmarks.ts`) — Extracts PDF outline/bookmark tree
- **Hyperlinks** (`hyperlinks.ts`) — Extracts link annotations and URIs

**Output:** `DocumentStructureModel { headers[], footers[], pageNumbers[], footnotes[], endnotes[], toc[], bookmarks[], hyperlinks[], sections[], root, metadata, quality }`

---

### UDM (Unified Document Model)

**Files:** `server/src/engines/udm/assemble.ts`, `types.ts`

**Function:** `assembleUnifiedDocument(input)`

Merges all engine outputs into the single `UnifiedDocumentModel`:

```typescript
interface UnifiedDocumentModel {
  id: string;
  version: '1.0';
  metadata: { title?, author?, subject?, keywords?, language?, pageCount, createdAt };
  idm: IntermediateDocument;          // From IDM engine
  semantic: SemanticDocument;          // From Semantic engine
  tables: LogicalTable[];              // From Table engine
  graphics: GraphicsModel | null;      // From Graphics engine
  structure: DocumentStructureModel | null;  // From Structure engine
  recognition: RecognitionDocument | null;   // From OCR engine
  typography: TypographyAnalysis | null;     // From Typography engine
}
```

**Architecture rule:** This is the **sole input to all exporters**. No exporter ever accesses the PDF parser, raw model, or layout objects directly.

---

### Export Manager & Plugin SDK

**Files:** `server/src/engines/exporter/export-manager.ts`, `plugin.ts`, `content.ts`, `zip.ts`, and format directories (`docx/`, `xlsx/`, `pptx/`, `html/`, `markdown/`, `epub/`, `rtf/`, `odt/`, `txt/`, `json/`, `xml/`, `svg/`)

**Class:** `ExportManager` (implements `IExportManager`)

> **🚧 Status:** The export pipeline is **in progress**. All 12 exporter classes are implemented and wired into the plugin registry. Active work continues on improving conversion fidelity.

**Plugin SDK interface:**

```typescript
interface IExportPlugin {
  readonly target: ConvertTarget;
  readonly name: string;
  initialize?(udm: UnifiedDocumentModel): void | Promise<void>;
  export(udm: UnifiedDocumentModel): Promise<ExportResult>;
  validate?(bytes: Uint8Array): boolean;
  package?(parts: Record<string, string | Uint8Array>): Uint8Array;
  cleanup?(): void;
}
```

**Registered exporters:**

| Target | Exporter Class | Output Format |
|--------|---------------|---------------|
| `docx` | `DocxExporter` | OpenXML Word document (ZIP) |
| `xlsx` | `XlsxExporter` | OpenXML Spreadsheet (ZIP) |
| `pptx` | `PptxExporter` | OpenXML Presentation (ZIP) |
| `html` | `HtmlExporter` | Standalone HTML with inline CSS |
| `markdown` | `MarkdownExporter` | GitHub-flavored Markdown |
| `epub` | `EpubExporter` | EPUB 3 ebook (ZIP) |
| `rtf` | `RtfExporter` | Rich Text Format |
| `odt` | `OdtExporter` | OpenDocument Text (ZIP) |
| `txt` | `TxtExporter` | Plain text |
| `json` | `JsonExporter` | Structured JSON |
| `xml` | `XmlExporter` | Structured XML |
| `svg` | `SvgExporter` | Scalable Vector Graphics |

**Content extraction** (`content.ts`) — `extractContentBlocks(udm)` walks the semantic reading order and produces format-agnostic `ContentBlock[]` (heading, paragraph, quote, code, caption, list, table, image, link). All exporters share this same content extraction.

**ZIP packaging** (`zip.ts`) — Custom ZIP file builder for OOXML formats (DOCX/XLSX/PPTX) and EPUB, without external dependencies.

---

## Infrastructure

### Dependency Injection Container

**File:** `server/src/container.ts`

`createContainer()` composes all engines with constructor injection (SOLID principles):

```
ConfigurationManager → TelemetryManager → StorageManager → CacheManager
→ JobManager → InMemoryJobQueue → ParserEngine → RecognitionFusionEngine
→ LayoutEngine → IntermediateDocumentEngine → TypographyAnalyzer
→ SemanticStructureEngine → TableDetectionEngine
→ GraphicsReconstructionEngine → DocumentStructureEngine
→ ExportManager → DocumentEngine
```

All engine interfaces are defined in `server/src/engines/common/interfaces.ts`, enabling testing with mock implementations.

### Job Queue

**File:** `server/src/queues/job-queue.ts`

**Class:** `InMemoryJobQueue` (implements `IJobQueue`)

An in-process priority queue with:
- **Three priority lanes:** `high`, `normal`, `low` — jobs dequeue in priority order
- **Automatic retry:** Configurable `maxRetries` with exponential backoff (`50ms × 2^attempt`, capped at 2s)
- **Dead-letter queue:** Jobs exceeding retry limit are moved to DLQ with error message and timestamp
- **Stats:** `getStats()` returns pending, per-lane counts, DLQ size, completed/failed/retried counters
- **Graceful shutdown:** `stop()` waits for in-flight jobs to complete

Designed to be swappable for Redis/BullMQ behind the same `IJobQueue` interface.

### Conversion Worker Pipeline

**File:** `server/src/workers/conversion-worker.ts`

`createConversionHandler(deps)` returns a `(jobId: string) => Promise<void>` handler that runs the full pipeline:

```
Parse (12%) → OCR/Fusion (25%) → Layout (40%) → IDM (55%)
→ Typography → Semantic → Tables → Graphics → Structure
→ UDM Assembly → Export (80%) → Packaging (95%) → Completed (100%)
```

Each stage updates the job state and progress percentage. Intermediate results (raw, layout, IDM, semantic, tables, graphics, structure, UDM) are persisted to storage as JSON summaries for debugging.

The container wraps this handler with a configurable timeout (default 120s).

### Storage

**File:** `server/src/storage/storage-manager.ts`

Two implementations:
- `StorageManager` — Local filesystem (configurable root directory, default `.bloom-storage`)
- `MemoryStorageManager` — In-memory (for testing)

### Telemetry

**File:** `server/src/telemetry/telemetry-manager.ts`

- `info`, `warn`, `error` — Structured logging
- `time(label, fn)` — Async timing wrapper that records execution duration
