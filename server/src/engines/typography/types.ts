/**
 * Phase 5 — Typography & Style Analysis (visual only, no semantic labels).
 */

export interface TypographyFeatures {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  fontWeight: number;
  letterSpacing: number;
  wordSpacing: number;
  lineHeight: number;
  paragraphSpacing: number;
  textColor?: string;
  backgroundColor?: string;
  opacity: number;
  writingDirection: 'ltr' | 'rtl' | 'ttb';
  rotation: number;
  alignment: 'left' | 'center' | 'right' | 'justify' | 'mixed';
  firstLineIndent: number;
  hangingIndent: number;
  leftIndent: number;
}

export interface StyleSample {
  blockId: string;
  pageIndex: number;
  features: TypographyFeatures;
  textLength: number;
}

export interface StyleProfile {
  id: string;
  features: TypographyFeatures;
  confidence: number;
  occurrenceCount: number;
  sampleBlockIds: string[];
  /** Normalized cluster key for debugging. */
  clusterKey: string;
}

export interface StyleGraphNode {
  profileId: string;
  parentStyleId: string | null;
  derivedStyleIds: string[];
  siblingStyleIds: string[];
  usageFrequency: number;
}

export interface StyleGraph {
  nodes: StyleGraphNode[];
  edges: Array<{ from: string; to: string; relation: 'parent' | 'derived' | 'sibling' }>;
}

export interface TypographyStatistics {
  primaryFonts: Array<{ font: string; count: number; share: number }>;
  secondaryFonts: Array<{ font: string; count: number; share: number }>;
  colorPalette: Array<{ color: string; count: number }>;
  dominantFontSizes: Array<{ size: number; count: number }>;
  commonAlignments: Array<{ alignment: string; count: number }>;
  styleFrequency: Array<{ profileId: string; count: number }>;
  averages: {
    characterSpacing: number;
    wordSpacing: number;
    lineHeight: number;
    paragraphGap: number;
    sectionGap: number;
    pageMarginLeft: number;
    pageMarginRight: number;
    pageMarginTop: number;
    pageMarginBottom: number;
    columnGap: number;
  };
  sampleCount: number;
}

export interface TypographyMap {
  /** blockId → style profile id */
  blockToProfile: Record<string, string>;
  /** runId → style profile id (when available) */
  runToProfile: Record<string, string>;
}

export interface TypographyAnalysis {
  id: string;
  sourceDocumentId: string;
  profiles: StyleProfile[];
  graph: StyleGraph;
  statistics: TypographyStatistics;
  typographyMap: TypographyMap;
  samples: StyleSample[];
}
