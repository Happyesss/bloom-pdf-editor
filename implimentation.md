# PDF → DOCX Export Engine — Phase-by-Phase Build Plan
### Pure TypeScript, built on top of your existing PDF parsing/rendering engine

---

## Prerequisites (you already have these)
- Custom PDF parser / object model
- Content stream interpreter (used for canvas rendering)
- Font parsing (TrueType/CMap) — glyph → Unicode mapping
- Image XObject decoding (FlateDecode/DCTDecode → raw pixel/PNG/JPEG bytes)

These are reused, not rebuilt, for export. The export engine is a **new consumer** of your existing extraction layer, not a replacement for it.

---

## Phase 0 — Scoping & Data Contracts
**Goal:** Define the interfaces before writing logic, so every later phase has a stable contract to build against.

- Define `PositionedGlyph` (output of your content-stream interpreter, per glyph or per `Tj`/`TJ` run)
- Define the `ExtractedDocument` model (`Block`, `ParagraphBlock`, `HeadingBlock`, `TableBlock`, `ImageBlock`, `ListBlock`, `TextRun`)
- Decide scope for v1: single-column, no tables, no OCR (scanned PDFs out of scope initially)

**Exit criteria:** Types compile, no logic yet. You can describe any test PDF's expected output using only these types.

---

## Phase 1 — Glyph Extraction Layer
**Goal:** Flatten a page's content stream into a list of positioned, styled glyphs.

- Walk content stream operators, tracking graphics state (`CTM`, `Tm`, `Tf`, `Tc`, `Tw`, fill color)
- On `Tj`/`TJ`, resolve each character via the font's CMap/encoding to get Unicode text
- Apply `Tm × CTM` to get final `(x, y)` in page space for each glyph/run
- Record `fontSize`, `fontFamily`, `bold`/`italic` (from font descriptor flags or subfamily name), `color`

**Exit criteria:** For a simple single-paragraph test PDF, you can dump a JSON array of glyphs with correct text, position, and style — verified by eye against the rendered canvas output.

---

## Phase 2 — Line Grouping
**Goal:** Cluster glyphs into words, then words into lines.

- Word grouping: merge glyphs where horizontal gap < threshold (relative to font size/space-width)
- Line grouping: merge words whose baseline `y` values fall within a tolerance band (handles slight sub-pixel variance)
- Sort lines top-to-bottom (descending `y`), sort words within a line left-to-right (ascending `x`)

**Exit criteria:** A multi-line paragraph PDF produces correctly ordered, correctly split lines — test against PDFs with varying font sizes on the same page.

---

## Phase 3 — Paragraph & Heading Detection
**Goal:** Group lines into paragraphs; classify some as headings.

- Compute line-to-line vertical gap; gap ≈ normal line-height → same paragraph, larger gap → new paragraph
- Also break paragraphs on left-indent change or font-family/size change mid-block
- Compute median body font-size across the document; lines significantly larger/bolder → heading candidates (bucket into H1/H2/H3 by relative size)
- Preserve inline style runs (bold/italic mid-line) as separate `TextRun`s within a paragraph — don't flatten to one string

**Exit criteria:** A test PDF with a title, subheadings, and body paragraphs is correctly split into `HeadingBlock`s and `ParagraphBlock`s with accurate levels.

---

## Phase 4 — Reading Order & Multi-Column Support
**Goal:** Handle non-trivial page layouts correctly.

- Cluster lines by `x`-start position across the page to detect column boundaries
- If ≥2 stable x-clusters with a consistent gap exist → treat as multi-column; process each column top-to-bottom before moving to the next
- Handle headers/footers as a special case (thin bands at top/bottom, often repeated across pages) — exclude from body flow or tag separately

**Exit criteria:** A 2-column test PDF reads in correct logical order (full left column, then right column) instead of interleaving lines.

---

## Phase 5 — Image Extraction & Placement
**Goal:** Place images from your existing XObject decoder into the document model.

- Reuse your existing image decoding (already needed for canvas rendering)
- Record bounding box per image; decide inline vs. anchored placement based on how much text surrounds it
- Insert `ImageBlock`s into the block stream at the correct position relative to surrounding text (by `y` position)

**Exit criteria:** A PDF with an inline image and a full-width image both export with images in roughly correct position and size.

---

## Phase 6 — Table Detection
**Goal:** The highest-effort phase — detect and reconstruct tabular data. Build last, iterate longest.

