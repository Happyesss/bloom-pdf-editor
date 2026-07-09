/**
 * Greedy line breaking — wraps text at word boundaries to fit a max width.
 */

/** Split text into lines that each fit within maxWidth (page units). */
export function greedyWrap(
  text: string,
  maxWidth: number,
  measure: (segment: string) => number,
): string[] {
  if (!text) return [''];
  if (maxWidth <= 0) return [text];

  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [text];

  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    const width = measure(candidate);

    if (width <= maxWidth || current === '') {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

/** Preview wrap without mutating — used by the edit overlay. */
export function previewWrap(
  text: string,
  maxWidth: number,
  measure: (segment: string) => number,
): string[] {
  return greedyWrap(text, maxWidth, measure);
}
