/**
 * Coordinate Transformation Utilities
 * 
 * Converts between PDF coordinate space and canvas coordinate space.
 * 
 * PDF Coordinate System:
 * - Origin at bottom-left corner
 * - Y-axis points upward
 * - Units in points (1/72 inch)
 * 
 * Canvas Coordinate System:
 * - Origin at top-left corner
 * - Y-axis points downward
 * - Units in pixels
 * 
 * The transformation must account for:
 * - Y-axis inversion (PDF bottom-up → Canvas top-down)
 * - Scaling (zoom level)
 * - Rotation (page rotation: 0°, 90°, 180°, 270°)
 * - Translation (viewport offset)
 */

export interface Point {
  x: number;
  y: number;
}

export interface ViewportTransform {
  /** Zoom scale factor (1.0 = 100%) */
  scale: number;
  /** Page rotation in degrees (0, 90, 180, 270) */
  rotation: number;
  /** Page dimensions in PDF points */
  pageWidth: number;
  pageHeight: number;
  /** Canvas viewport offset (for scroll position) */
  offsetX?: number;
  offsetY?: number;
}

/**
 * Convert PDF coordinates to canvas coordinates.
 * 
 * @param pdfX - X coordinate in PDF space (origin at bottom-left)
 * @param pdfY - Y coordinate in PDF space (origin at bottom-left)
 * @param transform - Viewport transformation parameters
 * @returns Point in canvas coordinate space (origin at top-left)
 * 
 * @example
 * // Basic transformation with scale only
 * const canvas = pdfToCanvas(100, 200, { scale: 2.0, rotation: 0, pageWidth: 612, pageHeight: 792 });
 * // canvas = { x: 200, y: 1184 } (scaled and Y-inverted)
 */
export function pdfToCanvas(
  pdfX: number,
  pdfY: number,
  transform: ViewportTransform
): Point {
  const { scale, rotation, pageWidth, pageHeight, offsetX = 0, offsetY = 0 } = transform;

  let canvasX: number;
  let canvasY: number;

  // Apply rotation first, then scale and translate
  switch (rotation) {
    case 0:
      // No rotation: standard Y-axis flip
      canvasX = pdfX * scale;
      canvasY = (pageHeight - pdfY) * scale;
      break;

    case 90:
      // 90° clockwise: swap axes and adjust
      canvasX = pdfY * scale;
      canvasY = pdfX * scale;
      break;

    case 180:
      // 180° rotation: flip both axes
      canvasX = (pageWidth - pdfX) * scale;
      canvasY = pdfY * scale;
      break;

    case 270:
      // 270° clockwise (or 90° counter-clockwise)
      canvasX = (pageHeight - pdfY) * scale;
      canvasY = (pageWidth - pdfX) * scale;
      break;

    default:
      // Fallback to no rotation for unsupported angles
      canvasX = pdfX * scale;
      canvasY = (pageHeight - pdfY) * scale;
      break;
  }

  // Apply viewport offset (for scroll position)
  canvasX += offsetX;
  canvasY += offsetY;

  return { x: canvasX, y: canvasY };
}

/**
 * Convert canvas coordinates to PDF coordinates.
 * 
 * @param canvasX - X coordinate in canvas space (origin at top-left)
 * @param canvasY - Y coordinate in canvas space (origin at top-left)
 * @param transform - Viewport transformation parameters
 * @returns Point in PDF coordinate space (origin at bottom-left)
 * 
 * @example
 * // Convert click position to PDF coordinates
 * const pdf = canvasToPdf(200, 1184, { scale: 2.0, rotation: 0, pageWidth: 612, pageHeight: 792 });
 * // pdf = { x: 100, y: 200 }
 */
export function canvasToPdf(
  canvasX: number,
  canvasY: number,
  transform: ViewportTransform
): Point {
  const { scale, rotation, pageWidth, pageHeight, offsetX = 0, offsetY = 0 } = transform;

  // Remove viewport offset first
  const adjustedX = canvasX - offsetX;
  const adjustedY = canvasY - offsetY;

  let pdfX: number;
  let pdfY: number;

  // Reverse the rotation transformation
  switch (rotation) {
    case 0:
      // No rotation: reverse Y-axis flip and scale
      pdfX = adjustedX / scale;
      pdfY = pageHeight - adjustedY / scale;
      break;

    case 90:
      // Reverse 90° clockwise rotation
      pdfX = adjustedY / scale;
      pdfY = adjustedX / scale;
      break;

    case 180:
      // Reverse 180° rotation
      pdfX = pageWidth - adjustedX / scale;
      pdfY = adjustedY / scale;
      break;

    case 270:
      // Reverse 270° clockwise rotation
      pdfX = pageWidth - adjustedY / scale;
      pdfY = pageHeight - adjustedX / scale;
      break;

    default:
      // Fallback to no rotation
      pdfX = adjustedX / scale;
      pdfY = pageHeight - adjustedY / scale;
      break;
  }

  return { x: pdfX, y: pdfY };
}

/**
 * Create a default viewport transform with common parameters.
 * 
 * @param pageWidth - Page width in PDF points
 * @param pageHeight - Page height in PDF points
 * @param scale - Optional scale factor (default: 1.0)
 * @param rotation - Optional rotation in degrees (default: 0)
 * @returns ViewportTransform object
 */
export function createViewportTransform(
  pageWidth: number,
  pageHeight: number,
  scale: number = 1.0,
  rotation: number = 0
): ViewportTransform {
  return {
    scale,
    rotation,
    pageWidth,
    pageHeight,
    offsetX: 0,
    offsetY: 0,
  };
}
