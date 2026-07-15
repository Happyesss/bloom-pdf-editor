import { CaptionLinker } from '../captions.js';
import { ChartAnalyzer } from '../charts.js';
import { GraphicsGrouper } from '../grouping.js';
import { ImageDetector } from '../images.js';
import { VectorDetector } from '../vectors.js';
import { WrappingAnalyzer } from '../wrapping.js';
import type { GraphicsStrategies } from './types.js';

export function createDefaultGraphicsStrategies(): GraphicsStrategies {
  return {
    images: new ImageDetector(),
    vectors: new VectorDetector(),
    charts: new ChartAnalyzer(),
    grouper: new GraphicsGrouper(),
    wrapping: new WrappingAnalyzer(),
    captions: new CaptionLinker(),
  };
}
