/**
 * Watermark Removal Engine
 *
 * Removes watermarks from PDF pages. Supports two removal strategies:
 *
 * 1. **Content-stream surgery** — Directly modifies the page content stream
 *    to remove watermark graphics operators while preserving legitimate content.
 *    This is the most thorough approach and works for watermarks embedded
 *    directly in the page content.
 *
 * 2. **Annotation removal** — Removes watermark annotations from the page's
 *    /Annots array. Clean and safe, works for annotation-based watermarks.
 *
 * 3. **Resource cleanup** — Removes orphaned ExtGState and XObject resources
 *    that were created solely for watermark rendering.
 *
 * The engine works hand-in-hand with the detection engine: you detect first,
 * then pass the DetectedWatermark[] results to the removal engine for
 * targeted removal.
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  type PDFPageInfo,
} from '../types';
import type { DetectedWatermark } from './watermark-detector';

// ─── Removal result types ───────────────────────────────────────────────────

export interface RemovalResult {
  /** Whether removal was successful */
  success: boolean;
  /** The watermark ID that was targeted */
  watermarkId: string;
  /** Page index where removal occurred */
  pageIndex: number;
  /** Strategy used for removal */
  strategy: 'content-surgery' | 'annotation-removal' | 'resource-cleanup';
  /** Description of what was done */
  description: string;
  /** Any warnings or notes */
  warnings?: string[];
}

export interface BatchRemovalResult {
  /** Total watermarks targeted */
  total: number;
  /** Number successfully removed */
  removed: number;
  /** Number that failed */
  failed: number;
  /** Per-watermark results */
  results: RemovalResult[];
}

// ─── Main removal functions ─────────────────────────────────────────────────

/**
 * Remove detected watermarks from the document.
 * Mutates the document's object map and page dictionaries.
 *
 * @param doc Document with pages and objects map (will be mutated)
 * @param detections Detected watermarks to remove
 * @returns Batch removal result
 */
export function removeWatermarks(
  doc: { pages: PDFPageInfo[]; objects: Map<string, PDFObject> },
  detections: DetectedWatermark[],
): BatchRemovalResult {
  const results: RemovalResult[] = [];

  // Group detections by page for efficient processing
  const byPage = new Map<number, DetectedWatermark[]>();
  for (const det of detections) {
    if (!byPage.has(det.pageIndex)) byPage.set(det.pageIndex, []);
    byPage.get(det.pageIndex)!.push(det);
  }

  for (const [pageIndex, pageDetections] of byPage) {
    if (pageIndex < 0 || pageIndex >= doc.pages.length) {
      for (const det of pageDetections) {
        results.push({
          success: false,
          watermarkId: det.id,
          pageIndex,
          strategy: 'content-surgery',
          description: `Page index ${pageIndex} out of range`,
        });
      }
      continue;
    }

    const page = doc.pages[pageIndex];

    // Separate detections by method
    const contentDetections = pageDetections.filter(d => d.detectionMethod === 'content-analysis');
    const annotationDetections = pageDetections.filter(d => d.detectionMethod === 'annotation');
    const resourceDetections = pageDetections.filter(d => d.detectionMethod === 'resource-analysis');

    // 1. Remove annotation-based watermarks
    if (annotationDetections.length > 0) {
      const annotResults = removeAnnotationWatermarks(page, doc.objects, annotationDetections, pageIndex);
      results.push(...annotResults);
    }

    // 2. Remove content-stream watermarks
    if (contentDetections.length > 0) {
      const contentResults = removeContentStreamWatermarks(page, doc.objects, contentDetections, pageIndex);
      results.push(...contentResults);
    }

    // 3. Clean up orphaned resources
    if (resourceDetections.length > 0 || contentDetections.length > 0) {
      const cleanupResults = cleanupWatermarkResources(page, doc.objects, pageDetections, pageIndex);
      results.push(...cleanupResults);
    }
  }

  const removed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    total: detections.length,
    removed,
    failed,
    results,
  };
}

/**
 * Remove watermarks from a single page.
 */
