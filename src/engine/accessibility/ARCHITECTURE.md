# Accessibility Engine (Phase 11)

Tagged PDF structure tree parsing, standard role mapping, and reading-order extraction for screen readers and PDF/UA validation.

## Problem

Untagged PDFs expose arbitrary drawing order. Assistive technology needs logical structure (`/StructTreeRoot`), mapped semantics, and stable reading order distinct from content-stream paint order.

## Architecture

```
Catalog /StructTreeRoot
  → parseStructureTree()     — /K hierarchy, RoleMap, ClassMap
  → mapStructureRole()         — PDF /S → HTML semantics
  → walkStructureTree()        — DFS reading order
  → enrichReadingOrderWithMcidText() — inject MCID text map
  → export/ / a11y API         — consumers
```

## ISO References

| Standard | Topic |
|----------|-------|
| ISO 32000-2 §14.8 | Tagged PDF, structure hierarchy |
| ISO 14289 (PDF/UA) | Accessible PDF requirements |
| WCAG 2.x | Web content mapping via HTML roles |

## Structure Tree Model

```
StructTreeRoot
  /RoleMap  — custom alias → standard role
  /ClassMap — attribute class definitions
  /K        — StructureElement or array thereof
```

Each `StructureNode`:

| Field | PDF entry |
|-------|-----------|
| role | /S |
| altText | /Alt |
| actualText | /ActualText |
| language | /Lang |
| pageRef | /Pg |
| children | /K (elements or MCID integers) |

## Role Mapping

`DEFAULT_ROLE_MAP` maps standard structure types to HTML-like roles:

| PDF /S | mappedRole |
|--------|------------|
| H1 | h1 |
| P | p |
| L | ul |
| LI | li |
| Table | table |
| Figure | figure |
| Link | a |

Custom roles resolve through `/RoleMap` before lookup.

## Reading Order Algorithm

Depth-first pre-order traversal:

```
visit(node, depth):
  if includeNonStruct or role ∉ {NonStruct, Private}:
    emit ReadingOrderItem(node, depth)
  for child in node.children:
    visit(child, depth + 1)
```

**Complexity:** O(n) for n structure nodes.

**Memory:** O(n) output items; O(h) stack depth h = tree height.

### MCID enrichment

Marked content IDs link structure elements to content-stream spans:

```
key = "{pageRef.objNum}_{pageRef.genNum}:{mcid}"
text ← mcidText.get(key)
```

## Gap Analysis vs Adobe Acrobat

| Feature | Acrobat | This engine |
|---------|---------|-------------|
| Read aloud order | Tagged PDF + AI fallback | Structure tree DFS |
| Role map | Full | Parsed and applied |
| Class map attrs | Full layout attrs | Stored, not validated |
| PDF/UA checker | Commercial ruleset | Reading order only |
| Alt text editing | Yes | Read /Alt |
| Artifact detection | Yes | Not yet |
| Untagged PDF infer | Heuristic | Requires `/StructTreeRoot` |

## Edge Cases

- Missing `/StructTreeRoot` → caller handles untagged path
- `/K` as single ref vs array — both supported
- Integer `/K` → MCID leaf node
- Circular refs in tree — not handled (malformed PDF)

## Testing Strategy

- Minimal StructTreeRoot fixture → expected reading order roles
- RoleMap alias resolves before mapping
- MCID enrichment fills text from external map
- NonStruct excluded by default

## PDF/UA Notes

PDF/UA requires tagged content for all meaningful elements, adequate /Alt for figures, and reading order matching visual order. Future validation module will check:

- Every page has `/StructParents` or marked content
- No skipped heading levels
- Table header (`/TH`) scope attributes
