/**
 * Apply and flatten AcroForm field values on document pages.
 */

import { getPageContentBytes, resolveRef } from '../parser/parser';
import { updatePageContent, concatBytes } from '../editor/stream-compiler';
import {
  PDFArray,
  PDFBoolean,
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

/**
 * The terminal field dictionary that owns a widget's /V. When the widget and
 * field are split (a /Kids widget without /T, as pdf-lib and Acrobat write
 * them), the value belongs on the /Parent field, not on the widget.
 */
export function fieldDictForWidget(widget: AcroFormWidget, objects: Map<string, PDFObject>): PDFDict {
  const dict = widget.dict;
  if (dict.has('T')) return dict;
  const parent = resolveRef(dict.get('Parent') as PDFObject, objects);
  return parent instanceof PDFDict ? parent : dict;
}

/** Set a field's /V value in the object graph. */
export function setFormFieldValue(
  doc: PDFDocumentData,
  widget: AcroFormWidget,
  value: string | boolean,
): void {
  const dict = widget.dict;
  const field = fieldDictForWidget(widget, doc.objects);
  if (typeof value === 'boolean') {
    field.set('V', new PDFName(value ? 'Yes' : 'Off'));
    dict.set('AS', new PDFName(value ? 'Yes' : 'Off'));
  } else {
    field.set('V', new PDFString(value));
    // The widget's stored appearance still shows the old text; ask viewers to rebuild it.
    let acro = doc.catalog.get('AcroForm');
    if (acro instanceof PDFRef) acro = resolveRef(acro, doc.objects);
    if (acro instanceof PDFDict) acro.set('NeedAppearances', new PDFBoolean(true));
  }
  if (field !== dict) dict.delete('V');
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
  removeFieldsForWidgets(doc, removedRefs);
}

/**
 * Drop flattened widgets from the AcroForm field tree, and any field left with
 * no widgets, so the form no longer lists them.
 */
function removeFieldsForWidgets(doc: PDFDocumentData, removedRefs: PDFRef[]): void {
  let acro = doc.catalog.get('AcroForm');
  if (acro instanceof PDFRef) acro = resolveRef(acro, doc.objects);
  if (!(acro instanceof PDFDict)) return;
  const removed = new Set(removedRefs.map((r) => r.toKey()));

  const prune = (arr: PDFArray): PDFObject[] => {
    const kept: PDFObject[] = [];
    for (const item of arr.items) {
      if (item instanceof PDFRef && removed.has(item.toKey())) continue;
      const dict = resolveRef(item, doc.objects);
      const kids = dict instanceof PDFDict ? resolveRef(dict.get('Kids') as PDFObject, doc.objects) : null;
      if (dict instanceof PDFDict && kids instanceof PDFArray && kids.length > 0) {
        const left = prune(kids);
        if (left.length === 0) continue;
        dict.set('Kids', new PDFArray(left));
      }
      kept.push(item);
    }
    return kept;
  };

  const fields = resolveRef(acro.get('Fields') as PDFObject, doc.objects);
  if (fields instanceof PDFArray) acro.set('Fields', new PDFArray(prune(fields)));
}
