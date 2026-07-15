import { createId } from '../../utils/id.js';
import type { IFootnoteDetector, StructureEngineInput } from './algorithms/types.js';
import type { FootnoteEntry } from './types.js';

const MARKER_RE = /^[\[\(]?(\d{1,3}|[a-z*†‡§¶])[\]\)]?$/i;
const BODY_START_RE = /^\s*(\d{1,3}|[*†‡§¶])[.)]\s+(.+)/;

/**
 * Detect footnote references + bodies; endnotes clustered at document end.
 */
export class FootnoteDetector implements IFootnoteDetector {
  readonly name = 'FootnoteDetector';

  detect(input: StructureEngineInput): {
    footnotes: FootnoteEntry[];
    endnotes: FootnoteEntry[];
  } {
    // Prefer IDM footnotes if already populated
    if (input.idm.footnotes.length || input.idm.endnotes.length) {
      return {
        footnotes: input.idm.footnotes.map((f) => fromIdmFootnote(f, 'footnote')),
        endnotes: input.idm.endnotes.map((f) => fromIdmFootnote(f, 'endnote')),
      };
    }

    const footnotes: FootnoteEntry[] = [];
    const endnotes: FootnoteEntry[] = [];
    const pageCount = input.raw.pages.length;

    for (const n of Object.values(input.semantic.nodes)) {
      if (!('text' in n) || !n.text || !n.bbox) continue;
      const text = String(n.text).trim();

      // Superscript-like short markers
      if (text.length <= 4 && MARKER_RE.test(text)) {
        footnotes.push({
          id: createId('fn'),
          kind: 'footnote',
          marker: text,
          body: '',
          referencePageIndex: n.pageIndex,
          bodyPageIndex: n.pageIndex,
          referenceNodeId: n.id,
          confidence: 0.5,
        });
        continue;
      }

      const body = text.match(BODY_START_RE);
      if (body && n.bbox.y < pageHeight(input, n.pageIndex) * 0.25) {
        // Near bottom of page → footnote body
        const marker = body[1]!;
        const existing = footnotes.find(
          (f) => f.marker === marker && f.referencePageIndex === n.pageIndex && !f.body,
        );
        if (existing) {
          existing.body = body[2]!;
          existing.bodyPageIndex = n.pageIndex;
          existing.confidence = 0.8;
        } else {
          footnotes.push({
            id: createId('fn'),
            kind: 'footnote',
            marker,
            body: body[2]!,
            referencePageIndex: n.pageIndex,
            bodyPageIndex: n.pageIndex,
            confidence: 0.7,
          });
        }
        continue;
      }

      // Endnotes: numbered bodies on last pages
      if (
        body &&
        pageCount > 1 &&
        n.pageIndex >= pageCount - 1 &&
        /\bendnotes?\b/i.test(nearbyHeading(input, n.pageIndex) ?? '')
      ) {
        endnotes.push({
          id: createId('en'),
          kind: 'endnote',
          marker: body[1]!,
          body: body[2]!,
          referencePageIndex: n.pageIndex,
          bodyPageIndex: n.pageIndex,
          confidence: 0.65,
        });
      }
    }

    return { footnotes, endnotes };
  }
}

function fromIdmFootnote(
  f: { id: string; marker: string; pageIndex: number; blocks: unknown[] },
  kind: 'footnote' | 'endnote',
): FootnoteEntry {
  const body = f.blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const b = block as { runs?: Array<{ text?: string }> };
      return (b.runs ?? []).map((r) => r.text ?? '').join('');
    })
    .join(' ')
    .trim();
  return {
    id: f.id,
    kind,
    marker: f.marker,
    body,
    referencePageIndex: f.pageIndex,
    bodyPageIndex: f.pageIndex,
    confidence: 0.9,
  };
}

function pageHeight(input: StructureEngineInput, pageIndex: number): number {
  return input.raw.pages.find((p) => p.index === pageIndex)?.height ?? 792;
}

function nearbyHeading(input: StructureEngineInput, pageIndex: number): string | null {
  for (const n of Object.values(input.semantic.nodes)) {
    if (n.pageIndex !== pageIndex) continue;
    if (n.type === 'heading' || n.type === 'title') {
      return 'text' in n ? String(n.text ?? '') : null;
    }
  }
  return null;
}