export function removeWatermarksFromPage(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  pageIndex: number,
  detections: DetectedWatermark[],
): RemovalResult[] {
  const results: RemovalResult[] = [];

  const contentDetections = detections.filter(d => d.detectionMethod === 'content-analysis');
  const annotationDetections = detections.filter(d => d.detectionMethod === 'annotation');
  const resourceDetections = detections.filter(d => d.detectionMethod === 'resource-analysis');

  if (annotationDetections.length > 0) {
    results.push(...removeAnnotationWatermarks(page, objects, annotationDetections, pageIndex));
  }

  if (contentDetections.length > 0) {
    results.push(...removeContentStreamWatermarks(page, objects, contentDetections, pageIndex));
  }

  if (resourceDetections.length > 0 || contentDetections.length > 0) {
    results.push(...cleanupWatermarkResources(page, objects, detections, pageIndex));
  }

  return results;
}

// ─── Strategy 1: Annotation removal ─────────────────────────────────────────

function removeAnnotationWatermarks(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  detections: DetectedWatermark[],
  pageIndex: number,
): RemovalResult[] {
  const results: RemovalResult[] = [];

  const annots = page.dict.get('Annots');
  if (!annots) {
    for (const det of detections) {
      results.push({
        success: false,
        watermarkId: det.id,
        pageIndex,
        strategy: 'annotation-removal',
        description: 'No /Annots array on page',
      });
    }
    return results;
  }

  let annotArray: PDFArray;
  if (annots instanceof PDFRef) {
    const resolved = objects.get(annots.toKey());
    if (resolved instanceof PDFArray) {
      annotArray = resolved;
    } else {
      for (const det of detections) {
        results.push({
          success: false,
          watermarkId: det.id,
          pageIndex,
          strategy: 'annotation-removal',
          description: '/Annots ref does not resolve to array',
        });
      }
      return results;
    }
  } else if (annots instanceof PDFArray) {
    annotArray = annots;
  } else {
    for (const det of detections) {
      results.push({
        success: false,
        watermarkId: det.id,
        pageIndex,
        strategy: 'annotation-removal',
        description: '/Annots is not an array',
      });
    }
    return results;
  }

  // Collect refs to remove
  const refsToRemove = new Set<string>();
  for (const det of detections) {
    const annotRef = det.metadata?.annotRef as string | undefined;
    if (annotRef) {
      refsToRemove.add(annotRef);
    }
  }

  if (refsToRemove.size === 0) {
    for (const det of detections) {
      results.push({
        success: false,
        watermarkId: det.id,
        pageIndex,
        strategy: 'annotation-removal',
        description: 'No annotation refs found in detection metadata',
      });
    }
    return results;
  }

  // Build new array without the watermark annotations
  const newArray = new PDFArray();
  let removedCount = 0;

  for (let i = 0; i < annotArray.length; i++) {
    const item = annotArray.get(i);
    if (item instanceof PDFRef && refsToRemove.has(item.toKey())) {
      // Also delete the annotation object from the object map
      objects.delete(item.toKey());
      removedCount++;
    } else {
      newArray.push(item);
    }
  }

  // Update the page's /Annots
  if (annots instanceof PDFRef) {
    // Replace the resolved array's contents
    const resolved = objects.get(annots.toKey());
    if (resolved instanceof PDFArray) {
      // Mutate in place by clearing and re-adding
      while (resolved.length > 0) resolved.pop();
      for (let i = 0; i < newArray.length; i++) {
        resolved.push(newArray.get(i));
      }
    }
  } else {
    page.dict.set('Annots', newArray);
  }

  for (const det of detections) {
    const wasRemoved = det.metadata?.annotRef && refsToRemove.has(det.metadata.annotRef as string);
    results.push({
      success: wasRemoved || false,
      watermarkId: det.id,
      pageIndex,
      strategy: 'annotation-removal',
      description: wasRemoved
        ? `Removed annotation ${det.metadata?.annotRef}`
        : 'Annotation ref not found in /Annots',
    });
  }

  return results;
}

// ─── Strategy 2: Content stream surgery ─────────────────────────────────────

