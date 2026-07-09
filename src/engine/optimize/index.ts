/**
 * PDF optimization — reachability analysis, stream dedup, garbage collection.
 */

export {
  buildObjectGraph,
  computeReachability,
  rootsFromTrailer,
  deduplicateStreams,
  applyRefMap,
  garbageCollect,
} from './garbage-collect';

export type {
  ObjectGraphEdge,
  ObjectGraph,
  ReachabilityResult,
  StreamDuplicateGroup,
  DeduplicateResult,
  GarbageCollectResult,
  OptimizeOptions,
} from './types';

export { DEFAULT_OPTIMIZE_OPTIONS, fnv1aHex } from './types';
