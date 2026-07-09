/**
 * Text reflow — redistribute edited line text across styled segments.
 *
 * When the user edits a full line (Word-style), we map the new text back
 * to the original styled runs (bold, regular, etc.) preserving font boundaries
 * where possible using proportional + word-boundary splitting.
 */

import type { SegmentEdit, StyledSegment, TextLine } from './types';
import { estimateTextWidth } from './metrics';

/** Split new line text across original styled segments. */
export function distributeTextToSegments(line: TextLine, newText: string): SegmentEdit[] {
  if (newText === line.text) {
    return line.segments.map(s => ({ run: s.run, newText: s.text }));
  }

  if (line.segments.length === 1) {
    return [{ run: line.segments[0].run, newText }];
  }

  const oldLen = Math.max(1, line.text.length);
  const edits: SegmentEdit[] = [];
  let pos = 0;

  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    let len: number;

    if (i === line.segments.length - 1) {
      len = newText.length - pos;
    } else {
      const ratio = seg.text.length / oldLen;
      len = Math.round(ratio * newText.length);
      len = snapToWordBoundary(newText, pos, len);
      const remaining = newText.length - pos;
      const remainingSegs = line.segments.length - i - 1;
      if (remaining - len < remainingSegs) {
        len = Math.max(0, remaining - remainingSegs);
      }
    }

    len = Math.max(0, Math.min(len, newText.length - pos));
    edits.push({ run: seg.run, newText: newText.substring(pos, pos + len) });
    pos += len;
  }

  if (pos < newText.length && edits.length > 0) {
    edits[edits.length - 1].newText += newText.substring(pos);
  }

  return edits;
}

function snapToWordBoundary(text: string, start: number, len: number): number {
  if (start + len >= text.length) return len;
  if (text[start + len] === ' ') return len;
  const nextSpace = text.indexOf(' ', start + len);
  if (nextSpace !== -1 && nextSpace - start - len < 6) {
    return nextSpace - start + 1;
  }
  const prevSpace = text.lastIndexOf(' ', start + len);
  if (prevSpace > start && start + len - prevSpace < 6) {
    return prevSpace - start + 1;
  }
  return len;
}

/** Compute width delta after editing a line (for shifting trailing runs). */
export function computeLineWidthDelta(line: TextLine, edits: SegmentEdit[]): number {
  let oldWidth = 0;
  let newWidth = 0;

  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    oldWidth += estimateTextWidth(seg.text, seg.run);
    const edit = edits.find(e => e.run === seg.run);
    newWidth += estimateTextWidth(edit?.newText ?? seg.text, seg.run);
  }

  return newWidth - oldWidth;
}

/** Find which segment contains a character index in the line. */
export function segmentAtIndex(line: TextLine, charIndex: number): StyledSegment | null {
  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    if (charIndex >= seg.startIndex && charIndex < seg.endIndex) {
      return seg;
    }
  }
  if (charIndex === line.text.length && line.segments.length > 0) {
    return line.segments[line.segments.length - 1];
  }
  return null;
}
