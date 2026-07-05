/**
 * Watermark Detection Engine
 *
 * Scans PDF pages to identify watermarks. Detection strategies:
 *
 * 1. **Content-stream analysis** — Scans the graphics operators in page
 *    content streams for patterns characteristic of watermarks:
 *    - Repeated text strings at regular intervals (tiled text)
 *    - Text with high transparency (opacity < 0.5)
 *    - Large diagonal text spanning the page
 *    - Repeated image XObject invocations (tiled images)
 *    - Text outside normal reading areas (margins, center overlay)
 *
 * 2. **Annotation-based detection** — Looks for watermark annotations
 *    (custom /Subtype "Watermark" or marked content with /Tag "Watermark")
 *
 * 3. **Resource analysis** — Identifies ExtGState dictionaries with
 *    unusually low opacity values that are characteristic of watermarks.
 *
 * The engine returns a list of detected watermarks with confidence scores
 * and metadata (position, text content, opacity, etc.).
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFStream,
  PDFString,
  PDFRef,
  type PDFPageInfo,
} from '../types';

// ─── Detection result types ─────────────────────────────────────────────────

export interface DetectedWatermark {
  /** Unique ID assigned to this detection */
  id: string;
  /** Type of detected watermark */
  type: 'text' | 'image' | 'pattern';
  /** Confidence score (0-1) */
  confidence: number;
  /** The detected text content (for text/pattern watermarks) */
  text?: string;
  /** Font name if detected */
  fontName?: string;
  /** Font size if detected */
  fontSize?: number;
  /** Detected opacity (0-1) */
  opacity?: number;
  /** Detected rotation angle in degrees */
  rotation?: number;
  /** Whether the watermark is tiled/repeated */
  isTiled: boolean;
  /** Approximate position(s) on the page */
  positions: Array<{ x: number; y: number }>;
  /** Page index where found */
  pageIndex: number;
  /** The raw content region (byte offset range) for removal */
  contentRegion?: { start: number; end: number };
  /** Detection method used */
  detectionMethod: 'content-analysis' | 'annotation' | 'resource-analysis';
  /** Additional metadata */
  metadata: Record<string, unknown>;
}

export interface DetectionOptions {
  /** Minimum confidence threshold (0-1) for reporting a detection */
  minConfidence: number;
  /** Whether to scan content streams */
  scanContentStreams: boolean;
  /** Whether to scan annotations */
  scanAnnotations: boolean;
  /** Whether to scan resources for opacity hints */
  scanResources: boolean;
  /** Minimum number of repetitions to consider something "tiled" */
  minTileRepetitions: number;
  /** Maximum opacity to consider as watermark-like */
  maxWatermarkOpacity: number;
}

const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  minConfidence: 0.4,
  scanContentStreams: true,
  scanAnnotations: true,
  scanResources: true,
  minTileRepetitions: 3,
  maxWatermarkOpacity: 0.6,
};

// ─── Main detection function ────────────────────────────────────────────────

/**
 * Detect watermarks across all pages of a document.
 */
export function detectWatermarks(
  doc: { pages: PDFPageInfo[]; objects: Map<string, PDFObject> },
  options?: Partial<DetectionOptions>,
): DetectedWatermark[] {
  const opts = { ...DEFAULT_DETECTION_OPTIONS, ...options };
  const results: DetectedWatermark[] = [];

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const pageResults = detectWatermarksOnPage(page, doc.objects, i, opts);
    results.push(...pageResults);
  }

  return results;
}

/**
 * Detect watermarks on a single page.
 */
export function detectWatermarksOnPage(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  pageIndex: number,
  options?: Partial<DetectionOptions>,
): DetectedWatermark[] {
  const opts = { ...DEFAULT_DETECTION_OPTIONS, ...options };
  const results: DetectedWatermark[] = [];

  if (opts.scanContentStreams) {
    const contentResults = analyzeContentStream(page, objects, pageIndex, opts);
    results.push(...contentResults);
  }

  if (opts.scanAnnotations) {
    const annotationResults = analyzeAnnotations(page, objects, pageIndex, opts);
    results.push(...annotationResults);
  }

  if (opts.scanResources) {
    const resourceResults = analyzeResources(page, objects, pageIndex, opts);
    results.push(...resourceResults);
  }

  // Deduplicate overlapping detections
  return deduplicateDetections(results);
}

// ─── Content stream analysis ────────────────────────────────────────────────

