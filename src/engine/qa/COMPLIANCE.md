# Phase 13 — QA & Standards Compliance

## Validation Targets

| Standard | Scope | Status |
|----------|-------|--------|
| ISO 32000-2 | Core PDF syntax, graphics, text | Partial |
| PDF/A | Archival | Not started |
| PDF/X | Print | Not started |
| PDF/UA | Accessibility | Phase 11 |
| Adobe Acrobat | Rendering parity | In progress |

## Test Strategy

### Unit Tests (`src/engine/__tests__/`)
- Graphics state matrix math
- Justification detection (tab vs body)
- OpenType shaping + kerning
- ICC profile header parsing
- Quadtree hit testing
- Transaction stack undo/redo

### Integration Tests
- Parse → interpret → render pipeline
- Text edit → re-render roundtrip
- Flow line reconstruction on sample streams

### Regression Suite
- Resume layout (tab-aligned lines must NOT justify)
- Justified body paragraphs
- Embedded TrueType fonts
- CMYK color conversion

## Compliance Matrix

| Feature | Our Engine | Acrobat | Gap |
|---------|-----------|---------|-----|
| FlateDecode | Yes | Yes | — |
| TrueType embed | Yes | Yes | GSUB/GPOS partial |
| Text edit | Yes | Yes | No full reflow |
| Justified render | Partial | Yes | Complex scripts |
| Forms | Scaffold | Yes | Full AcroForm |
| Signatures | Scaffold | Yes | PKCS#7 verify |
| OCR | Scaffold | Yes | ML models |
| ICC profiles | Header parse | Full transform | LUT missing |

## Running Tests

```bash
npm test
```
