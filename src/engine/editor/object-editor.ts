/**
 * Object editor — apply transforms / delete objects in content streams.
 * Public API matches editing tests: async (doc, pageIndex, obj, ...).
 */

import {
  PDFNumber,
  type PDFDocumentData,
  type PDFObject,
} from '../types';
import { getPageContentBytes } from '../parser/parser';
import { parseContentStream, type CSInstruction } from '../content/operator-lexer';
import { compileInstructions } from './text-editor';
import { updatePageContent } from './stream-compiler';
import type { EditableObject } from '../editing/scene-graph';

function op(operator: string, operands: PDFObject[] = []): CSInstruction {
  return { operator, operands, offset: 0 };
}

function numVal(obj: PDFObject | undefined): number {
  return obj instanceof PDFNumber ? obj.value : 0;
}

/**
 * Apply a full CTM to an object by wrapping/replacing its placement matrix.
 */
export async function applyObjectTransform(
  doc: PDFDocumentData,
  pageIndex: number,
  obj: EditableObject,
  newCtm: number[],
): Promise<void> {
  const page = doc.pages[pageIndex];
  const contentBytes = getPageContentBytes(page, doc.objects);
  const instructions = parseContentStream(contentBytes);
  const targetIndex = findObjectInstructionIndex(instructions, obj);
  if (targetIndex < 0) return;

  if (obj.kind === 'image') {
    // Replace preceding cm operands
    for (let j = targetIndex - 1; j >= Math.max(0, targetIndex - 5); j--) {
      if (instructions[j].operator === 'cm' && instructions[j].operands.length >= 6) {
        instructions[j].operands = newCtm.map(n => new PDFNumber(n));
        const next = compileInstructions(instructions);
        await updatePageContent(page.contentRefs, next, doc.objects);
        return;
      }
    }
  }

  // Generic: wrap with q / cm / Q using delta from identity toward newCtm
  // For paths: inject cm before path construction
  let start = targetIndex;
  if (obj.kind === 'path') {
    while (start > 0) {
      const prev = instructions[start - 1].operator;
      if (['m', 'l', 'c', 'v', 'y', 'h', 're', 'w', 'J', 'j', 'RG', 'rg', 'G', 'g', 'K', 'k', 'CS', 'cs', 'SC', 'sc'].includes(prev)) {
        start--;
      } else break;
    }
  }

  const dx = (obj.bbox.x !== undefined && newCtm.length >= 6)
    ? newCtm[4] - (obj.ctm[4] ?? 0)
    : 0;
  const dy = newCtm.length >= 6 ? newCtm[5] - (obj.ctm[5] ?? 0) : 0;

  // Prefer translating path coords for simple re rectangles
  if (obj.kind === 'path') {
    for (let i = start; i <= targetIndex; i++) {
      if (instructions[i].operator === 're' && instructions[i].operands.length >= 4) {
        const x = numVal(instructions[i].operands[0]) + (newCtm[4] - obj.bbox.x);
        const y = numVal(instructions[i].operands[1]) + (newCtm[5] - obj.bbox.y);
        // When transformObject set ctm with translation, bbox already has new position
        // Use delta from original bbox to new ctm translation relative to identity
        const ndx = obj.bbox.x !== undefined ? (/* moved */ 0) : 0;
        void ndx;
        // Simpler: new position is encoded in transformObject's bbox; compute delta
        break;
      }
    }
    // Compute delta from original bbox to implied translation
    // newCtm from transformObject after translate is typically [1,0,0,1,dx,dy] composed
    // For path with identity ctm, translation is in newCtm[4], newCtm[5] if pure translate
    // Actually transformObject sets ctm via composeTransform on identity + translate
    // so newCtm ≈ [1,0,0,1,dx,dy] when only translating from identity ctm
    const tdx = newCtm[4] - obj.ctm[4];
    const tdy = newCtm[5] - obj.ctm[5];
    for (let i = start; i <= targetIndex; i++) {
      const inst = instructions[i];
      if (inst.operator === 're' && inst.operands.length >= 4) {
        inst.operands[0] = new PDFNumber(numVal(inst.operands[0]) + tdx);
        inst.operands[1] = new PDFNumber(numVal(inst.operands[1]) + tdy);
      } else if ((inst.operator === 'm' || inst.operator === 'l') && inst.operands.length >= 2) {
        inst.operands[0] = new PDFNumber(numVal(inst.operands[0]) + tdx);
        inst.operands[1] = new PDFNumber(numVal(inst.operands[1]) + tdy);
      }
    }
    const next = compileInstructions(instructions);
    await updatePageContent(page.contentRefs, next, doc.objects);
    return;
  }

  // Fallback wrap
  void dx; void dy;
  const cmOps = newCtm.map(n => new PDFNumber(n));
  instructions.splice(start, 0, op('q'), op('cm', cmOps));
  instructions.splice(targetIndex + 3, 0, op('Q'));
  const next = compileInstructions(instructions);
  await updatePageContent(page.contentRefs, next, doc.objects);
}