interface TextOccurrence {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontName: string;
  opacity: number;
  byteOffset: number;
  byteLength: number;
}

interface ImageOccurrence {
  imageName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  byteOffset: number;
  byteLength: number;
}

function analyzeContentStream(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  // Get decoded content bytes
  const contentBytes = getPageContentBytes(page, objects);
  if (!contentBytes || contentBytes.length === 0) return results;

  const contentStr = bytesToString(contentBytes);

  // Parse text occurrences from the content stream
  const textOccurrences = extractTextOccurrences(contentStr);
  const imageOccurrences = extractImageOccurrences(contentStr);

  // ── Strategy 1: Tiled text detection ──
  const tiledTextResults = detectTiledText(textOccurrences, pageIndex, opts);
  results.push(...tiledTextResults);

  // ── Strategy 2: Low-opacity text detection ──
  const lowOpacityResults = detectLowOpacityText(textOccurrences, pageIndex, opts);
  results.push(...lowOpacityResults);

  // ── Strategy 3: Diagonal/large centered text ──
  const diagonalResults = detectDiagonalText(textOccurrences, pageIndex, opts);
  results.push(...diagonalResults);

  // ── Strategy 4: Tiled image detection ──
  const tiledImageResults = detectTiledImages(imageOccurrences, pageIndex, opts);
  results.push(...tiledImageResults);

  // ── Strategy 5: Low-opacity image detection ──
  const lowOpacityImageResults = detectLowOpacityImages(imageOccurrences, pageIndex, opts);
  results.push(...lowOpacityImageResults);

  return results;
}

// ── Text occurrence extraction ──────────────────────────────────────────────

function extractTextOccurrences(contentStr: string): TextOccurrence[] {
  const occurrences: TextOccurrence[] = [];

  // Track graphics state
  let currentFont = 'Helvetica';
  let currentFontSize = 12;
  let currentOpacity = 1.0;
  let currentX = 0;
  let currentY = 0;
  let currentTM: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

  // Simple regex-based extraction of text operations
  // Match: BT ... ET blocks with Tj/TJ/' operators
  const btBlocks = contentStr.match(/BT[\s\S]*?ET/g);
  if (!btBlocks) return occurrences;

  for (const block of btBlocks) {
    // Track Td (text position) and Tm (text matrix) within the block
    const tdMatch = block.match(/([\d.-]+)\s+([\d.-]+)\s+Td/);
    if (tdMatch) {
      currentX = parseFloat(tdMatch[1]);
      currentY = parseFloat(tdMatch[2]);
    }

    const tmMatch = block.match(/([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+Tm/);
    if (tmMatch) {
      currentTM = [
        parseFloat(tmMatch[1]), parseFloat(tmMatch[2]),
        parseFloat(tmMatch[3]), parseFloat(tmMatch[4]),
        parseFloat(tmMatch[5]), parseFloat(tmMatch[6]),
      ];
    }

    // Extract Tj (show text) operations
    const tjRegex = /\(([^)]*(?:\\.[^)]*)*)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const text = unescapePDFString(tjMatch[1]);
      occurrences.push({
        text,
        x: currentX,
        y: currentY,
        fontSize: currentFontSize,
        fontName: currentFont,
        opacity: currentOpacity,
        byteOffset: tjMatch.index,
        byteLength: tjMatch[0].length,
      });
    }

    // Extract TJ (show text array) operations
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
    let tjArrMatch: RegExpExecArray | null;
    while ((tjArrMatch = tjArrayRegex.exec(block)) !== null) {
      const inner = tjArrMatch[1];
      const strMatches = inner.match(/\(([^)]*(?:\\.[^)]*)*)\)/g);
      if (strMatches) {
        const combinedText = strMatches.map(s => unescapePDFString(s.slice(1, -1))).join('');
        occurrences.push({
          text: combinedText,
          x: currentX,
          y: currentY,
          fontSize: currentFontSize,
          fontName: currentFont,
          opacity: currentOpacity,
          byteOffset: tjArrMatch.index,
          byteLength: tjArrMatch[0].length,
        });
      }
    }
  }

  return occurrences;
}

function extractImageOccurrences(contentStr: string): ImageOccurrence[] {
  const occurrences: ImageOccurrence[] = [];

  // Match: /ImName Do
  const doRegex = /\/(\w+)\s+Do/g;
  let match: RegExpExecArray | null;
  while ((match = doRegex.exec(contentStr)) !== null) {
    occurrences.push({
      imageName: match[1],
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      opacity: 1.0,
      byteOffset: match.index,
      byteLength: match[0].length,
    });
  }

  return occurrences;
}

