# Export Engine (Phase 8)

Semantic reconstruction and serialization of PDF page content to HTML and Markdown.

## Problem

PDF stores absolute glyph positioning. Export requires rebuilding logical structure (headings, paragraphs, lists) and emitting portable formats.

## Architecture

```
ExportPageInput (lines from flow/ or interpreter)
  → buildSemanticPage()     — classify blocks, reading order
  → exportPageToHTML()      — semantic HTML5
  → exportPageToMarkdown()  — GFM-style Markdown
```

Future modules: DOCX, SVG, PPTX, XLSX (separate serializers sharing `SemanticPage`).

## Semantic Model

| Type | Purpose |
|------|---------|
| `SemanticSpan` | Styled text fragment |
| `SemanticBlock` | Heading, paragraph, list item, etc. |
| `SemanticPage` | Ordered blocks + page dimensions |

### Block classification heuristics

| Signal | Block kind |
|--------|------------|
| fontSize ≥ 18pt | heading (level from size tiers) |
| Leading bullet/number | list-item |
| Vertical gap > 2.5× line height | new paragraph |

Reading order: sort lines by \((y \downarrow, x \rightarrow)\) in PDF coordinates (y descending).

## HTML Export

- Headings → `<h1>`–`<h6>`
- Paragraphs → `<p>`
- Consecutive list-items → wrapped in `<ul>`
- Optional full document wrapper with charset and viewport meta
- Inline styles for font-size when enabled

## Markdown Export

- ATX headings: `#` repeated by level (default)
- Setext option for h1/h2
- List items → `- item`
- Blockquotes → `> line` prefix

## ISO / Web Standards

- HTML5 semantic elements (W3C)
- Character escaping per OWASP (always on for HTML export)
- Markdown: CommonMark-compatible subset

## Gap Analysis vs Adobe Acrobat

| Export | Acrobat | This engine |
|--------|---------|-------------|
| HTML | Full CSS layout | Semantic blocks, basic styles |
| Markdown | Via Word bridge | Native `exportPageToMarkdown` |
| DOCX | Yes | Phase 8.2 |
| Tables | Advanced cell merge | Not yet |
| Images | Embedded base64 | Not yet |
| Multi-column order | Tagged PDF preferred | Geometric sort |
| Links | URI actions | Span.link when provided |

## Complexity

- `buildSemanticPage`: O(n log n) for n lines (sort)
- Export serializers: O(n) over blocks

## Memory

O(n) for blocks and output string.

## Testing Strategy

- Mixed heading + paragraph lines → correct HTML tags
- Bullet lines → single `<ul>` wrapper
- Markdown round-trip readable in CommonMark preview
- XSS: `<script>` in input escaped in HTML

## Mathematics

Reading order sort key for lines \(L_i = (x_i, y_i)\):

\[
L_i \prec L_j \iff (y_i > y_j + \varepsilon) \lor (|y_i - y_j| \leq \varepsilon \land x_i < x_j)
\]

where \(\varepsilon = 0.5 \times \min(h_i, h_j)\).
