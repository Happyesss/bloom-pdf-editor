import { RegionClassifier } from '../classify.js';
import { ObjectClusterer } from '../clustering.js';
import { CoordinateNormalizer } from '../normalize.js';
import { ReadingOrderBuilder } from '../reading-order.js';
import { XYCutSegmenter } from '../segmentation.js';
import { LayoutSpatialIndex } from '../spatial-index.js';
import { WhitespaceAnalyzer } from '../whitespace.js';
import type { LayoutStrategies } from './types.js';

/** Default Phase 3 algorithm binding — swap any strategy without changing LayoutEngine API. */
export function createDefaultStrategies(): LayoutStrategies {
  return {
    normalizer: new CoordinateNormalizer(),
    createSpatialIndex: () => new LayoutSpatialIndex(),
    clusterer: new ObjectClusterer(),
    whitespace: new WhitespaceAnalyzer(),
    segmenter: new XYCutSegmenter(),
    classifier: new RegionClassifier(),
    readingOrder: new ReadingOrderBuilder(),
  };
}
