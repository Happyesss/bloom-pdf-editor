import type { ExportResult, IExportManager } from '../common/interfaces.js';
import type { UnifiedDocumentModel } from '../udm/types.js';
import type { ConvertTarget } from '../../jobs/types.js';
import { DocxExporter } from './docx/docx-exporter.js';
import { EpubExporter } from './epub/epub-exporter.js';
import { HtmlExporter } from './html/html-exporter.js';
import { JsonExporter } from './json/json-exporter.js';
import { MarkdownExporter } from './markdown/markdown-exporter.js';
import { OdtExporter } from './odt/odt-exporter.js';
import { asPlugin, type IExportPlugin } from './plugin.js';
import { PptxExporter } from './pptx/pptx-exporter.js';
import { RtfExporter } from './rtf/rtf-exporter.js';
import { SvgExporter } from './svg/svg-exporter.js';
import { TxtExporter } from './txt/txt-exporter.js';
import { XmlExporter } from './xml/xml-exporter.js';
import { XlsxExporter } from './xlsx/xlsx-exporter.js';

/**
 * Export registry — exporters depend only on UDM (zero parser knowledge).
 * Phase 14 plugin SDK: registerPlugin / third-party formats.
 */
export class ExportManager implements IExportManager {
  readonly name = 'ExportManager' as const;

  private readonly exporters = new Map<
    ConvertTarget,
    (udm: UnifiedDocumentModel) => Promise<ExportResult>
  >();
  private readonly plugins = new Map<ConvertTarget, IExportPlugin>();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      this.registerDefaults();
    }
  }

  private registerDefaults(): void {
    const docx = new DocxExporter();
    const xlsx = new XlsxExporter();
    const pptx = new PptxExporter();
    const html = new HtmlExporter();
    const markdown = new MarkdownExporter();
    const epub = new EpubExporter();
    const rtf = new RtfExporter();
    const odt = new OdtExporter();
    const txt = new TxtExporter();
    const json = new JsonExporter();
    const xml = new XmlExporter();
    const svg = new SvgExporter();

    this.registerPlugin(asPlugin('docx', docx.name, (u) => docx.export(u), isZip));
    this.registerPlugin(asPlugin('xlsx', xlsx.name, (u) => xlsx.export(u), isZip));
    this.registerPlugin(asPlugin('pptx', pptx.name, (u) => pptx.export(u), isZip));
    this.registerPlugin(asPlugin('html', html.name, (u) => html.export(u)));
    this.registerPlugin(asPlugin('markdown', markdown.name, (u) => markdown.export(u)));
    this.registerPlugin(asPlugin('epub', epub.name, (u) => epub.export(u), isZip));
    this.registerPlugin(asPlugin('rtf', rtf.name, (u) => rtf.export(u)));
    this.registerPlugin(asPlugin('odt', odt.name, (u) => odt.export(u), isZip));
    this.registerPlugin(asPlugin('txt', txt.name, (u) => txt.export(u)));
    this.registerPlugin(asPlugin('json', json.name, (u) => json.export(u)));
    this.registerPlugin(asPlugin('xml', xml.name, (u) => xml.export(u)));
    this.registerPlugin(asPlugin('svg', svg.name, (u) => svg.export(u)));
  }

  supportedTargets(): ConvertTarget[] {
    return [...this.exporters.keys()];
  }

  listPlugins(): IExportPlugin[] {
    return [...this.plugins.values()];
  }

  register(
    target: ConvertTarget,
    exporter: (udm: UnifiedDocumentModel) => Promise<ExportResult>,
  ): void {
    this.exporters.set(target, exporter);
  }

  /** Phase 14 plugin SDK entry point. */
  registerPlugin(plugin: IExportPlugin): void {
    this.plugins.set(plugin.target, plugin);
    this.register(plugin.target, async (udm) => {
      await plugin.initialize?.(udm);
      try {
        const result = await plugin.export(udm);
        if (plugin.validate && !plugin.validate(result.bytes)) {
          throw new Error(`Export validation failed for ${plugin.target}`);
        }
        return result;
      } finally {
        plugin.cleanup?.();
      }
    });
  }

  async export(udm: UnifiedDocumentModel, target: ConvertTarget): Promise<ExportResult> {
    const exporter = this.exporters.get(target);
    if (!exporter) {
      throw new Error(`No exporter registered for target "${target}".`);
    }
    return exporter(udm);
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
