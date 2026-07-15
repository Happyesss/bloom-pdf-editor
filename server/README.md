# Bloom Document Intelligence Engine

Server-side conversion engine. **Exporters consume only the Unified Document Model (UDM)** — never the PDF parser.

```
Upload → Parse → OCR/Fusion → Layout → IDM → Typography → Semantic → Tables → Graphics → Structure → UDM → DOCX/XLSX/PPTX/HTML/MD/EPUB/RTF/ODT/TXT/JSON/XML/SVG → Download
```

## Phases

| Phase | Status | Scope |
|-------|--------|--------|
| 1 | Done | Architecture, DI, jobs, queue, workers, IDM skeleton, API |
| 2 | Done | Fresh PDF parser, raw model, object graph, spatial index |
| 3 | Done | Layout analysis → `LayoutDocument` (regions + reading order) |
| 4 | Done | IDM reconstruction, tree API, JSON/binary serialization |
| 5 | Done | Typography & style profiles (visual only) |
| 6 | Done | Semantic structure (headings, lists, paragraphs, …) |
| 7 | Done | Table detection & logical reconstruction (bordered/borderless) |
| 8 | Done | Graphics reconstruction (images, vectors, charts, wrapping) |
| 9 | Done | Document structure (headers/footers, TOC, bookmarks, …) |
| 10 | Done | OCR & recognition fusion (pluggable providers) |
| 11 | Done | Unified Document Model + DOCX export (OpenXML) |
| 12 | Done | XLSX export (logical tables → worksheets) |
| 13 | Done | PPTX export (page → editable slides) |
| 14 | Done | Universal exporters (HTML/MD/EPUB/RTF/ODT/TXT/JSON/XML/SVG) + plugin SDK |
| 15 | Done | Production slice (priority/retry/DLQ queue, health/metrics/batch, rate limit, Docker) |

## Quick start

```bash
cd server
npm install
npm run dev          # http://0.0.0.0:8787
npm test
```

### Used from the Next.js app (default)

The editor imports this package **in-process** (`@bloom/document-engine` → Next Route Handlers under `/api/bloom/*`). Run only:

```bash
npm run dev   # from repo root
```

No separate URL or API key. This HTTP server (`npm run dev` in `server/`) is optional for Docker / standalone ops.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness + queue depth + supported targets (phases 1–15) |
| `GET` | `/metrics` | Queue stats + telemetry averages |
| `POST` | `/convert` | Upload PDF (`multipart` file+target, or raw body + `x-target`) |
| `POST` | `/batch` | JSON `{ items: [{ filename, target, contentBase64 }] }` → job ids |
| `GET` | `/jobs/:id` | Job status |
| `GET` | `/download/:id` | Result bytes |
| `DELETE` | `/jobs/:id` | Cancel (removes pending queue item) |

Optional headers: `x-api-key` (when `BLOOM_API_KEY` set), `x-correlation-id`, `x-priority` (`high` \| `normal` \| `low`).

Example:

```bash
curl -F file=@doc.pdf -F target=html http://localhost:8787/convert
curl http://localhost:8787/jobs/<id>
curl http://localhost:8787/health
```

## Docker

```bash
cd server
docker build -t bloom-engine .
docker run --rm -p 8787:8787 bloom-engine
```

Env vars: `BLOOM_PORT`, `BLOOM_HOST`, `BLOOM_API_KEY`, `BLOOM_STORAGE_ROOT`, `BLOOM_JOB_TIMEOUT_MS`, `BLOOM_RATE_LIMIT`, `BLOOM_QUEUE_MAX_RETRIES`.

Graceful shutdown: `SIGINT` / `SIGTERM` stop the queue worker then exit.

## Layout

```
server/src/
  api/           HTTP (Hono)
  workers/       Conversion pipeline
  queues/        Priority / retry / DLQ in-memory queue
  engines/
    parser/      PDF → RawDocument
    layout/      LayoutDocument
    ocr/         Recognition fusion
    idm/         Intermediate Document Model
    typography/  Style profiles
    semantic/    Semantic structure
    table/       Table detection
    graphics/    Graphics reconstruction
    structure/   Headers/footers/TOC/…
    udm/         Unified Document Model
    exporter/    Plugin SDK + all format exporters
    common/      Shared interfaces + geometry
  storage/       Local filesystem / memory
  cache/
  jobs/
  telemetry/
  utils/
  tests/
```

## Architecture rules

1. Never convert PDF → format directly.
2. Exporters depend only on UDM (assembled from IDM + semantic + tables + graphics + structure).
3. Parser produces `RawDocument` + `ObjectGraph` + per-page `PageSpatialIndex`.
4. No paragraph/table/reading-order logic in the parser.
