# Export Engine

Semantic reconstruction and serialization of PDF page content to Markdown.
DOCX uses the dedicated `docx-export/` pipeline (see `implimentation.md`).

## Problem

PDF stores absolute glyph positioning. Export requires rebuilding logical structure
(headings, paragraphs, lists, tables) and emitting portable formats.

## Architecture

```
ExportPageInput (lines from flow/ or interpreter)
  → buildSemanticPage()       — classify blocks, reading order
  → exportPageToMarkdown()    — GFM-style Markdown

ExtractedDocument (docx-export structure)
  → structureToMarkdown()     — shared structure → Markdown
```

## Semantic Model

| Type | Purpose |
|------|---------|
| `SemanticSpan` | Styled text fragment |
| `SemanticBlock` | Heading, paragraph, list item, table, etc. |
| `SemanticPage` | Ordered blocks + page dimensions |

### Block classification heuristics

| Signal | Block kind |
|--------|------------|
| fontSize ≥ 18pt | heading (level from size tiers) |
| Leading bullet/number | list-item |
| Vertical gap > 2.5× line height | new paragraph |

Reading order: sort lines by \((y \downarrow, x \rightarrow)\) in PDF coordinates (y descending).

## Markdown Export

- ATX headings: `#` repeated by level (default)
- Setext option for h1/h2
- List items → `- item`
- Tables → GFM pipe tables
- Blockquotes → `> line` prefix

## Complexity

- `buildSemanticPage`: O(n log n) for n lines (sort)
- Export serializers: O(n) over blocks

## Testing Strategy

- Mixed heading + paragraph lines → correct Markdown markers
- Bullet lines → list items
- Tables → pipe tables, not stacked paragraphs
