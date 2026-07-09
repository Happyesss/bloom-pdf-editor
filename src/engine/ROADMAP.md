# PDF Engine — Master Roadmap

Dependency-free TypeScript PDF engine targeting Adobe Acrobat parity.
See `implimentation.txt` for the full multi-agent development contract.

## Phase Status

| Phase | Subsystem | Path | Status |
|-------|-----------|------|--------|
| 1 | Rendering 2.0 | `render/` | **Active** — GS stack, transparency, soft-mask /G groups, patterns |
| 2 | Font Engine | `fonts/` | **Active** — GSUB ligatures, GPOS kerning/mark positioning |
| 3 | Color Management | `color/` | **Active** — ICC mft2 trilinear CLUT + lut8 |
| 4 | Image Engine | `image/` | **Active** — JPEG/flate/mask decoder |
| 5 | Editing Engine | `editing/` | **Active** — quadtree selection, TransactionStack in editor UI |
| 6 | Forms | `forms/` | **Active** — detection, fill UI, flatten to content stream |
| 7 | OCR | `ocr/` | **Scaffolded** — projection profiles, deskew |
| 8 | Export | `export/` | **Scaffolded** — HTML/Markdown export |
| 9 | Optimization | `optimize/` | **Scaffolded** — reachability GC, stream dedup |
| 10 | Digital Signatures | `signatures/` | **Scaffolded** — ASN.1 DER, CMS verify |
| 11 | Accessibility | `accessibility/` | **Scaffolded** — structure tree walker |
| 12 | AI Layer | `ai/` | **Scaffolded** — chunking, TF-IDF search |
| 13 | QA & Compliance | `qa/` | **Active** — vitest + canvas render integration tests |

## Run Tests

```bash
npm test          # run once
npm run test:watch
npm run build
```

## Next Priorities

1. **Phase 1** — Type 3 glyph outline text rendering
2. **Phase 2** — Full GPOS mark-to-base attachment in text draw
3. **Phase 6** — Checkbox/radio field UI + appearance preview
4. **Phase 7** — OCR pipeline wired to scanned PDF import
5. **Phase 13** — Soft-mask + ICC golden-file render tests