- **Ruling-line based:** detect horizontal/vertical stroking operators forming a grid; snap text blocks into resulting cells
- **Alignment based** (no visible borders): detect repeated, consistent x-start positions across multiple consecutive lines → implies columns; assign each text run to a column/row
- Merge multi-line cell content into single `TableCell.blocks`
- Handle merged cells (colSpan/rowSpan) as a stretch goal — skip for v1, flag as known limitation

**Exit criteria:** A simple bordered table (fixed columns, single-line cells) round-trips correctly. Complex tables (merged cells, nested tables) are explicitly out of scope for v1.

---

## Phase 7 — List Detection
**Goal:** Recognize bulleted/numbered lists instead of exporting them as plain paragraphs.

- Detect leading glyphs matching bullet characters (•, -, ●) or numbering patterns (`1.`, `a)`, roman numerals) at consistent left-indent
- Group consecutive matching lines into a `ListBlock`, strip the marker from the text run

**Exit criteria:** A bulleted and a numbered list both export as real Word list elements, not plain paragraphs with visible bullet characters.

---

## Phase 8 — Document Assembly
**Goal:** Combine per-page blocks into one coherent `ExtractedDocument`.

- Decide: per-page grouping (simpler, paragraphs can split across page breaks) vs. whole-document glyph stream before grouping (handles cross-page paragraphs, more complex)
- Recommended: start per-page for v1, document the page-break limitation, revisit later
- Strip detected headers/footers from body flow (from Phase 4)

**Exit criteria:** A multi-page test PDF produces one `ExtractedDocument` with correct page-to-page flow (accepting the page-break paragraph-split limitation for v1).

---

## Phase 9 — DOCX Serialization
**Goal:** Convert `ExtractedDocument` into an actual `.docx` file.

- Map `HeadingBlock` → `docx` package `Heading1`/`Heading2`/etc.
- Map `ParagraphBlock` → `Paragraph` with multiple `TextRun`s carrying bold/italic/size/color
- Map `TableBlock` → `Table`/`TableRow`/`TableCell`
- Map `ImageBlock` → `ImageRun` with correct sizing (convert PDF points → EMU/pixels as required by the `docx` package)
- Map `ListBlock` → numbering/bullet paragraph properties

**Exit criteria:** Full pipeline PDF → `ExtractedDocument` → `.docx` produces a file that opens cleanly in Word/LibreOffice with correct text, styles, and basic layout.

---

## Phase 10 — Test Harness & Regression Suite
**Goal:** Prevent regressions as you keep improving heuristics (this matters more than usual since it's all heuristic-based).

- Build a fixture set: simple text, headings, 2-column, table, image, list, mixed — one PDF per case
- Snapshot-test the `ExtractedDocument` JSON output per fixture (not just the final .docx — easier to diff and debug)
- Add real-world PDFs as they break in production; each bug report becomes a new fixture

**Exit criteria:** CI runs the full fixture set on every change; you can see exactly which layout case broke.

---

## Phase 11 — Iteration Loop (ongoing, no exit criteria)
This is where actual quality comes from — not the initial build.

- Collect failing real-world PDFs from users
- For each: identify which phase's heuristic is wrong (bad line-gap threshold? bad column detection? bad table grid?)
- Add as a regression fixture, fix, re-run suite
- This is literally how iLovePDF/Sejda-quality output is achieved — thousands of iterations on real documents, not a perfect initial design

---

## Suggested Build Order Summary

| Priority | Phase | Effort | Depends on |
|---|---|---|---|
| 1 | 0 – Data contracts | Low | — |
| 2 | 1 – Glyph extraction | Medium | Your existing content stream interpreter |
| 3 | 2 – Line grouping | Medium | Phase 1 |
| 4 | 3 – Paragraph/heading detection | Medium | Phase 2 |
| 5 | 9 – Basic DOCX output (text-only) | Low | Phase 3 (get end-to-end working early!) |
| 6 | 5 – Images | Low-Medium | Existing image decoder |
| 7 | 4 – Multi-column | Medium-High | Phase 2 |
| 8 | 7 – Lists | Low-Medium | Phase 3 |
| 9 | 6 – Tables | High | Phase 2, 4 |
| 10 | 8 – Multi-page assembly | Medium | All above |
| 11 | 10 – Test harness | Medium | Should start alongside Phase 1, not after |

**Key advice:** Get Phase 9 (basic DOCX output) working right after Phase 3, even before columns/tables/images. A thin end-to-end pipeline (simple text PDF → readable DOCX) validated early is worth more than a fully-featured pipeline that's never been run end-to-end.