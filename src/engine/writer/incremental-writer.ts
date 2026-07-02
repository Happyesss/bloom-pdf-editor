/**
 * Incremental PDF Writer
 *
 * Appends only modified/new objects to the end of an existing PDF file.
 * This preserves the original file contents and adds an incremental update:
 *
 *   [original PDF bytes]
 *   [new/modified objects]
 *   xref
 *   [incremental xref table — only modified entries]
 *   trailer
 *   << /Size N /Root ref /Prev <old_xref_offset> >>
 *   startxref
 *   <new_xref_offset>
 *   %%EOF
 *
 * Benefits:
 *   - Preserves digital signatures on unchanged content
 *   - Much faster than full serialization for large documents
 *   - Maintains edit history (previous versions are accessible)
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  type PDFDocumentData,
} from '../types';
import { serializeIndirectObject, concatBytes } from '../editor/stream-compiler';
import { findStartXref } from '../parser/xref';

// ─── Incremental save ───────────────────────────────────────────────────────

/**
 * Save a document incrementally — append only changed objects.
 *
 * @param doc The document data (with modifications applied to objects map)
 * @param modifiedKeys Set of object keys that were modified
 * @param newObjects Map of new objects that were created (key → object)
 * @returns Complete PDF file bytes (original + incremental update)
 */
export function saveIncremental(
  doc: PDFDocumentData,
  modifiedKeys: Set<string>,
  newObjects?: Map<string, PDFObject>,
): Uint8Array {
  const originalBytes = doc.rawBytes;
  const chunks: Uint8Array[] = [];

  // Start appending after the original file
  let currentOffset = originalBytes.length;

  // Ensure the original ends cleanly (add newline if needed)
  if (originalBytes[originalBytes.length - 1] !== 0x0a) {
    chunks.push(stringToBytes('\n'));
    currentOffset += 1;
  }

  // Track offsets for the incremental xref
  const newOffsets = new Map<string, number>();

  // Write modified objects
  const modKeys = Array.from(modifiedKeys);
  for (let i = 0; i < modKeys.length; i++) {
    const key = modKeys[i];
    const obj = doc.objects.get(key);
    if (!obj) continue;

    const parts = key.split('_');
    const objNum = parseInt(parts[0], 10);
    const genNum = parseInt(parts[1], 10);

    newOffsets.set(key, currentOffset);
    const objBytes = serializeIndirectObject(objNum, genNum, obj);
    chunks.push(objBytes);
    currentOffset += objBytes.length;
  }

  // Write new objects (if any)
  if (newObjects) {
    const newEntries = Array.from(newObjects.entries());
    for (let i = 0; i < newEntries.length; i++) {
      const [key, obj] = newEntries[i];
      const parts = key.split('_');
      const objNum = parseInt(parts[0], 10);
      const genNum = parseInt(parts[1], 10);

      newOffsets.set(key, currentOffset);
      const objBytes = serializeIndirectObject(objNum, genNum, obj);
      chunks.push(objBytes);
      currentOffset += objBytes.length;

      // Also add to the document's object map
      doc.objects.set(key, obj);
    }
  }

  // Build incremental xref table
  const xrefOffset = currentOffset;
  const xrefBytes = buildIncrementalXref(newOffsets);
  chunks.push(xrefBytes);
  currentOffset += xrefBytes.length;

  // Build trailer
  const prevXrefOffset = findStartXref(originalBytes);
  const size = getMaxObjNum(doc) + 1;

  const trailerDict = new PDFDict();
  trailerDict.set('Size', new PDFNumber(size));

  // Copy Root and Info from original trailer
  const root = doc.xref.trailerDict.getRef('Root');
  if (root) trailerDict.set('Root', root);

  const info = doc.xref.trailerDict.get('Info');
  if (info) trailerDict.set('Info', info);

  // /Prev points to the previous xref offset
  trailerDict.set('Prev', new PDFNumber(prevXrefOffset));

  const trailerStr = trailerDictToString(trailerDict);
  const trailerBytes = stringToBytes(
    `trailer\n${trailerStr}\nstartxref\n${xrefOffset}\n%%EOF\n`,
  );
  chunks.push(trailerBytes);

  // Concatenate: original + incremental update
  return concatBytes(originalBytes, ...chunks);
}

// ─── Incremental xref ───────────────────────────────────────────────────────

function buildIncrementalXref(offsets: Map<string, number>): Uint8Array {
  // Group entries into contiguous subsections
  const entries: { objNum: number; genNum: number; offset: number }[] = [];

  const offsetEntries = Array.from(offsets.entries());
  for (let i = 0; i < offsetEntries.length; i++) {
    const [key, offset] = offsetEntries[i];
    const parts = key.split('_');
    entries.push({
      objNum: parseInt(parts[0], 10),
      genNum: parseInt(parts[1], 10),
      offset,
    });
  }

  // Sort by object number
  entries.sort((a, b) => a.objNum - b.objNum);

  // Group into subsections
  const subsections: { start: number; entries: typeof entries }[] = [];
  let currentSub: typeof entries = [];
  let expectedNext = -1;

  for (const entry of entries) {
    if (entry.objNum !== expectedNext && currentSub.length > 0) {
      subsections.push({ start: currentSub[0].objNum, entries: [...currentSub] });
      currentSub = [];
    }
    currentSub.push(entry);
    expectedNext = entry.objNum + 1;
  }

  if (currentSub.length > 0) {
    subsections.push({ start: currentSub[0].objNum, entries: currentSub });
  }

  // Build xref output
  const lines: string[] = ['xref'];

  for (const sub of subsections) {
    lines.push(`${sub.start} ${sub.entries.length}`);
    for (const entry of sub.entries) {
      const offsetStr = entry.offset.toString().padStart(10, '0');
      const genStr = entry.genNum.toString().padStart(5, '0');
      lines.push(`${offsetStr} ${genStr} n \r`);
    }
  }

  return stringToBytes(lines.join('\n') + '\n');
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getMaxObjNum(doc: PDFDocumentData): number {
  let max = 0;
  const keys = Array.from(doc.objects.keys());
  for (let i = 0; i < keys.length; i++) {
    const objNum = parseInt(keys[i].split('_')[0], 10);
    if (objNum > max) max = objNum;
  }
  return max;
}

function trailerDictToString(dict: PDFDict): string {
  const entries: string[] = [];
  const dictEntries = Array.from(dict.entries());
  for (let i = 0; i < dictEntries.length; i++) {
    const [key, value] = dictEntries[i];
    entries.push(`/${key} ${value.toString()}`);
  }
  return `<< ${entries.join(' ')} >>`;
}

function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i) & 0xff;
  }
  return bytes;
}
