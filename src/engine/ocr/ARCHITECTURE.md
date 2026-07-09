# OCR Preprocessing Engine (Phase 7)

Classical document layout analysis and deskew for scanned PDF pages — the front-end of a full OCR pipeline.

## Problem

Scanned pages arrive skewed and without text structure. Before glyph recognition (CRNN/CTC in a future phase), we must:

1. Estimate and correct rotation (deskew)
2. Segment the page into text blocks and columns

## Architecture

```
Raster page (GrayscaleImage)
  → projection-profiles.ts
       computeHorizontalProjection / computeVerticalProjection
       detectDeskewAngle()        — rotation search
       detectLayoutRegions()      — valley segmentation
       analyzePageLayout()        — combined pipeline
  → (future) recognition/         — CRNN, searchable text layer
```

## ISO / Standards

OCR output layers follow ISO 32000-2 §14.9 (Optional Content) and common practice for hidden text (`Td` + rendered glyphs with `/F 4` or `/Span` marked content). This phase does not emit PDF yet — it produces geometry for downstream placement.

## Projection Profile Mathematics

For grayscale image \(I(x,y)\) with ink threshold \(\tau\):

**Ink indicator:**

\[
\text{ink}(x,y) = \begin{cases}
255 - I(x,y) & \text{if } I(x,y) < \tau \\
0 & \text{otherwise}
\end{cases}
\]

**Horizontal projection (row sums):**

\[
H(y) = \sum_{x=0}^{W-1} \text{ink}(x, y)
\]

**Vertical projection (column sums):**

\[
V(x) = \sum_{y=0}^{H-1} \text{ink}(x, y)
\]

Text lines produce peaks in \(H(y)\); valleys between lines define horizontal bands. Columns appear as valleys in \(V(x)\) within each band.

## Deskew Algorithm

1. Coarse search \(\theta \in [-\theta_{max}, +\theta_{max}]\) step \(\Delta\theta\)
2. Rotate image by \(\theta\) (nearest-neighbor inverse map)
3. Compute \(H(y)\), score = variance of \(H\)
4. Pick \(\theta^*\) minimizing score
5. Refine with step `refineStep` around \(\theta^*\)

**Returned angle:** negated optimal rotation so caller rotates content to horizontal.

Rotation matrix (image coords, origin center):

\[
\begin{bmatrix} x' \\ y' \end{bmatrix}
=
\begin{bmatrix}
\cos\theta & \sin\theta \\
-\sin\theta & \cos\theta
\end{bmatrix}
\begin{bmatrix} x - c_x \\ y - c_y \end{bmatrix}
+
\begin{bmatrix} c_x \\ c_y \end{bmatrix}
\]

**Complexity:** O(\(A \cdot W \cdot H\)) where \(A\) = number of angle samples.

**Memory:** One rotated buffer O(\(W \cdot H\)).

## Layout Region Detection

1. `findValleys(H, minGap, ε)` — contiguous low-ink rows
2. For each row band, `findValleys(V, minGap, ε)` — column splits
3. Filter regions with area < `minRegionArea`
4. Classify by aspect ratio and ink density

| Heuristic | Classification |
|-----------|----------------|
| width < 15% page | column |
| height < 5% page | margin |
| inkDensity > 0.35 | figure |
| else | text-block |

## Gap Analysis vs Adobe Acrobat

| Capability | Acrobat OCR | This engine |
|------------|-------------|-------------|
| Auto deskew | Yes (proprietary) | Projection variance search |
| Multi-column | Yes | Vertical valley split |
| Table detection | Advanced | Not yet — treats tables as figures |
| Neural OCR | Commercial engine | Phase 7.5+ (not here) |
| Searchable layer | Full font embedding | Geometry only |
| Language ID | Yes | Not supported |
| Confidence scores | Per-word | Layout-level only |

## Edge Cases

- Blank page → empty regions, angle ≈ 0
- Heavy noise → raise `inkThreshold` or morphological open (future)
- 90° rotation → outside ±15° default search range
- Low DPI → increase `minGap` proportionally

## Testing Strategy

- Synthetic skewed rectangle grid → recovered angle within ±0.5°
- Two-column synthetic page → ≥2 text-block/column regions
- Blank image → zero regions, no throw

## Performance Notes

Nearest-neighbor rotation is acceptable for deskew search (small angles). Production OCR should use bilinear sampling once for final correction.