function removeContentStreamWatermarks(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  detections: DetectedWatermark[],
  pageIndex: number,
): RemovalResult[] {
  const results: RemovalResult[] = [];

  // Get the page content stream(s)
  const contents = page.dict.get('Contents');
  if (!contents) {
    for (const det of detections) {
      results.push({
        success: false,
        watermarkId: det.id,
        pageIndex,
        strategy: 'content-surgery',
        description: 'No /Contents on page',
      });
    }
    return results;
  }

  // Collect all content stream refs
  const contentRefs: PDFRef[] = [];
  if (contents instanceof PDFRef) {
    contentRefs.push(contents);
  } else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.length; i++) {
      const item = contents.get(i);
      if (item instanceof PDFRef) contentRefs.push(item);
    }
  }

  if (contentRefs.length === 0) {
    for (const det of detections) {
      results.push({
        success: false,
        watermarkId: det.id,
        pageIndex,
        strategy: 'content-surgery',
        description: 'No content stream refs found',
      });
    }
    return results;
  }

  // For each content stream, attempt watermark removal
  for (const ref of contentRefs) {
    const streamObj = objects.get(ref.toKey());
    if (!(streamObj instanceof PDFStream)) continue;

    const rawBytes = streamObj.decodedBytes || streamObj.rawBytes;
    const contentStr = bytesToString(rawBytes);

    // Apply removal strategies
    let modifiedStr = contentStr;
    let modifications = 0;

    // Strategy A: Remove q/Q blocks that contain watermark text
    const { result: cleanedFromBlocks, count: blockCount } = removeWatermarkBlocks(modifiedStr, detections);
    modifiedStr = cleanedFromBlocks;
    modifications += blockCount;

    // Strategy B: Remove specific text operations (Tj/TJ) with watermark text
    const { result: cleanedFromText, count: textCount } = removeWatermarkTextOps(modifiedStr, detections);
    modifiedStr = textCount > blockCount ? cleanedFromText : modifiedStr; // Use whichever removed more
    modifications = Math.max(modifications, textCount);

    // Strategy C: Remove image Do operations for watermark images
    const { result: cleanedFromImages, count: imgCount } = removeWatermarkImageOps(modifiedStr, detections);
    if (imgCount > modifications) {
      modifiedStr = cleanedFromImages;
      modifications = imgCount;
    }

    // Strategy D: Remove ExtGState references for watermark opacity
    const { result: cleanedFromGS, count: gsCount } = removeWatermarkGSOps(modifiedStr, detections);
    modifiedStr = cleanedFromGS;
    modifications += gsCount;

    // Update the stream if modified
    if (modifications > 0) {
      const newBytes = stringToBytes(modifiedStr);
      streamObj.rawBytes = newBytes;
      streamObj.decodedBytes = newBytes;
      // Update /Length
      streamObj.dict.set('Length', new PDFNumber(newBytes.length));
    }

    for (const det of detections) {
      results.push({
        success: modifications > 0,
        watermarkId: det.id,
        pageIndex,
        strategy: 'content-surgery',
        description: modifications > 0
          ? `Removed ${modifications} watermark element(s) from content stream`
          : 'No watermark content found to remove',
        warnings: modifications === 0 ? ['Content surgery found no matching patterns'] : undefined,
      });
    }
  }

  return results;
}

// ── Content surgery helpers ─────────────────────────────────────────────────

/**
 * Remove q/Q blocks that contain watermark text.
 * A watermark block is: q ... (watermark text) Tj ... Q
 */
function removeWatermarkBlocks(
  contentStr: string,
  detections: DetectedWatermark[],
): { result: string; count: number } {
  let result = contentStr;
  let count = 0;

  // Collect watermark text strings to look for
  const watermarkTexts = new Set<string>();
  for (const det of detections) {
    if (det.text && det.text.trim().length > 0) {
      watermarkTexts.add(det.text.trim());
    }
  }

  if (watermarkTexts.size === 0) return { result, count };

  for (const text of watermarkTexts) {
    const escaped = escapePDFStringForRegex(text);

    // Find q ... (text) Tj ... Q blocks
    // Pattern: q followed by anything, then the text in parens with Tj, then Q
    const blockRegex = new RegExp(
      `q\\s[^qQ]*?\\(${escaped}\\)\\s*Tj[^qQ]*?Q`,
      'gs',
    );

    let match: RegExpExecArray | null;
    while ((match = blockRegex.exec(result)) !== null) {
      // Replace the entire block with nothing (or a whitespace placeholder)
      result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
      count++;
      // Reset regex lastIndex since string changed
      blockRegex.lastIndex = match.index;
    }
  }

  return { result, count };
}