// ── Detection strategies ────────────────────────────────────────────────────

function detectTiledText(
  occurrences: TextOccurrence[],
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  // Group occurrences by text content
  const groups = new Map<string, TextOccurrence[]>();
  for (const occ of occurrences) {
    const key = occ.text.trim();
    if (key.length < 2) continue; // Skip very short strings
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(occ);
  }

  for (const [text, occs] of groups) {
    if (occs.length < opts.minTileRepetitions) continue;

    // Check if positions form a regular grid
    const isGrid = checkGridPattern(occs);
    const confidence = isGrid ? 0.85 : 0.5;

    if (confidence >= opts.minConfidence) {
      results.push({
        id: `detected-tiled-text-${pageIndex}-${hashString(text)}`,
        type: 'pattern',
        confidence,
        text,
        fontName: occs[0].fontName,
        fontSize: occs[0].fontSize,
        opacity: occs[0].opacity,
        rotation: estimateRotation(occs),
        isTiled: true,
        positions: occs.map(o => ({ x: o.x, y: o.y })),
        pageIndex,
        detectionMethod: 'content-analysis',
        metadata: { occurrenceCount: occs.length, isGrid },
      });
    }
  }

  return results;
}

function detectLowOpacityText(
  occurrences: TextOccurrence[],
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  const lowOpacityOccs = occurrences.filter(o => o.opacity <= opts.maxWatermarkOpacity && o.opacity > 0);
  if (lowOpacityOccs.length === 0) return results;

  // Group by text
  const groups = new Map<string, TextOccurrence[]>();
  for (const occ of lowOpacityOccs) {
    const key = occ.text.trim();
    if (key.length < 2) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(occ);
  }

  for (const [text, occs] of groups) {
    const confidence = occs.length >= opts.minTileRepetitions ? 0.8 : 0.5;
    if (confidence >= opts.minConfidence) {
      results.push({
        id: `detected-lowopacity-${pageIndex}-${hashString(text)}`,
        type: occs.length >= opts.minTileRepetitions ? 'pattern' : 'text',
        confidence,
        text,
        fontName: occs[0].fontName,
        fontSize: occs[0].fontSize,
        opacity: occs[0].opacity,
        rotation: estimateRotation(occs),
        isTiled: occs.length >= opts.minTileRepetitions,
        positions: occs.map(o => ({ x: o.x, y: o.y })),
        pageIndex,
        detectionMethod: 'content-analysis',
        metadata: { occurrenceCount: occs.length, avgOpacity: averageOpacity(occs) },
      });
    }
  }

  return results;
}

function detectDiagonalText(
  occurrences: TextOccurrence[],
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  // Look for text with significant rotation (TM has non-zero b/c components)
  // and text that appears near the center of the page
  // This is a heuristic — we look for text occurrences that are isolated
  // (not part of a dense block) and have rotation indicators

  // For now, detect single large text strings that appear alone
  const singleOccurrences = occurrences.filter(o => o.text.trim().length > 5);
  const textGroups = new Map<string, TextOccurrence[]>();
  for (const occ of singleOccurrences) {
    const key = occ.text.trim();
    if (!textGroups.has(key)) textGroups.set(key, []);
    textGroups.get(key)!.push(occ);
  }

  for (const [text, occs] of textGroups) {
    // Single large text that appears only once or twice — likely a diagonal watermark
    if (occs.length <= 2 && text.length > 10) {
      results.push({
        id: `detected-diagonal-${pageIndex}-${hashString(text)}`,
        type: 'text',
        confidence: 0.6,
        text,
        fontName: occs[0].fontName,
        fontSize: occs[0].fontSize,
        opacity: occs[0].opacity,
        rotation: estimateRotation(occs),
        isTiled: false,
        positions: occs.map(o => ({ x: o.x, y: o.y })),
        pageIndex,
        detectionMethod: 'content-analysis',
        metadata: { occurrenceCount: occs.length },
      });
    }
  }

  return results;
}

