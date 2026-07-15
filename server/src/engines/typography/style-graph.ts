import type { StyleGraph, StyleProfile } from './types.js';

/**
 * Build parent / derived / sibling relationships by typography proximity.
 * Larger / bolder profiles tend to be "parent" of smaller regular ones (visual only).
 */
export function buildStyleGraph(profiles: StyleProfile[]): StyleGraph {
  const nodes = profiles.map((p) => ({
    profileId: p.id,
    parentStyleId: null as string | null,
    derivedStyleIds: [] as string[],
    siblingStyleIds: [] as string[],
    usageFrequency: p.occurrenceCount,
  }));

  const byId = new Map(nodes.map((n) => [n.profileId, n]));
  const edges: StyleGraph['edges'] = [];

  // Sibling: same font family + similar size (±1pt), differ in bold/italic
  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i]!;
      const b = profiles[j]!;
      const sameFamily =
        a.features.fontFamily.toLowerCase() === b.features.fontFamily.toLowerCase();
      const sizeClose = Math.abs(a.features.fontSize - b.features.fontSize) <= 1.1;
      if (sameFamily && sizeClose) {
        byId.get(a.id)!.siblingStyleIds.push(b.id);
        byId.get(b.id)!.siblingStyleIds.push(a.id);
        edges.push({ from: a.id, to: b.id, relation: 'sibling' });
      }
    }
  }

  // Parent/derived: same family, parent larger or bolder
  const sorted = [...profiles].sort(
    (a, b) =>
      b.features.fontSize - a.features.fontSize ||
      Number(b.features.bold) - Number(a.features.bold),
  );

  for (const child of sorted) {
    const parent = sorted.find(
      (p) =>
        p.id !== child.id &&
        p.features.fontFamily.toLowerCase() === child.features.fontFamily.toLowerCase() &&
        (p.features.fontSize > child.features.fontSize + 0.5 ||
          (p.features.bold && !child.features.bold && Math.abs(p.features.fontSize - child.features.fontSize) < 2)),
    );
    if (parent) {
      const childNode = byId.get(child.id)!;
      if (!childNode.parentStyleId) {
        childNode.parentStyleId = parent.id;
        byId.get(parent.id)!.derivedStyleIds.push(child.id);
        edges.push({ from: parent.id, to: child.id, relation: 'derived' });
        edges.push({ from: child.id, to: parent.id, relation: 'parent' });
      }
    }
  }

  return { nodes: [...byId.values()], edges };
}
