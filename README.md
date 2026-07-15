# PDF Editor + Bloom Document Intelligence

Next.js PDF editor. Structure-preserving conversion (DOCX, XLSX, PPTX, HTML, Markdown, EPUB, …) runs **inside Next.js Route Handlers** via the `@bloom/document-engine` package — no second process, URL, or API key for local use.

## Getting Started

```bash
npm install
npm --prefix server install   # engine deps (once)
npm run dev                   # builds engine → starts Next
```

Open [http://localhost:3000](http://localhost:3000).

Bloom runs **inside Next.js** (same process):

```
Browser → /api/bloom/* (Route Handlers) → server/dist (compiled engine)
```

No `BLOOM_ENGINE_URL`, no API key, no second terminal.

The `server/` folder holds the conversion library + its Vitest suite. Optional standalone HTTP (`npm run server:dev` on :8787) is only for Docker/ops — not required for the editor.

## Convert a PDF

1. Upload a PDF → editor.
2. Toolbar → **Export** → **Document convert**.
3. Pick a format → convert → download.

**Images & text** in the same panel still export client-side (PNG / JPEG / SVG render / plain text).

## Architecture

```
Browser (client)
  → /api/bloom/*  (Next.js Route Handlers, server-only)
  → @bloom/document-engine  (in-process: queue + UDM + exporters)
```

See [`server/README.md`](server/README.md) for engine phases and Docker.
