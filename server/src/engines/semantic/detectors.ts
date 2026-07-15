import type { Block, IntermediateDocument, Run } from '../idm/types.js';
import type { LayoutDocument } from '../layout/types.js';
import type { StyleProfile, TypographyAnalysis } from '../typography/types.js';
import type {
  HeadingLevel,
  ListStyle,
  SemanticCaption,
  SemanticCodeBlock,
  SemanticHeading,
  SemanticImage,
  SemanticList,
  SemanticListItem,
  SemanticParagraph,
  SemanticQuote,
  SemanticRun,
} from './types.js';
import { createId } from '../../utils/id.js';

export interface BlockContext {
  block: Block;
  pageIndex: number;
  pageWidth: number;
  pageHeight: number;
  styleProfile?: StyleProfile;
  bodyMedianFontSize: number;
  layoutNearImage: boolean;
}

const BULLET_RE = /^\s*([•●○▪▸►‣◉*-])\s+/;
const NUMBERED_RE = /^\s*(\d{1,3})[.)]\s+/;
const ALPHA_RE = /^\s*([a-zA-Z])[.)]\s+/;
const ROMAN_RE = /^\s*([ivxlcdmIVXLCDM]{1,6})[.)]\s+/;
const CHECKBOX_RE = /^\s*[\[\(](?:x|X| |_)[\]\)]\s+/;
const HYPHEN_BREAK_RE = /([A-Za-z]{2,})-\s*$/;

export function blockPlainText(block: Block): string {
  if (!('runs' in block)) return '';
  return block.runs.map((r) => r.text).join('');
}

export function toSemanticRuns(block: Block, styleProfileId?: string): SemanticRun[] {
  if (!('runs' in block)) return [];
  return block.runs.map((r: Run) => ({
    id: r.id,
    text: r.text,
    bold: r.bold,
    italic: r.italic,
    underline: r.underline,
    fontName: r.fontName,
    fontSize: r.fontSize,
    color: r.color,
    link: r.link,
    styleProfileId,
  }));
}

