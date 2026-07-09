/**
 * AI document layer — chunking, embedding blocks, semantic search index.
 */

export {
  estimateTokens,
  chunkDocument,
  toEmbeddingBlocks,
  buildSemanticSearchIndex,
  searchSemanticIndex,
  indexDocument,
  resetChunkIdCounter,
} from './document-chunker';

export type {
  ChunkSource,
  DocumentChunk,
  EmbeddingBlock,
  IndexTerm,
  SemanticSearchIndex,
  ChunkingOptions,
  SearchOptions,
  SearchHit,
  ChunkInputParagraph,
  ChunkDocumentInput,
} from './types';

export { DEFAULT_CHUNKING_OPTIONS, DEFAULT_SEARCH_OPTIONS } from './types';
