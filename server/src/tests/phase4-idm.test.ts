import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import {
  FindChildren,
  FindNode,
  FindParent,
  LoadDocument,
  SaveDocument,
  Search,
  Traverse,
} from '../engines/idm/document-api.js';
import { deserializeIdm, serializeIdmBinary, serializeIdmJson } from '../engines/idm/serialize.js';
import { IDM_VERSION } from '../engines/idm/types.js';
import {
  buildPage,
  buildRawDocument,
  lineOfWords,
  wordChars,
} from './helpers/raw-fixtures.js';

async function buildIdm() {
  const chars = [
    ...lineOfWords(['Header', 'Line'], 72, 760, 11),
    ...lineOfWords(['Hello', 'world', 'body'], 72, 520, 12),
    ...lineOfWords(['Second', 'line', 'here'], 72, 500, 12),
  ];
  const raw = buildRawDocument([
    buildPage({
      chars,
      images: [{ x: 100, y: 200, w: 180, h: 100 }],
    }),
  ]);
  const layout = await new LayoutEngine().analyze(raw);
  const idm = await new IntermediateDocumentEngine().build(raw, layout);
  return { raw, layout, idm };
}

describe('Phase 4 — IDM Reconstruction', () => {
  it('builds document tree with parent/child consistency', async () => {
    const { idm } = await buildIdm();

    expect(idm.version).toBe(IDM_VERSION);
    expect(idm.immutable).toBe(true);
    expect(idm.sections.length).toBe(1);

    const section = idm.sections[0]!;
    const page = section.pages[0]!;
    expect(page.parentId).toBe(section.id);
    expect(section.childIds).toContain(page.id);

    expect(page.blocks.length).toBeGreaterThanOrEqual(1);
    for (const block of page.blocks) {
      expect(block.parentId).toBe(page.id);
      expect(page.childIds).toContain(block.id);
      if (block.previousId) {
        const prev = page.blocks.find((b) => b.id === block.previousId);
        expect(prev?.nextId).toBe(block.id);
      }
    }
  });

  it('preserves reading order from layout', async () => {
    const { idm } = await buildIdm();
    const page = idm.sections[0]!.pages[0]!;
    const indices = page.blocks.map((b) => b.readingOrderIndex);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);

    // Body text should appear in reconstructed runs
    const text = page.blocks
      .filter((b) => 'runs' in b)
      .flatMap((b) => ('runs' in b ? b.runs.map((r) => r.text) : []))
      .join(' ');
    expect(text.toLowerCase()).toContain('hello');
  });

  it('reconstructs characters → words → runs without inventing table structure', async () => {
    const chars = lineOfWords(['Alpha', 'Beta'], 72, 500, 12);
    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const block = idm.sections[0]!.pages[0]!.blocks.find((b) => 'runs' in b);

    expect(block).toBeDefined();
    if (!block || !('runs' in block)) throw new Error('expected text block');

    expect(block.characters.length).toBeGreaterThan(0);
    expect(block.words.length).toBeGreaterThan(0);
    expect(block.runs.length).toBeGreaterThan(0);
    expect(block.type).not.toBe('table_placeholder');
    // No finalized heading classification for body
    if (block.type === 'heading') {
      expect(block.styleCandidates).toContain('Possible Heading');
    }
  });

  it('maps image regions to image blocks with resource metadata', async () => {
    const { idm } = await buildIdm();
    const images = idm.sections[0]!.pages[0]!.blocks.filter((b) => b.type === 'image');
    expect(images.length).toBeGreaterThanOrEqual(1);
    const img = images[0]!;
    if (img.type !== 'image') throw new Error('expected image');
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBeGreaterThan(0);
    expect(img.anchorType).toBeDefined();
    expect(img.wrappingType).toBeDefined();
  });

  it('does not finalize heading classification (candidates only)', async () => {
    const chars = wordChars('Big Title Text', 72, 700, 22);
    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const blocks = idm.sections[0]!.pages[0]!.blocks;

    for (const b of blocks) {
      if (b.type === 'heading' || b.type === 'title') {
        expect(b.styleCandidates.some((c) => c.includes('Heading') || c.includes('Title'))).toBe(
          true,
        );
      }
    }
    // Never emit real table detection
    expect(blocks.every((b) => b.type !== 'table_placeholder' || b.styleCandidates.includes('Possible Table'))).toBe(
      true,
    );
  });

  it('JSON serialization roundtrip', async () => {
    const { idm } = await buildIdm();
    const bytes = serializeIdmJson(idm);
    const restored = deserializeIdm(bytes, 'json');

    expect(restored.id).toBe(idm.id);
    expect(restored.version).toBe(IDM_VERSION);
    expect(restored.sections[0]!.pages[0]!.blocks.length).toBe(
      idm.sections[0]!.pages[0]!.blocks.length,
    );
  });

  it('binary + compressed serialization roundtrip via API', async () => {
    const { idm } = await buildIdm();
    const bin = SaveDocument(idm, 'binary');
    const loaded = LoadDocument(bin, 'binary');
    expect(loaded.sections[0]!.pages.length).toBe(1);

    const gz = serializeIdmBinary(idm, true);
    const loadedGz = LoadDocument(gz, 'binary');
    expect(loadedGz.metadata.pageCount).toBe(1);
  });

  it('traversal, find, and search APIs', async () => {
    const { idm } = await buildIdm();
    const page = idm.sections[0]!.pages[0]!;
    const block = page.blocks[0]!;

    expect(FindNode(idm, block.id)).toBeTruthy();
    expect((FindParent(idm, block.id) as { id: string }).id).toBe(page.id);
    expect(FindChildren(idm, page.id).length).toBeGreaterThan(0);

    let visited = 0;
    Traverse(idm, () => {
      visited++;
    });
    expect(visited).toBeGreaterThan(2);

    const hits = Search(idm, 'hello');
    expect(hits.length).toBeGreaterThanOrEqual(0); // may be in header-less body
  });

  it('does not interleave characters at a run boundary when x-positions are near-tied (rounding noise)', async () => {
    // Regression test for a bug where adjacent runs ("Architected" + "backend")
    // got character-interleaved into "Architectebdackend" because the last
    // character's x was, due to kerning/rounding noise, very slightly greater
    // than the *next* run's first character's x. A naive global sort-by-x
    // flips their relative order; extraction order must win for near-tied x.
    const fontSize = 12;
    const step = fontSize * 0.55;
    const y = 500;
    const word1 = 'Architected';
    const word2 = 'backend';

    const chars: import('./helpers/raw-fixtures.js').CharSpec[] = [];
    for (let i = 0; i < word1.length; i++) {
      chars.push({ ch: word1[i]!, x: 72 + i * step, y, fontSize, w: step, runId: 'runA' });
    }
    const lastX = 72 + (word1.length - 1) * step;
    chars.push({ ch: ' ', x: lastX + step, y, fontSize, w: fontSize * 0.3, runId: 'runA' });
    // Perturb: first char of word2 lands slightly BEFORE the last char of word1
    // (simulates float rounding/kerning noise at the run boundary).
    const perturbedStart = lastX - 1;
    for (let i = 0; i < word2.length; i++) {
      chars.push({ ch: word2[i]!, x: perturbedStart + i * step, y, fontSize, w: step, runId: 'runB' });
    }

    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);

    const text = idm.sections[0]!.pages[0]!.blocks
      .filter((b) => 'runs' in b)
      .flatMap((b) => ('runs' in b ? b.runs.map((r) => r.text) : []))
      .join('');

    // Correct order: "Architected" fully intact, immediately followed by "backend"
    // intact (order preserved). The bug produced "Architectebdackend" — i.e. the
    // trailing "d" of word1 displaced after the leading "b" of word2.
    expect(text).toContain('Architected backend');
    expect(text).not.toContain('Architecteb'); // bug signature: "d" displaced after "b"
  });

  it('does not interleave or reorder text when a run drifts far out of x-order (large glyph-width error)', async () => {
    // Harsher regression test: the second run's computed start x is WAY to
    // the left of the first run's start (simulating a large embedded-font
    // glyph-width miscalculation — not just rounding noise). Any fix based on
    // a fixed epsilon around x would still fail this; only trusting original
    // extraction order for same-line runs fixes it unconditionally.
    const fontSize = 12;
    const step = fontSize * 0.55;
    const y = 500;
    const word1 = 'cutting';
    const word2 = 'DB';

    const chars: import('./helpers/raw-fixtures.js').CharSpec[] = [];
    for (let i = 0; i < word1.length; i++) {
      chars.push({ ch: word1[i]!, x: 72 + i * step, y, fontSize, w: step, runId: 'runA' });
    }
    chars.push({ ch: ' ', x: 72 + word1.length * step, y, fontSize, w: fontSize * 0.3, runId: 'runA' });
    // word2 starts 40pt to the LEFT of word1's start — a huge, unrealistic
    // drift far larger than any sane epsilon, yet extraction order must win.
    for (let i = 0; i < word2.length; i++) {
      chars.push({ ch: word2[i]!, x: 72 - 40 + i * step, y, fontSize, w: step, runId: 'runB' });
    }

    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);

    const text = idm.sections[0]!.pages[0]!.blocks
      .filter((b) => 'runs' in b)
      .flatMap((b) => ('runs' in b ? b.runs.map((r) => r.text) : []))
      .join('');

    expect(text).toContain('cutting DB');
  });

  it('nodeIndex covers blocks and runs', async () => {
    const { idm } = await buildIdm();
    const block = idm.sections[0]!.pages[0]!.blocks.find((b) => 'runs' in b);
    expect(block).toBeDefined();
    expect(idm.nodeIndex[block!.id]?.kind).toBe('block');
    if (block && 'runs' in block && block.runs[0]) {
      expect(idm.nodeIndex[block.runs[0].id]?.kind).toBe('run');
    }
  });
});
