import { PageSpatialIndex } from '../../engines/parser/spatial-index.js';
import type { PathCommand, RawPage, RawVector } from '../../engines/parser/raw-model.js';
import {
  buildPage,
  buildRawDocument,
  wordChars,
  type CharSpec,
} from './raw-fixtures.js';

/** 2×3 borderless text grid (Name/Age/City × 2 data rows). */
export function borderlessGrid2x3Chars(): CharSpec[] {
  const cols = [72, 220, 360];
  const rows = [520, 490, 460];
  const cells = [
    ['Name', 'Age', 'City'],
    ['Alice', '30', 'NYC'],
    ['Bob', '25', 'LA'],
  ];
  const out: CharSpec[] = [];
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r]!.length; c++) {
      out.push(...wordChars(cells[r]![c]!, cols[c]!, rows[r]!, 11));
    }
  }
  return out;
}

/** Header row larger/bold + body. */
export function headerGridChars(): CharSpec[] {
  const cols = [72, 220, 360];
  const rows = [520, 490, 460];
  const header = ['Item', 'Qty', 'Price'];
  const body = [
    ['Widget', '2', '9.99'],
    ['Gadget', '1', '4.50'],
  ];
  const out: CharSpec[] = [];
  for (let c = 0; c < header.length; c++) {
    const chars = wordChars(header[c]!, cols[c]!, rows[0]!, 14);
    for (const ch of chars) ch.fontWeight = 700;
    out.push(...chars);
  }
  for (let r = 0; r < body.length; r++) {
    for (let c = 0; c < body[r]!.length; c++) {
      out.push(...wordChars(body[r]![c]!, cols[c]!, rows[r + 1]!, 11));
    }
  }
  return out;
}

/** Wide top label + 3-col body (merged cell candidate). */
export function mergedTopLabelChars(): CharSpec[] {
  const cols = [72, 220, 360];
  const rows = [520, 480];
  // Long label starting in col0; extends visually across columns
  const out = [
    ...wordChars('Quarterly Summary Report', cols[0]!, rows[0]!, 11),
    ...wordChars('A', cols[0]!, rows[1]!, 11),
    ...wordChars('B', cols[1]!, rows[1]!, 11),
    ...wordChars('C', cols[2]!, rows[1]!, 11),
  ];
  return out;
}

/** Currency / numeric typed columns. */
export function typedColumnChars(): CharSpec[] {
  const cols = [72, 220, 360];
  const rows = [520, 490, 460];
  const cells = [
    ['SKU', 'Amount', 'Rate'],
    ['A1', '$12.00', '10%'],
    ['B2', '$3.50', '5%'],
  ];
  const out: CharSpec[] = [];
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r]!.length; c++) {
      out.push(...wordChars(cells[r]![c]!, cols[c]!, rows[r]!, 11));
    }
  }
  return out;
}

/** Build a page that includes stroked rectangle grid lines (bordered table). */
export function borderedGridPage(): RawPage {
  const cols = [70, 200, 330, 460];
  const rowsY = [440, 480, 520, 560]; // bottom → top edges
  // Text baselines: top row (H*) near top band, bottom row (d*) near bottom band
  const textY = [528, 488, 448];
  const chars: CharSpec[] = [];
  const labels = [
    ['H1', 'H2', 'H3'],
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
  ];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const x = cols[c]! + 8;
      chars.push(...wordChars(labels[r]![c]!, x, textY[r]!, 11));
    }
  }

  const page = buildPage({ chars, width: 612, height: 792 });
  const commands: PathCommand[] = [];
  for (let r = 0; r < rowsY.length - 1; r++) {
    for (let c = 0; c < cols.length - 1; c++) {
      commands.push({
        op: 're',
        x: cols[c]!,
        y: rowsY[r]!,
        w: cols[c + 1]! - cols[c]!,
        h: rowsY[r + 1]! - rowsY[r]!,
      });
    }
  }

  const spatial = page.spatialIndex as PageSpatialIndex;
  const vector: RawVector = {
    id: 'vec_grid',
    type: 'vector',
    parentId: page.id,
    childIds: [],
    pageIndex: 0,
    bbox: {
      x: cols[0]!,
      y: rowsY[0]!,
      width: cols[cols.length - 1]! - cols[0]!,
      height: rowsY[rowsY.length - 1]! - rowsY[0]!,
    },
    transform: [1, 0, 0, 1, 0, 0],
    zIndex: 0,
    pathCommands: commands,
    strokeWidth: 1,
    strokeColor: { space: 'DeviceGray', values: [0] },
    fillColor: null,
    dashPattern: [],
    joinStyle: 0,
    capStyle: 0,
    opacity: 1,
    paint: 'stroke',
  };
  spatial.insert({ id: vector.id, type: 'vector', bbox: vector.bbox, zIndex: 0 });
  page.vectors = [vector];
  return page;
}

export function rawFromChars(chars: CharSpec[]) {
  return buildRawDocument([buildPage({ chars })]);
}

export function rawBordered() {
  return buildRawDocument([borderedGridPage()]);
}
