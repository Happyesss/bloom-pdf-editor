# PDF → DOCX Export — How Platforms Actually Do It

This replaces the earlier phase plan. That plan assumed a single “rebuild paragraphs then dump to Word” pipeline. Real products (Adobe Acrobat, iLovePDF, Sejda, pdf2docx, BuildVu-class tools) expose **two different layout models**, because PDF and DOCX solve different problems.

---

## The core mismatch (why conversion is hard)

| | PDF | Word (.docx) |
|---|---|---|
| Model | Fixed / presentation | Reflowable / document |
| Placement | Absolute (x, y) on a page | Flow: paragraphs, sections, tables |
| Structure | Usually absent (untagged) | Explicit styles + numbering |

Almost every “looks perfect but won’t edit” Word export is **fixed layout**.  
Almost every “edits nicely but layout drifts” export is **reflow / flowing text**.

Adobe names these explicitly:

- **Retain Page Layout** → text boxes at PDF coordinates (visual fidelity, poor editability)
- **Retain Flowing Text** → reconstructed paragraphs/tables (editable, layout inference errors)

iLovePDF / Sejda-style tools offer the same trade-off under names like “exact layout” vs “editable / flow”.

There is no one pipeline that is both pixel-perfect and fully editable. Quality products pick a mode (or offer both).

---

## Mode A — Fixed layout (“keep page layout”)

**What platforms do**

1. Extract positioned text runs (and images) from content streams.
2. Optionally rasterize the page as a background for graphics that aren’t text.
3. Emit each run as an absolutely positioned Word **textbox** (`w:txbxContent` / floating shapes), matching PDF left/top/width.
4. Do **not** try hard to merge into flowing paragraphs.

**When to use:** resumes, posters, forms, marketing one-pagers where visual match matters more than editing.

**Cost:** Easy to implement; ugly editing experience (one box per fragment).

**Our stack mapping:** `docx` package `TextBox` + page size from MediaBox; glyph/line extraction from the existing interpreter. Background page image optional for vector art.

---

## Mode B — Reflow / flowing text (what Acrobat prefers for editability)

**What platforms do**

1. **Glyph / run extraction** — Unicode + font size/style + final page-space coords (`Tm × CTM`).
2. **Line grouping** — cluster by baseline Y tolerance; sort X within line.
3. **Block reconstruction** — paragraph breaks from vertical gaps + indent changes; headings from relative font size/weight; lists from bullet/number markers at shared indent.
4. **Reading order** — column detection (stable X clusters) before interleaving lines left-to-right across the page.
5. **Tables** — either ruling-line grids or alignment columns; emit real `w:tbl`, not stacked textboxes.
6. **Images** — XObject decode + place relative to surrounding blocks (or anchored).
7. **Headers/footers** — repeated top/bottom bands stripped or tagged separately.
8. **Serialize** — map blocks to Word paragraphs, styles, numbering, tables, drawings.

Tagged PDF / structure tree (when present) is the gold path (Acrobat “Derivation”-style). Most uploaded PDFs are **untagged**, so heuristics (and increasingly ML layout models) fill the gap — same reason PDFix/ComPDF advertise AI layout recognition.

**When to use:** reports, articles, contracts the user will edit in Word.

**Cost:** Hard; quality comes from years of fixtures, not a perfect first design.

**Our stack mapping:** `src/engine/docx-export/` (glyphs → lines → structure → assemble → `serializeToDocx`). This is Mode B.

---

## What the old MD got wrong

- Treated Mode B as the only story and never named Mode A.
- Claimed iLovePDF/Sejda quality from a linear phase checklist — those products ship **mode choice** + heavy iteration on real docs.
- Suggested “get DOCX serialization early” without deciding which Word layout model you are targeting (textbox vs paragraph flow). Mixing both without a mode flag produces confusing output.
- Under-specified: tagged-PDF path, header/footer, and that table detection is a separate research problem from paragraph grouping.

---

## Recommended product stance for this editor

Ship **Mode B (flowing)** as the default Word export (matches current `docx-export/` code).

Optionally add **Mode A (fixed)** later as “Exact layout” — textboxes + optional page background — for users who need visual match.

Do **not** invent a third hybrid until both modes are solid; ComPDF-style hybrids still start from this same split.

Out of scope until Mode B is strong: OCR-only scans (needs OCR layer first), complex merged cells, full font embedding parity.

---

## Build order (Mode B) — aligned to real converters

| Priority | Work | Why platforms do this first |
|---|---|---|
| 1 | Contracts: glyphs, lines, blocks, document | Stable intermediate (pdf2docx / Acrobat both reason about structure, not only bytes) |
| 2 | Glyph extraction via existing interpreter | Reuse paint pipeline; don’t re-parse PDF |
| 3 | Line + word grouping | Prerequisite for everything else |
| 4 | Paragraph + heading heuristics | Smallest end-to-end editable Word |
| 5 | DOCX serialize (paragraphs only) | Validate open-in-Word early |
| 6 | Images | High user visibility, moderate difficulty |
| 7 | Columns + reading order | Fixes “interleaved columns” class of bugs |
| 8 | Lists | Cheap once paragraphs work |
| 9 | Tables (rulings, then alignment) | Hardest; iterate longest |
| 10 | Multi-page assembly + header/footer | Cross-page polish |
| 11 | Fixture / snapshot suite | How Sejda/iLovePDF-level quality is maintained |

---

## Exit criteria (per mode)

**Mode A:** Side-by-side PDF vs DOCX look nearly identical at 100% zoom; text still selectable; editing may be painful.

**Mode B:** Simple single-column PDF opens in Word as real paragraphs; headings are Heading styles; a simple bordered table is a Word table; 2-column sample reads left column then right.

**Regression:** Every fixed bug becomes a fixture PDF + expected structure JSON (not only a binary .docx snapshot).

---

## References (behavioral, not copied code)

- Adobe Acrobat: Retain Page Layout vs Retain Flowing Text
- iLovePDF / Sejda: exact vs editable layout product options
- Industry write-ups on fixed vs reflowable PDF→Word (ComPDF, Acrobat user forums on textbox exports)
- Open-source analogues: pdf2docx (reflow), PyMuPDF textbox dumps (fixed)
