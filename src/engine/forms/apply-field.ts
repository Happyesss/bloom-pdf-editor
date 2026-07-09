/**
 * Apply and flatten AcroForm field values on document pages.
 */

import { getPageContentBytes, resolveRef } from '../parser/parser';
import { updatePageContent, concatBytes } from '../editor/stream-compiler';
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFObject,
  PDFRef,
  PDFString,
  type PDFDocumentData,
} from '../types';
import type { AcroFormWidget } from './types';
import { flattenWidgets } from './flatten-field';

function stringToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i) & 0xff;
  return bytes;
}

/** Set a widget's /V value in the object graph. */
export function setFormFieldValue(
  doc: PDFDocumentData,
  widget: AcroFormWidget,
  value: string | boolean,
): void {
  const dict = widget.dict;
  if (typeof value === 'boolean') {
    dict.set('V', new PDFName(value ? 'Yes' : 'Off'));
    dict.set('AS', new PDFName(value ? 'Yes' : 'Off'));
  } else {
    dict.set('V', new PDFString(value));
  }
  widget.value = value;
}

/** Remove widget annotation refs from a page /Annots array. */
export function removeWidgetAnnots(
  pageDict: PDFDict,
  removedRefs: PDFRef[],
  objects: Map<string, PDFObject>,
): void {
  const annotsRef = pageDict.get('Annots');
  if (!annotsRef) return;

  const annots = annotsRef instanceof PDFRef ? resolveRef(annotsRef, objects) : annotsRef;
  if (!(annots instanceof PDFArray)) return;

  const removeKeys = new Set(removedRefs.map(r => r.toKey()));
  const kept: PDFObject[] = [];
  for (let i = 0; i < annots.length; i++) {
    const ref = annots.get(i);
    if (ref instanceof PDFRef && removeKeys.has(ref.toKey())) continue;
    kept.push(ref!);
  }

  if (kept.length === 0) {
    pageDict.delete('Annots');
  } else {
    pageDict.set('Annots', new PDFArray(kept));
  }
}

/**
 * Flatten widgets on a page: bake appearances into content stream,
 * remove widget annotations.
 */
export async function flattenFormFieldsOnPage(
  doc: PDFDocumentData,
  pageIndex: number,
  widgets: AcroFormWidget[],
): Promise<void> {
  if (widgets.length === 0) return;

  const page = doc.pages[pageIndex];
  const { content, removedRefs } = flattenWidgets(widgets);
  const existing = getPageContentBytes(page, doc.objects);
  const merged = concatBytes(existing, stringToBytes(`\n${content}`));
  await updatePageContent(page.contentRefs, merged, doc.objects);
  removeWidgetAnnots(page.dict, removedRefs, doc.objects);
}
