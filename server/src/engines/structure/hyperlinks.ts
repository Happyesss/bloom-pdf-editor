import { createId } from '../../utils/id.js';
import type { IHyperlinkAnalyzer, StructureEngineInput } from './algorithms/types.js';
import type { HyperlinkEntry } from './types.js';

const EMAIL_RE = /^mailto:/i;
const URL_RE = /^https?:\/\//i;
const XREF_RE = /^(see|refer to|cf\.?)\b/i;

/**
 * Analyze external/internal/email/cross-reference hyperlinks.
 */
export class HyperlinkAnalyzer implements IHyperlinkAnalyzer {
  readonly name = 'HyperlinkAnalyzer';

  analyze(input: StructureEngineInput): HyperlinkEntry[] {
    const out: HyperlinkEntry[] = [];

    for (const h of input.idm.hyperlinks) {
      out.push(classify(h.uri, h.text, h.pageIndex, h.id));
    }

    // Semantic hyperlink nodes
    for (const n of Object.values(input.semantic.nodes)) {
      if (n.type !== 'hyperlink') continue;
      const uri = 'uri' in n ? String(n.uri ?? '') : '';
      const text = 'text' in n ? String(n.text ?? '') : undefined;
      if (!uri) continue;
      if (out.some((e) => e.uri === uri && e.pageIndex === n.pageIndex)) continue;
      out.push(classify(uri, text, n.pageIndex, n.id));
    }

    // Raw link annotations not yet in IDM
    for (const page of input.raw.pages) {
      for (const a of page.annotations) {
        if (!a.uri && !a.dest) continue;
        if (a.uri && out.some((e) => e.uri === a.uri)) continue;
        if (a.uri) {
          out.push(classify(a.uri, a.contents ?? undefined, page.index, a.id));
        } else if (a.dest) {
          out.push({
            id: createId('link'),
            kind: 'named_destination',
            text: a.contents ?? undefined,
            pageIndex: page.index,
            dest: a.dest,
            confidence: 0.8,
          });
        }
      }
    }

    // Textual cross-references without URI
    for (const n of Object.values(input.semantic.nodes)) {
      if (!('text' in n) || !n.text) continue;
      const text = String(n.text);
      if (XREF_RE.test(text) && /\b(figure|table|section|chapter|page)\b/i.test(text)) {
        out.push({
          id: createId('xref'),
          kind: 'cross_reference',
          text: text.slice(0, 120),
          pageIndex: n.pageIndex,
          targetId: n.id,
          confidence: 0.55,
        });
      }
    }

    return out;
  }
}

function classify(
  uri: string,
  text: string | undefined,
  pageIndex: number,
  sourceId?: string,
): HyperlinkEntry {
  let kind: HyperlinkEntry['kind'] = 'internal';
  if (EMAIL_RE.test(uri) || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(uri)) kind = 'email';
  else if (URL_RE.test(uri)) kind = 'external';
  else if (uri.startsWith('#') || uri.startsWith('/')) kind = 'internal';
  else if (uri.includes('@')) kind = 'email';
  else kind = 'internal';

  return {
    id: sourceId ?? createId('link'),
    kind,
    uri,
    text,
    pageIndex,
    confidence: 0.9,
  };
}