/** Merge soft line breaks / hyphenation into paragraph text. */
export function reconstructParagraphText(raw: string): string {
  const lines = raw.split(/\n/);
  if (lines.length <= 1) return raw.trim();

  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    const next = lines[i + 1];
    if (!next) {
      out += line;
      break;
    }
    const m = line.match(HYPHEN_BREAK_RE);
    if (m) {
      out += line.replace(/-\s*$/, '') + next.trimStart();
      i++;
      if (i < lines.length - 1) out += ' ';
      continue;
    }
    // Soft wrap: join with space if current doesn't end sentence-hard
    if (/[.!?:;]$/.test(line.trim()) || line.trim() === '') {
      out += line + '\n';
    } else {
      out += line.replace(/\s+$/, '') + ' ' + next.trimStart();
      i++;
      if (i < lines.length - 1 && !/[.!?:;]$/.test(out.trim())) {
        /* continue */
      }
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

function matchListPrefix(text: string): {
  listStyle: ListStyle;
  marker: string;
  ordered: boolean;
  cleaned: string;
} | null {
  const t = text.trim();
  if (!t) return null;

  if (CHECKBOX_RE.test(t)) {
    return {
      listStyle: 'checkbox',
      marker: t.match(CHECKBOX_RE)?.[0]?.trim() ?? '',
      ordered: false,
      cleaned: t.replace(CHECKBOX_RE, '').trim(),
    };
  }
  if (BULLET_RE.test(t)) {
    return {
      listStyle: 'bullet',
      marker: t.match(BULLET_RE)?.[1] ?? '•',
      ordered: false,
      cleaned: t.replace(BULLET_RE, '').trim(),
    };
  }
  if (NUMBERED_RE.test(t)) {
    return {
      listStyle: 'numbered',
      marker: t.match(NUMBERED_RE)?.[1] ?? '',
      ordered: true,
      cleaned: t.replace(NUMBERED_RE, '').trim(),
    };
  }
  if (ROMAN_RE.test(t) && t.length < 200) {
    return {
      listStyle: 'roman',
      marker: t.match(ROMAN_RE)?.[1] ?? '',
      ordered: true,
      cleaned: t.replace(ROMAN_RE, '').trim(),
    };
  }
  if (ALPHA_RE.test(t) && t.length < 200) {
    return {
      listStyle: 'alphabetic',
      marker: t.match(ALPHA_RE)?.[1] ?? '',
      ordered: true,
      cleaned: t.replace(ALPHA_RE, '').trim(),
    };
  }
  return null;
}

export function detectList(ctx: BlockContext): SemanticList | null {
  const text = blockPlainText(ctx.block).trim();
  if (!text) return null;

  // Support single-line markers and multi-line blocks where each line is an item
  const lines = text.includes('\n')
    ? text.split(/\n/).map((l) => l.trim()).filter(Boolean)
    : [text];

  const parsed = lines.map(matchListPrefix);
  if (!parsed[0] || parsed.some((p) => !p)) {
    // Also accept "- " / "* " glued without newline (rare)
    if (!parsed[0]) return null;
  }

  const first = parsed[0]!;
  const listId = createId('slist');
  const indent = ctx.block.bbox?.x ?? 0;
  const level = Math.max(0, Math.floor(indent / 36));
  const items: SemanticListItem[] = [];

  const itemLines = parsed.every((p) => p != null) ? parsed : [first];

  for (let i = 0; i < itemLines.length; i++) {
    const p = itemLines[i]!;
    if (!p) continue;
    const itemId = createId('sitem');
    const item: SemanticListItem = {
      id: itemId,
      type: 'list_item',
      parentId: listId,
      childIds: [],
      readingOrderIndex: ctx.block.readingOrderIndex + i * 0.01,
      confidence: 0.8,
      pageIndex: ctx.pageIndex,
      bbox: ctx.block.bbox,
      sourceBlockIds: [ctx.block.id],
      styleProfileId: ctx.styleProfile?.id,
      runs: [{ id: createId('srun'), text: p.cleaned, styleProfileId: ctx.styleProfile?.id }],
      text: p.cleaned,
      level,
      marker: p.marker,
    };
    items.push(item);
  }

  if (items.length === 0) return null;

  return {
    id: listId,
    type: 'list',
    parentId: null,
    childIds: items.map((i) => i.id),
    readingOrderIndex: ctx.block.readingOrderIndex,
    confidence: 0.8,
    pageIndex: ctx.pageIndex,
    bbox: ctx.block.bbox,
    sourceBlockIds: [ctx.block.id],
    styleProfileId: ctx.styleProfile?.id,
    listStyle: first.listStyle,
    ordered: first.ordered,
    items,
  };
}

export function detectHeading(ctx: BlockContext): SemanticHeading | null {
  if (ctx.block.type === 'image') return null;
  const text = reconstructParagraphText(blockPlainText(ctx.block));
  if (!text || text.length > 200) return null;

  const fontSize =
    ctx.styleProfile?.features.fontSize ??
    ('runs' in ctx.block ? ctx.block.runs[0]?.fontSize : undefined) ??
    12;
  const bold = ctx.styleProfile?.features.bold ?? false;
  const alignment = ctx.styleProfile?.features.alignment ?? ctx.block.alignment ?? 'left';

  // Title: large, near top, short
  const topBand =
    ctx.block.bbox != null
      ? (ctx.pageHeight - (ctx.block.bbox.y + ctx.block.bbox.height)) / ctx.pageHeight
      : 1;

  const sizeRatio = fontSize / Math.max(ctx.bodyMedianFontSize, 1);

  if (
    (ctx.block.type === 'title' || (sizeRatio >= 1.6 && topBand <= 0.25 && text.length < 120)) &&
    !detectList(ctx)
  ) {
    return makeHeading(ctx, 'title', 1, text, 0.85);
  }

  if (ctx.block.type === 'heading' || (sizeRatio >= 1.25 && (bold || sizeRatio >= 1.4))) {
    const level = headingLevelFromRatio(sizeRatio);
    if (topBand <= 0.2 && sizeRatio >= 1.35 && alignment === 'center' && text.length < 80) {
      return makeHeading(ctx, 'subtitle', Math.min(2, level) as HeadingLevel, text, 0.7);
    }
    return makeHeading(ctx, 'heading', level, text, 0.75 + Math.min(0.15, (sizeRatio - 1) * 0.1));
  }

  // Style-profile based: significantly larger than body
  if (sizeRatio >= 1.35 && text.split(/\s+/).length <= 12 && !/[.!?]$/.test(text)) {
    return makeHeading(ctx, 'heading', headingLevelFromRatio(sizeRatio), text, 0.65);
  }

  return null;
}

function makeHeading(
  ctx: BlockContext,
  type: 'title' | 'subtitle' | 'heading',
  level: HeadingLevel,
  text: string,
  confidence: number,
): SemanticHeading {
  return {
    id: createId('sh'),
    type,
    level,
    parentId: null,
    childIds: [],
    readingOrderIndex: ctx.block.readingOrderIndex,
    confidence,
    pageIndex: ctx.pageIndex,
    bbox: ctx.block.bbox,
    sourceBlockIds: [ctx.block.id],
    styleProfileId: ctx.styleProfile?.id,
    runs: toSemanticRuns(ctx.block, ctx.styleProfile?.id),
    text,
  };
}

function headingLevelFromRatio(ratio: number): HeadingLevel {
  if (ratio >= 1.8) return 1;
  if (ratio >= 1.55) return 2;
  if (ratio >= 1.4) return 3;
  if (ratio >= 1.3) return 4;
  if (ratio >= 1.2) return 5;
  return 6;
}

export function detectCaption(ctx: BlockContext): SemanticCaption | null {
  if (ctx.block.type === 'caption') {
    return makeCaption(ctx, 0.9);
  }
  const text = reconstructParagraphText(blockPlainText(ctx.block));
  if (!text || text.length > 180) return null;

  const fontSize = ctx.styleProfile?.features.fontSize ?? 12;
  const looksLikeCaption =
    ctx.layoutNearImage &&
    fontSize <= ctx.bodyMedianFontSize * 0.95 &&
    (/^(figure|fig\.|table|tbl\.|chart|image)\b/i.test(text) || text.length < 100);

  if (looksLikeCaption || (ctx.block.styleCandidates.includes('Possible Caption') && ctx.layoutNearImage)) {
    return makeCaption(ctx, 0.75);
  }
  return null;
}

function makeCaption(ctx: BlockContext, confidence: number): SemanticCaption {
  const text = reconstructParagraphText(blockPlainText(ctx.block));
  return {
    id: createId('scap'),
    type: 'caption',
    parentId: null,
    childIds: [],
    readingOrderIndex: ctx.block.readingOrderIndex,
    confidence,
    pageIndex: ctx.pageIndex,
    bbox: ctx.block.bbox,
    sourceBlockIds: [ctx.block.id],
    styleProfileId: ctx.styleProfile?.id,
    runs: toSemanticRuns(ctx.block, ctx.styleProfile?.id),
    text,
  };
}

export function detectQuote(ctx: BlockContext): SemanticQuote | null {
  if (ctx.block.type === 'quote') return makeQuote(ctx, 0.9);
  const text = reconstructParagraphText(blockPlainText(ctx.block));
  if (!text) return null;

  const indent = ctx.block.bbox?.x ?? 0;
  const indented = indent > ctx.pageWidth * 0.12;
  const italic = ctx.styleProfile?.features.italic ?? false;
  const quoted = /^[“"']/.test(text.trim()) && /[”"']$/.test(text.trim());

  if (ctx.block.styleCandidates.includes('Possible Quote') || (indented && (italic || quoted))) {
    return makeQuote(ctx, quoted ? 0.8 : 0.65);
  }
  return null;
}

function makeQuote(ctx: BlockContext, confidence: number): SemanticQuote {
  const text = reconstructParagraphText(blockPlainText(ctx.block));
  return {
    id: createId('sq'),
    type: 'quote',
    parentId: null,
    childIds: [],
    readingOrderIndex: ctx.block.readingOrderIndex,
    confidence,
    pageIndex: ctx.pageIndex,
    bbox: ctx.block.bbox,
    sourceBlockIds: [ctx.block.id],
    styleProfileId: ctx.styleProfile?.id,
    runs: toSemanticRuns(ctx.block, ctx.styleProfile?.id),
    text,
  };
}

const MONO_FONTS = /mono|courier|consolas|menlo|monaco|source code|dejavu sans mono|lucida console/i;

export function detectCodeBlock(ctx: BlockContext): SemanticCodeBlock | null {
  if (ctx.block.type === 'code_block') return makeCode(ctx, 0.9);
  const text = blockPlainText(ctx.block);
  if (!text || text.length < 4) return null;

  const font = ctx.styleProfile?.features.fontFamily ?? '';
  const mono = MONO_FONTS.test(font);
  const codey =
    /[{};=<>]|function\s|const\s|let\s|var\s|def\s|class\s|import\s|#include|console\.|\$\s/.test(
      text,
    );

  if (mono || (codey && text.includes('\n'))) {
    return makeCode(ctx, mono ? 0.85 : 0.7);
  }
  if (ctx.block.styleCandidates.includes('Possible Code')) {
    return makeCode(ctx, 0.6);
  }
  return null;
}

function makeCode(ctx: BlockContext, confidence: number): SemanticCodeBlock {
  return {
    id: createId('scode'),
    type: 'code_block',
    parentId: null,
    childIds: [],
    readingOrderIndex: ctx.block.readingOrderIndex,
    confidence,
    pageIndex: ctx.pageIndex,
    bbox: ctx.block.bbox,
    sourceBlockIds: [ctx.block.id],
    styleProfileId: ctx.styleProfile?.id,
    runs: toSemanticRuns(ctx.block, ctx.styleProfile?.id),
    text: blockPlainText(ctx.block),
  };
}

export function detectImage(ctx: BlockContext): SemanticImage | null {
  if (ctx.block.type !== 'image') return null;
  const img = ctx.block;
  return {
    id: createId('simg'),
    type: 'image',
    parentId: null,
    childIds: [],
    readingOrderIndex: img.readingOrderIndex,
    confidence: 0.95,
    pageIndex: ctx.pageIndex,
    bbox: img.bbox,
    sourceBlockIds: [img.id],
    width: img.width,
    height: img.height,
    alt: img.alt,
    resourceId: img.originalResourceId,
  };
}

export function makeParagraph(ctx: BlockContext): SemanticParagraph {
  const text = reconstructParagraphText(blockPlainText(ctx.block));
  return {
    id: createId('sp'),
    type: 'paragraph',
    parentId: null,
    childIds: [],
    readingOrderIndex: ctx.block.readingOrderIndex,
    confidence: 0.8,
    pageIndex: ctx.pageIndex,
    bbox: ctx.block.bbox,
    sourceBlockIds: [ctx.block.id],
    styleProfileId: ctx.styleProfile?.id,
    runs: toSemanticRuns(ctx.block, ctx.styleProfile?.id),
    text,
    alignment: ctx.block.alignment,
    writingDirection: ctx.block.writingDirection,
  };
}

export function bodyMedianFontSize(idm: IntermediateDocument, analysis: TypographyAnalysis): number {
  const sizes = analysis.statistics.dominantFontSizes;
  if (sizes[0]) return sizes[0].size;
  const samples: number[] = [];
  for (const page of idm.sections.flatMap((s) => s.pages)) {
    for (const b of page.blocks) {
      if ('runs' in b && b.runs[0]?.fontSize) samples.push(b.runs[0].fontSize);
    }
  }
  if (samples.length === 0) return 12;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)]!;
}

export function isNearImage(
  block: Block,
  layout: LayoutDocument | null | undefined,
  pageIndex: number,
): boolean {
  if (!layout || !block.bbox) return block.styleCandidates.includes('Possible Caption');
  const page = layout.pages.find((p) => p.pageIndex === pageIndex);
  if (!page) return false;
  const images = page.regions.filter((r) => r.kind === 'image');
  for (const img of images) {
    const gap =
      block.bbox.y > img.bbox.y + img.bbox.height
        ? block.bbox.y - (img.bbox.y + img.bbox.height)
        : img.bbox.y - (block.bbox.y + block.bbox.height);
    const xOverlap =
      Math.min(block.bbox.x + block.bbox.width, img.bbox.x + img.bbox.width) -
      Math.max(block.bbox.x, img.bbox.x);
    if (gap >= 0 && gap < 56 && xOverlap > 0) return true;
  }
  return false;
}
