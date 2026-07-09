# AI Document Layer (Phase 12)

Document chunking, embedding-ready text blocks, and local semantic search for RAG-style PDF workflows.

## Problem

Downstream AI features (QA, summarization, contract compare) need:

1. Coherent text chunks within embedding model limits
2. Stable metadata (page, bbox, heading context)
3. Retrievable index for semantic search

This phase provides pure-TypeScript chunking and TF-IDF retrieval without external embedding APIs.

## Architecture

```
ChunkDocumentInput (paragraphs from flow/export/a11y)
  → chunkDocument()              — sentence-bounded splits + overlap
  → toEmbeddingBlocks()          — API-ready strings
  → buildSemanticSearchIndex()   — TF-IDF vectors
  → searchSemanticIndex()        — cosine top-K
  → (future) external embeddings + vector DB
```

## Chunking Algorithm

1. Iterate paragraphs in reading order
2. Split into sentences (`/.!?/` boundaries)
3. Accumulate sentences until `estimateTokens > maxTokens`
4. Flush chunk; carry `overlapTokens` tail into next buffer
5. Prefix heading context when enabled: `[Heading]\n`

### Token estimate

\[
\text{tokens} \approx \lceil 1.3 \times \text{wordCount} \rceil
\]

Matches common OpenAI tokenizer ballpark for English without pulling tiktoken.

**Complexity:** O(total characters).

**Memory:** O(chunks × avg chunk size).

## Embedding Blocks

`toEmbeddingBlocks()` produces:

```
Section: {headingContext}

{chunk text}
```

Suitable input for external `text-embedding-3-*` or local models. Optional `vector` field reserved for precomputed embeddings.

## Semantic Search Index

### TF-IDF construction

For each chunk \(d\), term \(t\):

\[
\text{tf}(t,d) = \frac{\text{count}(t,d)}{\max_{t'} \text{count}(t',d)}
\]

\[
\text{idf}(t) = \log\frac{N+1}{\text{df}(t)+1} + 1
\]

\[
\text{tfidf}(t,d) = \text{tf}(t,d) \times \text{idf}(t)
\]

Vectors are L2-normalized for cosine similarity via dot product:

\[
\text{sim}(q, d) = \hat{q} \cdot \hat{d}
\]

Stop words filtered (English list); Unicode letters via `\p{L}`.

**Index build:** O(C × V) where C = chunks, V = vocab size.

**Query:** O(C × V) — adequate for in-browser document scope; migrate to HNSW when embedding dim high.

## Gap Analysis vs Adobe Acrobat

| Feature | Acrobat AI Assistant | This engine |
|---------|---------------------|-------------|
| Document QA | Cloud LLM + proprietary index | Local TF-IDF retrieval |
| Semantic search | Embeddings (cloud) | TF-IDF cosine (local) |
| Citations | Page links | ChunkSource bbox + pageIndex |
| Summarization | Yes | Chunk input only |
| Auto redaction | Preview | Not yet |
| Table-aware chunks | Yes | Paragraph input only |

## Edge Cases

- Empty document → empty index, search returns []
- Very short paragraphs below `minTokens` → dropped unless final flush
- Non-English text → stop word filter may be suboptimal (future locale lists)
- Duplicate paragraphs → duplicate chunks (dedup future)

## Testing Strategy

- Long paragraph splits at maxTokens boundary
- Overlap carries trailing words into next chunk
- Search "payment terms" ranks relevant chunk highest
- `indexDocument()` round-trip

## Future Integration

```
chunkDocument → external embed → store Float32Array on EmbeddingBlock
buildSemanticSearchIndex → replace TF-IDF with cosine on embedding dim
RAG prompt orchestration → Phase 12.2
```

## Privacy

All processing is in-process. No network calls — suitable for air-gapped PDF review before optional cloud embedding.
