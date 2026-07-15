/**
 * Library entry for embedding Bloom inside Next.js (or other hosts).
 * Does not start an HTTP server — use `src/index.ts` for the standalone process.
 */

export { createContainer } from './container.js';
export type { BloomContainer, CreateContainerOptions } from './container.js';
export {
  ALL_CONVERT_TARGETS,
  type ConvertRequest,
  type ConvertTarget,
  type Job,
  type JobState,
} from './jobs/types.js';
