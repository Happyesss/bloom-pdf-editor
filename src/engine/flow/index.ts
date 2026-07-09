/**
 * Document flow builder — assembles lines and paragraphs from raw PDF runs.
 */

import type { TextRun } from '../content/interpreter';
import { reconstructLines, resetLineIdCounter } from './line-reconstruction';
import { reconstructParagraphs, resetParagraphIdCounter } from './paragraph';
import type { DocumentFlow } from './types';

export function buildDocumentFlow(runs: TextRun[]): DocumentFlow {
  resetLineIdCounter();
  resetParagraphIdCounter();

  const lines = reconstructLines(runs);
  const paragraphs = reconstructParagraphs(lines);

  return {
    lines,
    paragraphs,
    rawRuns: runs,
  };
}

export { reconstructLines } from './line-reconstruction';
export { reconstructParagraphs } from './paragraph';
export { applyLineTextEdit, buildLayoutPlan } from './flow-editor';
export { hitTestTextLine, findNearestTextLine, caretIndexFromLineX, lineXFromCaretIndex } from './hit-test';
export { distributeTextToSegments, segmentAtIndex, computeLineWidthDelta } from './reflow';
export { analyzeJustification, distributeJustifiedSpace } from './justification';
export { detectTabSplitIndex, detectJustifiedBodyText, shouldUseFlowDraw } from './justification-detect';
export { computeBaseline, getRunBounds, averageCharWidth, estimateTextWidth } from './metrics';
export { greedyWrap, previewWrap } from './line-break';
export {
  computeLayoutPlan,
  computeEditPreview,
  computeHorizontalShifts,
  computeLineHeight,
  findParagraphForLine,
} from './layout';
export {
  computeFlowDrawPositions,
  buildLineDrawMap,
  buildFlowDrawIndex,
} from './flow-draw';
export { shapeText, measureText, layoutShapedGlyphs } from './shaping';
export type { LayoutPlan, LineTextEdit, RunShift } from './layout';
export type { FlowGlyphDraw } from './flow-draw';
export type { ShapedGlyph } from './shaping';

export type {
  DocumentFlow,
  TextLine,
  Paragraph,
  StyledSegment,
  SegmentEdit,
} from './types';