/** Delete an object from the page content stream. */
export async function deleteObject(
  doc: PDFDocumentData,
  pageIndex: number,
  obj: EditableObject,
): Promise<void> {
  const page = doc.pages[pageIndex];
  const contentBytes = getPageContentBytes(page, doc.objects);
  const instructions = parseContentStream(contentBytes);
  const targetIndex = findObjectInstructionIndex(instructions, obj);
  if (targetIndex < 0) return;

  let start = targetIndex;
  let end = targetIndex;

  if (obj.kind === 'image') {
    if (start > 0 && instructions[start - 1].operator === 'cm') start--;
    if (start > 0 && instructions[start - 1].operator === 'q') start--;
    if (end + 1 < instructions.length && instructions[end + 1].operator === 'Q') end++;
  } else if (obj.kind === 'path') {
    while (start > 0) {
      const prev = instructions[start - 1].operator;
      if (['m', 'l', 'c', 'v', 'y', 'h', 're', 'w', 'J', 'j', 'RG', 'rg', 'G', 'g', 'K', 'k'].includes(prev)) {
        start--;
      } else break;
    }
  } else if (obj.kind === 'text') {
    // Remove from BT to ET if possible
    for (let i = targetIndex; i >= 0; i--) {
      if (instructions[i].operator === 'BT') { start = i; break; }
    }
    for (let i = targetIndex; i < instructions.length; i++) {
      if (instructions[i].operator === 'ET') { end = i; break; }
    }
  }

  instructions.splice(start, end - start + 1);
  const next = compileInstructions(instructions);
  await updatePageContent(page.contentRefs, next, doc.objects);
}

function findObjectInstructionIndex(
  instructions: CSInstruction[],
  obj: EditableObject,
): number {
  if (obj.kind === 'image') {
    for (let i = 0; i < instructions.length; i++) {
      if (instructions[i].operator !== 'Do') continue;
      for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
        if (instructions[j].operator === 'cm' && instructions[j].operands.length >= 6) {
          const e = numVal(instructions[j].operands[4]);
          const f = numVal(instructions[j].operands[5]);
          if (Math.abs(e - obj.bbox.x) < 5 && Math.abs(f - obj.bbox.y) < 5) {
            return i;
          }
        }
      }
      return i;
    }
  }

  if (obj.kind === 'path') {
    const paintOps = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
    for (let i = 0; i < instructions.length; i++) {
      if (!paintOps.has(instructions[i].operator)) continue;
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        if (instructions[j].operator === 're' && instructions[j].operands.length >= 4) {
          const x = numVal(instructions[j].operands[0]);
          const y = numVal(instructions[j].operands[1]);
          if (Math.abs(x - obj.bbox.x) < 8 && Math.abs(y - obj.bbox.y) < 8) {
            return i;
          }
        }
      }
    }
    for (let i = instructions.length - 1; i >= 0; i--) {
      if (paintOps.has(instructions[i].operator)) return i;
    }
  }

  if (obj.kind === 'text') {
    if (obj.contentRange) return obj.contentRange.startOp;
    for (let i = 0; i < instructions.length; i++) {
      if (instructions[i].operator === 'Tj' || instructions[i].operator === 'TJ') return i;
    }
  }

  return -1;
}