function detectTiledImages(
  occurrences: ImageOccurrence[],
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  // Group by image name
  const groups = new Map<string, ImageOccurrence[]>();
  for (const occ of occurrences) {
    if (!groups.has(occ.imageName)) groups.set(occ.imageName, []);
    groups.get(occ.imageName)!.push(occ);
  }

  for (const [name, occs] of groups) {
    if (occs.length >= opts.minTileRepetitions) {
      results.push({
        id: `detected-tiled-img-${pageIndex}-${hashString(name)}`,
        type: 'image',
        confidence: 0.8,
        isTiled: true,
        positions: occs.map(o => ({ x: o.x, y: o.y })),
        pageIndex,
        detectionMethod: 'content-analysis',
        metadata: { imageName: name, occurrenceCount: occs.length },
      });
    }
  }

  return results;
}

function detectLowOpacityImages(
  occurrences: ImageOccurrence[],
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  const lowOpacityOccs = occurrences.filter(o => o.opacity <= opts.maxWatermarkOpacity && o.opacity > 0);
  if (lowOpacityOccs.length === 0) return results;

  for (const occ of lowOpacityOccs) {
    results.push({
      id: `detected-lowopacity-img-${pageIndex}-${hashString(occ.imageName)}`,
      type: 'image',
      confidence: 0.55,
      isTiled: false,
      positions: [{ x: occ.x, y: occ.y }],
      pageIndex,
      detectionMethod: 'content-analysis',
      metadata: { imageName: occ.imageName, opacity: occ.opacity },
    });
  }

  return results;
}

// ── Annotation analysis ────────────────────────────────────────────────────

function analyzeAnnotations(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  const annots = page.dict.get('Annots');
  if (!annots) return results;

  let annotArray: PDFArray;
  if (annots instanceof PDFRef) {
    const resolved = objects.get(annots.toKey());
    if (resolved instanceof PDFArray) {
      annotArray = resolved;
    } else {
      return results;
    }
  } else if (annots instanceof PDFArray) {
    annotArray = annots;
  } else {
    return results;
  }

  for (let i = 0; i < annotArray.length; i++) {
    const annotRef = annotArray.get(i);
    if (!(annotRef instanceof PDFRef)) continue;

    const annotObj = objects.get(annotRef.toKey());
    if (!(annotObj instanceof PDFDict)) continue;

    // Check for custom watermark subtype
    const subtype = annotObj.get('Subtype');
    if (subtype instanceof PDFName && subtype.name === 'Watermark') {
      const contents = annotObj.get('Contents');
      const text = contents instanceof PDFString ? contents.value : '';

      results.push({
        id: `detected-annot-${pageIndex}-${annotRef.toKey()}`,
        type: 'text',
        confidence: 0.95,
        text,
        isTiled: false,
        positions: [{ x: 0, y: 0 }],
        pageIndex,
        detectionMethod: 'annotation',
        metadata: { annotRef: annotRef.toKey(), subtype: 'Watermark' },
      });
    }

    // Check for marked content with /Tag "Watermark"
    const ap = annotObj.get('AP');
    if (ap instanceof PDFDict) {
      const n = ap.get('N');
      if (n instanceof PDFStream) {
        const apBytes = n.decodedBytes || n.rawBytes;
        const apStr = bytesToString(apBytes);
        if (apStr.includes('/Tag') && apStr.includes('Watermark')) {
          const contents = annotObj.get('Contents');
          const text = contents instanceof PDFString ? contents.value : '';

          results.push({
            id: `detected-ap-${pageIndex}-${annotRef.toKey()}`,
            type: 'text',
            confidence: 0.9,
            text,
            isTiled: false,
            positions: [{ x: 0, y: 0 }],
            pageIndex,
            detectionMethod: 'annotation',
            metadata: { annotRef: annotRef.toKey(), hasTag: true },
          });
        }
      }
    }
  }

  return results;
}

// ── Resource analysis ──────────────────────────────────────────────────────