/**
 * Remove individual text operations (Tj/TJ) that contain watermark text.
 */
function removeWatermarkTextOps(
  contentStr: string,
  detections: DetectedWatermark[],
): { result: string; count: number } {
  let result = contentStr;
  let count = 0;

  const watermarkTexts = new Set<string>();
  for (const det of detections) {
    if (det.text && det.text.trim().length > 0) {
      watermarkTexts.add(det.text.trim());
    }
  }

  if (watermarkTexts.size === 0) return { result, count };

  for (const text of watermarkTexts) {
    const escaped = escapePDFStringForRegex(text);

    // Remove Tj operations with this text
    const tjRegex = new RegExp(`\\(${escaped}\\)\\s*Tj`, 'g');
    let match: RegExpExecArray | null;
    while ((match = tjRegex.exec(result)) !== null) {
      result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
      count++;
      tjRegex.lastIndex = match.index;
    }

    // Remove TJ array entries containing this text
    const tjArrRegex = new RegExp(`\\[[^\\]]*\\(${escaped}\\)[^\\]]*\\]\\s*TJ`, 'g');
    while ((match = tjArrRegex.exec(result)) !== null) {
      result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
      count++;
      tjArrRegex.lastIndex = match.index;
    }
  }

  return { result, count };
}

/**
 * Remove image Do operations for watermark images.
 */
function removeWatermarkImageOps(
  contentStr: string,
  detections: DetectedWatermark[],
): { result: string; count: number } {
  let result = contentStr;
  let count = 0;

  // Collect image names from detection metadata
  const imageNames = new Set<string>();
  for (const det of detections) {
    const imgName = det.metadata?.imageName as string | undefined;
    if (imgName) {
      imageNames.add(imgName);
    }
  }

  // Also look for watermark-like image names (ImWM_ prefix from our engine)
  const wmImageRegex = /\/ImWM_\w+\s+Do/g;
  let match: RegExpExecArray | null;
  while ((match = wmImageRegex.exec(result)) !== null) {
    result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
    count++;
    wmImageRegex.lastIndex = match.index;
  }

  for (const name of imageNames) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doRegex = new RegExp(`/${escapedName}\\s+Do`, 'g');
    while ((match = doRegex.exec(result)) !== null) {
      result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
      count++;
      doRegex.lastIndex = match.index;
    }
  }

  return { result, count };
}

/**
 * Remove ExtGState references for watermark opacity (/GS_wm_... gs).
 */
function removeWatermarkGSOps(
  contentStr: string,
  detections: DetectedWatermark[],
): { result: string; count: number } {
  let result = contentStr;
  let count = 0;

  // Remove /GS_wm_* gs operations (our watermark engine's naming convention)
  const gsRegex = /\/GS_wm_\w+\s+gs/g;
  let match: RegExpExecArray | null;
  while ((match = gsRegex.exec(result)) !== null) {
    result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
    count++;
    gsRegex.lastIndex = match.index;
  }

  // Also check detection metadata for specific ExtGState names
  for (const det of detections) {
    const gsName = det.metadata?.extGStateName as string | undefined;
    if (gsName) {
      const escapedName = gsName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const specificRegex = new RegExp(`/${escapedName}\\s+gs`, 'g');
      while ((match = specificRegex.exec(result)) !== null) {
        result = result.substring(0, match.index) + result.substring(match.index + match[0].length);
        count++;
        specificRegex.lastIndex = match.index;
      }
    }
  }

  return { result, count };
}

// ─── Strategy 3: Resource cleanup ───────────────────────────────────────────

