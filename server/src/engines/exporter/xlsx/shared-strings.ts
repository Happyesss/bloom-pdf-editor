/** Shared string table builder for XLSX. */

export class SharedStringTable {
  private readonly map = new Map<string, number>();
  private readonly list: string[] = [];

  index(text: string): number {
    const existing = this.map.get(text);
    if (existing !== undefined) return existing;
    const i = this.list.length;
    this.list.push(text);
    this.map.set(text, i);
    return i;
  }

  get count(): number {
    return this.list.length;
  }

  toXml(): string {
    const items = this.list
      .map((s) => {
        const space = /^\s|\s$/.test(s) || s.includes('  ') ? ' xml:space="preserve"' : '';
        return `<si><t${space}>${esc(s)}</t></si>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.list.length}" uniqueCount="${this.list.length}">
${items}
</sst>`;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