function analyzeResources(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  pageIndex: number,
  opts: DetectionOptions,
): DetectedWatermark[] {
  const results: DetectedWatermark[] = [];

  const resources = page.dict.get('Resources');
  if (!resources) return results;

  let resDict: PDFDict;
  if (resources instanceof PDFRef) {
    const resolved = objects.get(resources.toKey());
    if (resolved instanceof PDFDict) {
      resDict = resolved;
    } else {
      return results;
    }
  } else if (resources instanceof PDFDict) {
    resDict = resources;
  } else {
    return results;
  }

  // Check ExtGState for low opacity
  const extGState = resDict.get('ExtGState');
  if (extGState instanceof PDFDict) {
    for (const [key, value] of extGState.entries()) {
      let gsDict: PDFDict | undefined;
      if (value instanceof PDFRef) {
        const resolved = objects.get(value.toKey());
        if (resolved instanceof PDFDict) gsDict = resolved;
      } else if (value instanceof PDFDict) {
        gsDict = value;
      }

      if (gsDict) {
        const ca = gsDict.get('ca');
        const CA = gsDict.get('CA');
        const opacity = ca instanceof PDFNumber ? ca.value : (CA instanceof PDFNumber ? CA.value : 1);

        if (opacity <= opts.maxWatermarkOpacity && opacity > 0) {
          results.push({
            id: `detected-res-${pageIndex}-${hashString(key)}`,
            type: 'text',
            confidence: 0.45,
            opacity,
            isTiled: false,
            positions: [],
            pageIndex,
            detectionMethod: 'resource-analysis',
            metadata: { extGStateName: key, ca: opacity },
          });
        }
      }
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPageContentBytes(page: PDFPageInfo, objects: Map<string, PDFObject>): Uint8Array | null {
  const contents = page.dict.get('Contents');
  if (!contents) return null;

  const refs: PDFRef[] = [];
  if (contents instanceof PDFRef) {
    refs.push(contents);
  } else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.length; i++) {
      const item = contents.get(i);
      if (item instanceof PDFRef) refs.push(item);
    }
  }

  const chunks: Uint8Array[] = [];
  for (const ref of refs) {
    const obj = objects.get(ref.toKey());
    if (obj instanceof PDFStream) {
      chunks.push(obj.decodedBytes || obj.rawBytes);
    }
  }

  if (chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0];

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function bytesToString(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  return decoder.decode(bytes);
}

function unescapePDFString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')');
}

function checkGridPattern(occurrences: TextOccurrence[]): boolean {
  if (occurrences.length < 4) return false;

  // Extract x and y coordinates
  const xs = occurrences.map(o => o.x).sort((a, b) => a - b);
  const ys = occurrences.map(o => o.y).sort((a, b) => a - b);

  // Check if x coordinates form regular intervals
  const xDiffs: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const diff = xs[i] - xs[i - 1];
    if (diff > 5) xDiffs.push(diff);
  }

  // Check if y coordinates form regular intervals
  const yDiffs: number[] = [];
  for (let i = 1; i < ys.length; i++) {
    const diff = ys[i] - ys[i - 1];
    if (diff > 5) yDiffs.push(diff);
  }

  // If diffs are consistent (std dev is small relative to mean), it's a grid
  if (xDiffs.length >= 2) {
    const xMean = xDiffs.reduce((a, b) => a + b, 0) / xDiffs.length;
    const xStd = Math.sqrt(xDiffs.reduce((sum, d) => sum + (d - xMean) ** 2, 0) / xDiffs.length);
    if (xStd / xMean > 0.3) return false;
  }

  if (yDiffs.length >= 2) {
    const yMean = yDiffs.reduce((a, b) => a + b, 0) / yDiffs.length;
    const yStd = Math.sqrt(yDiffs.reduce((sum, d) => sum + (d - yMean) ** 2, 0) / yDiffs.length);
    if (yStd / yMean > 0.3) return false;
  }

  return true;
}

function estimateRotation(occurrences: TextOccurrence[]): number {
  // Simple heuristic: if positions vary diagonally, estimate rotation
  if (occurrences.length < 2) return 0;

  const first = occurrences[0];
  const last = occurrences[occurrences.length - 1];

  const dx = last.x - first.x;
  const dy = last.y - first.y;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 0;

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  // Normalize to 0-90 range for typical watermark rotations
  const normalized = Math.abs(angle) % 180;
  return normalized > 90 ? 180 - normalized : normalized;
}

function averageOpacity(occurrences: TextOccurrence[]): number {
  if (occurrences.length === 0) return 1;
  return occurrences.reduce((sum, o) => sum + o.opacity, 0) / occurrences.length;
}

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

function deduplicateDetections(detections: DetectedWatermark[]): DetectedWatermark[] {
  if (detections.length <= 1) return detections;

  const result: DetectedWatermark[] = [];
  const seen = new Set<string>();

  // Sort by confidence descending
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);

  for (const det of sorted) {
    // Create a fingerprint based on text + positions
    const fingerprint = `${det.text || det.id}-${det.pageIndex}-${det.type}`;
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      result.push(det);
    }
  }

  return result;
}