function cleanupWatermarkResources(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  detections: DetectedWatermark[],
  pageIndex: number,
): RemovalResult[] {
  const results: RemovalResult[] = [];

  const resources = page.dict.get('Resources');
  if (!resources) {
    return detections.map(det => ({
      success: true,
      watermarkId: det.id,
      pageIndex,
      strategy: 'resource-cleanup' as const,
      description: 'No resources to clean up',
    }));
  }

  let resDict: PDFDict;
  if (resources instanceof PDFRef) {
    const resolved = objects.get(resources.toKey());
    if (resolved instanceof PDFDict) {
      resDict = resolved;
    } else {
      return detections.map(det => ({
        success: false,
        watermarkId: det.id,
        pageIndex,
        strategy: 'resource-cleanup' as const,
        description: 'Resources ref does not resolve to dict',
      }));
    }
  } else if (resources instanceof PDFDict) {
    resDict = resources;
  } else {
    return detections.map(det => ({
      success: false,
      watermarkId: det.id,
      pageIndex,
      strategy: 'resource-cleanup' as const,
      description: 'Resources is not a dict',
    }));
  }

  let cleanedCount = 0;

  // Clean up ExtGState entries for watermarks
  const extGState = resDict.get('ExtGState');
  if (extGState instanceof PDFDict) {
    const keysToRemove: string[] = [];

    for (const [key, value] of extGState.entries()) {
      // Remove GS_wm_* entries (our watermark engine's naming)
      if (key.startsWith('GS_wm_')) {
        keysToRemove.push(key);
        // Also delete the referenced object
        if (value instanceof PDFRef) {
          objects.delete(value.toKey());
        }
      }

      // Check detection metadata
      for (const det of detections) {
        const gsName = det.metadata?.extGStateName as string | undefined;
        if (gsName && key === gsName) {
          keysToRemove.push(key);
          if (value instanceof PDFRef) {
            objects.delete(value.toKey());
          }
        }
      }
    }

    for (const key of keysToRemove) {
      extGState.delete(key);
      cleanedCount++;
    }

    // If ExtGState dict is now empty, remove it
    if (extGState.size === 0) {
      resDict.delete('ExtGState');
    }
  }

  // Clean up XObject entries for watermark images
  const xobjects = resDict.get('XObject');
  if (xobjects instanceof PDFDict) {
    const keysToRemove: string[] = [];

    for (const [key, value] of xobjects.entries()) {
      // Remove ImWM_* entries (our watermark engine's naming)
      if (key.startsWith('ImWM_')) {
        keysToRemove.push(key);
        if (value instanceof PDFRef) {
          objects.delete(value.toKey());
        }
      }

      // Check detection metadata
      for (const det of detections) {
        const imgName = det.metadata?.imageName as string | undefined;
        if (imgName && key === imgName) {
          keysToRemove.push(key);
          if (value instanceof PDFRef) {
            objects.delete(value.toKey());
          }
        }
      }
    }

    for (const key of keysToRemove) {
      xobjects.delete(key);
      cleanedCount++;
    }

    if (xobjects.size === 0) {
      resDict.delete('XObject');
    }
  }

  // If Resources dict is now empty (only has required keys), we can leave it
  // but at minimum clean up the watermark-specific entries

  return detections.map(det => ({
    success: true,
    watermarkId: det.id,
    pageIndex,
    strategy: 'resource-cleanup' as const,
    description: cleanedCount > 0
      ? `Cleaned up ${cleanedCount} watermark resource(s)`
      : 'No watermark resources found to clean',
  }));
}

// ─── Utility: Remove all watermarks (detect + remove in one call) ───────────

/**
 * Convenience function: detect and remove all watermarks from a document.
 * Combines detection and removal in a single operation.
 */
export function detectAndRemoveAllWatermarks(
  doc: { pages: PDFPageInfo[]; objects: Map<string, PDFObject> },
  options?: {
    minConfidence?: number;
    dryRun?: boolean;
  },
): { detections: DetectedWatermark[]; removal: BatchRemovalResult } {
  const { detectWatermarks } = require('./watermark-detector');

  const detections = detectWatermarks(doc, {
    minConfidence: options?.minConfidence ?? 0.4,
  });

  let removal: BatchRemovalResult;
  if (options?.dryRun) {
    removal = {
      total: detections.length,
      removed: 0,
      failed: 0,
      results: detections.map(d => ({
        success: false,
        watermarkId: d.id,
        pageIndex: d.pageIndex,
        strategy: 'content-surgery' as const,
        description: 'Dry run — no changes made',
      })),
    };
  } else {
    removal = removeWatermarks(doc, detections);
  }

  return { detections, removal };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bytesToString(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(bytes);
}

function stringToBytes(s: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(s);
}

function escapePDFStringForRegex(text: string): string {
  // Escape regex special chars AND PDF string special chars
  return text
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}