# PDF Engine — Master Roadmap

Dependency-free TypeScript PDF engine targeting Adobe Acrobat parity.
See `implimentation.md` for PDF→DOCX modes (fixed layout vs flowing text) and how platforms implement them.

## Phase Status

| Phase | Subsystem | Path | Status |
|-------|-----------|------|--------|
| 0 | Editor architecture | `src/app/editor/hooks/`, `store/` | **Active** — session store, history/style hooks, WatermarkPreview extract |
| 1 | Text editing 2.0 | `flow/` | **Active** — style-edit, Knuth-Plass, bidi, caret, glue/optical margin |
| 2 | Object editing | `editing/`, `editor/object-editor.ts` | **Active** — scene graph, affine transforms, snap guides, stream patch |
| 3 | Annotations | `editor/highlight.ts`, `redaction.ts` | **Active** — Highlight from selection, redaction mark/apply |
| 4 | Forms | `forms/widget-appearances.ts` | **Active** — checkbox/radio AP, choice, NeedAppearances, /CO calc |
| 5 | Rendering | `render/type3.ts` | **Active** — Type3 CharProcs + golden smoke tests |
| 6 | Save pipeline | `writer/save-pipeline.ts` | **Active** — quick incremental / optimized GC+dedup |
| 7 | Signatures | `signatures/sign.ts` | **Active** — field create, CMS build, Web Crypto sign |
| 8 | OCR | `lib/ocr/`, `editor/invisible-text.ts` | **Active** — adapter + invisible text layer |
| 9 | Export / AI | `ai/compare.ts` | **Active** — document text compare |
| 10 | Fonts | `fonts/` | **Active** — GSUB/GPOS + font augmentation |
| 11 | Accessibility | `accessibility/` | Scaffolded |
| 12 | Color / Image | `color/`, `image/` | **Active** |
| 13 | QA | `qa/`, `__tests__/` | **Active** — 65 vitest tests passing |

## Run Tests

```bash
npm test          # run once
npm run test:watch
npm run build
```

## UI wiring (end-to-end)

- Properties sidebar bold/italic/underline/size/color/align → `applyStyleToSelectionOnPage`
- Highlight tool → real PDF Highlight annotations
- Download → Optimized / Quick save modes
- Find & replace panel + OCR recognize (stub adapter)
- Dirty-document beforeunload warning
