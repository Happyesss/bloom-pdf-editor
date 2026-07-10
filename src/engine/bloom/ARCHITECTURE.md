# Bloom Engine

Word-like **document model** for understanding PDF text (hit-test / structure).

## Critical rule (editor)

**Do not compile or redraw PDF text through Bloom on edit.**

That path caused upside-down ghosts and overlapping layers. The editor commits with
surgical `applyLineTextEdit` (in-place `Tj`/`TJ` replace, original `Tm` kept).

| Role | Owner |
|------|--------|
| Display | PDF canvas only |
| Edit UX | Positioned HTML overlay on the clicked line |
| Commit | `applyLineTextEdit` — one line, preserve positions |
| Bloom | Ingest / hit-test / future reflow — not stream rewrite |

```
PDF → interpret → flow lines → click line → HTML overlay
                              → commit → applyLineTextEdit → updatePageContent
```
