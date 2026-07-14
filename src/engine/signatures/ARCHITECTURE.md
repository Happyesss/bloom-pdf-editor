# Digital Signatures Engine

ASN.1 DER parsing, PKCS#7/CMS, visual signatures, fields, certificates, validation, timestamps, LTV.

## Folder layout

```
src/engine/signatures/
  index.ts              # public barrel (re-exports all)
  visual/               # Phases 1–3 — overlays, library, draw/import/typed, appearances
  fields/               # Phases 4–5 — AcroForm Sig fields + /AP streams
  crypto/               # Phases 7–8 — hash, CMS, ByteRange, signing pipeline
  certificates/         # Phase 9 — PEM/DER/P12 import + manager
  validation/           # Phase 10 — validation engine + report types
  timestamp/            # Phase 11 — RFC 3161 TSA client
  multi/                # Phase 12 — multi-signature + revision viewer
  ltv/                  # Phase 13 — DSS / long-term validation
  ux/                   # Phase 14 — shortcuts, recent list, guides

src/app/editor/components/signatures/   # editor UI
src/engine/__tests__/signatures/        # unit tests + fixtures
```

## Public API

Import from `@/engine` or `../signatures` — do not deep-import subfolders from app code unless necessary.

## Standards

| Standard | Scope |
|----------|------|
| ISO 32000-2 §12.8 | Signature dictionaries, ByteRange |
| RFC 5652 | CMS SignedData |
| RFC 3161 | Timestamps |
| ETSI EN 319 142 | PAdES / LTV (DSS) |
