# Golden Render Corpus

Strategy for Acrobat-class visual regression:

1. Curate PDFs under `fixtures/` (resume, brochure, form, scan-with-text).
2. Render each page at scale `1.0` with `renderPage()`.
3. Compare canvas pixel buffers (or PNG hashes) against committed goldens.
4. Allow small tolerance for antialiasing (ΔE or max 2% pixel diff).

## Minimal smoke test

`golden-smoke.test.ts` builds a synthetic one-page PDF, renders it, and asserts
non-zero canvas dimensions — proving the render pipeline is wired for golden diffs.
