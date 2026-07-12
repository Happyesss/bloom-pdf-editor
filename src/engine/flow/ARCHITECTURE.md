# PDF Flow Engine

Logical text layout layer built on top of the low-level PDF interpreter. PDF stores text as absolutely-positioned glyph runs; this layer reconstructs lines and paragraphs so editing behaves like Word/Acrobat.

## Problem

PDF content streams position each fragment independently:
- Bold and regular text on the same line are **separate** `Tj`/`TJ` operators
- Justification is encoded in `TJ` spacing arrays and `Tw` (word spacing)
- The low-level engine had no line model → editing one "box" overlapped neighbors

## Architecture

```
PDF bytes
  → parser/          (tokenize objects, decode streams)
  → content/         (interpreter: operators → glyph runs + display list)
  → flow/            (THIS LAYER: runs → lines → paragraphs)
  → render/          (canvas drawing from display list)
  → editor/          (content stream mutation)
```

### Modules

| Module | Responsibility |
|--------|----------------|
| `types.ts` | `TextLine`, `Paragraph`, `DocumentFlow`, `StyledSegment` |
| `metrics.ts` | Baselines, bounds, advance widths, gap measurement |
| `line-reconstruction.ts` | Baseline clustering → logical lines |
| `paragraph.ts` | Margin + vertical gap clustering → paragraphs |
| `justification.ts` | TJ/Tw gap analysis, even space distribution |
| `reflow.ts` | Distribute edited line text back to styled runs |
| `line-break.ts` | Greedy word wrapping at line boundaries |
| `layout.ts` | Paragraph reflow, overflow cascade, position shifts |
| `flow-draw.ts` | Flow-based glyph positions for justified line drawing |
| `shaping.ts` | OpenType advances, kern table, basic ligatures (fi/fl) |
| `hit-test.ts` | Line-level click/caret (not per-run boxes) |
| `flow-editor.ts` | Commit line edits with paragraph layout |

## Algorithms

### Line reconstruction (baseline clustering)

Used by PDF.js, MuPDF, Acrobat text extraction:

1. For each run, compute baseline = median glyph `tRm.f`
2. Sort runs by baseline descending (PDF y-up)
3. Greedy cluster: assign to line if `|y₁ − y₂| < max(2, 0.35 × fontSize)`
4. Sort runs within line by left edge (reading order)
5. Detect justification from inter-run gap distribution

**Math:** baseline tolerance ε = max(2pt, 0.35 × fontSize)

### Justification

PDF spec: `TJ` numeric adjustment displaces cursor by:
```
Δx = −n/1000 × fontSize × (Tz/100)
```

Analysis:
- Natural width = Σ run widths
- Extra space = line width − natural width
- Large gaps (> 1.8× avg char width) are justification slots
- Even distribution: `gap_i = totalExtra / numLargeGaps`

### Reflow / style preservation

On line edit:
1. User edits full line text (all runs concatenated)
2. `distributeTextToSegments()` splits new text proportionally across original styled segments
3. Word-boundary snapping prevents mid-word font changes
4. Each segment updates its own `Tj`/`TJ` instruction

### Paragraph layout (wrap + push-down)

On line edit inside a paragraph:
1. `greedyWrap()` splits new text at word boundaries to fit line width
2. Overflow cascades to subsequent lines (merged with displaced text)
3. `computeHorizontalShifts()` moves trailing styled runs when a segment grows
4. Lines below the edit shift down via `applyRunPositionShifts()` (Tm/Td mutation)
5. `applyLineTextEdit()` commits all line edits + position shifts atomically

**Math:** line height = max(height, fontSize × 1.2); vertical shift Δy = −(wrapLines − 1) × lineHeight

### Flow-based draw (punctuation packing only)

The renderer keeps **native PDF glyph positions** (Acrobat / PDF.js / PDFBox parity).
Redistributing inter-word gaps diverges from the file and creates uneven rivers.

1. `buildFlowDrawIndex()` only marks lines with bold→punctuation artifacts
2. `packPunctAtNativeWordOrigins()` compresses medium gaps before `,.:;!?)`
3. Word spacing / TJ justification is left exactly as the PDF encoded it
4. Canvas draws word chunks with horizontal scale so substitute fonts fill each PDF width slot

Non-packed lines use raw glyph `tRm` positions from the PDF.

### OpenType shaping (basic)

`shaping.ts` provides accurate width measurement for layout and justified drawing:

1. `shapeText()` — maps Unicode → glyph IDs via embedded cmap
2. Advance widths from `hmtx` (TrueType) or PDF `/Widths` arrays
3. Legacy `kern` table parsing for pairwise kerning adjustments
4. Basic ligature substitution (`fi`, `fl`, `ff`, `ffi`, `ffl`) via post table glyph names
5. `measureText()` feeds into `flow-draw.ts` for even justification gap calculation

### Caret placement

Binary search over glyph midpoints across all runs on the line:
```
caretIndex = argmin_i |pdfX − (glyph[i].x + glyph[i].width/2)|
```

## Maths required (full Word/Acrobat parity)

| Area | Maths / algorithms |
|------|-------------------|
| Transforms | 2×3 affine matrices, composition, inversion |
| Paths | Bézier curves (quadratic/cubic), stroke/fill |
| Font metrics | Em-square, ascent/descent/leading, advance widths |
| Shaping | GPOS/GSUB, ligatures, kerning (HarfBuzz-class) |
| Line breaking | Knuth-Plass / greedy wrap, hyphenation |
| Justification | Inter-word and inter-char space distribution |
| Bidi | UAX #9 bidirectional algorithm |
| Hit testing | Point-in-rect, distance to glyph midpoints |
| Reflow | Dynamic width measurement, line push-down |

## Future modules (not yet implemented)

- `shaping.ts` — HarfBuzz WASM for complex scripts (Arabic, Devanagari); GSUB/GPOS full parsing
- `line-break.ts` — Knuth-Plass paragraph wrapping (upgrade from greedy)
- `bidi.ts` — Unicode bidirectional text
- `caret.ts` — Grapheme-cluster-aware caret movement

## Tools that may be needed

- **HarfBuzz WASM** — complex script shaping (Arabic, Devanagari)
- **Canvas measureText** — fallback width measurement
- **Embedded font parsing** — already in `fonts/truetype-parser.ts`
- **Incremental writer** — already in `writer/incremental-writer.ts`
