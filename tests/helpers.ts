import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

export const fx = (name: string) => join(__dirname, "fixtures", name);

/** Collects console errors and uncaught exceptions for the page. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

/** Uploads a PDF on the landing page and waits for the editor to render page 1. */
export async function openInEditor(page: Page, file = fx("sample.pdf")) {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(file);
  await page.waitForURL("**/editor");
  await expect(page.getByTestId("page-canvas")).toBeVisible();
  await expect(page.locator("[data-testid=page-canvas] canvas").first()).toBeVisible();
}

export async function download(page: Page, trigger: Locator | { click: () => Promise<void> }) {
  const [dl] = await Promise.all([page.waitForEvent("download"), trigger.click()]);
  const p = await dl.path();
  const bytes = new Uint8Array(readFileSync(p!));
  const dir = join(__dirname, "..", "test-results", "outputs");
  mkdirSync(dir, { recursive: true });
  const slug = test.info().title.replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
  writeFileSync(join(dir, `${slug}__${dl.suggestedFilename()}`), bytes);
  return { name: dl.suggestedFilename(), bytes };
}

export function magic(bytes: Uint8Array) {
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK")) return "zip";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x89 && head.slice(1, 4) === "PNG") return "png";
  return "unknown";
}

export const text = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");

export async function pdfDoc(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function zipEntries(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files);
}

export async function zipText(bytes: Uint8Array, path: string) {
  const zip = await JSZip.loadAsync(bytes);
  return (await zip.file(path)?.async("string")) ?? "";
}

/** Extracts plain text from a PDF in Node, using the Bloom engine (server/dist). */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { createContainer } = await import(join(__dirname, "..", "server", "dist", "lib-entry.js"));
  const bloom = createContainer({ memoryStorage: true, configOverrides: { "telemetry.enabled": false } });
  bloom.startWorkers();
  try {
    const job = await bloom.documentEngine.enqueueConversion({ filename: "t.pdf", target: "txt", options: {} }, bytes);
    for (let i = 0; i < 400; i++) {
      const j = await bloom.documentEngine.getJob(job.id);
      if (j.state === "Completed") break;
      if (j.state === "Failed") throw new Error(j.error);
      await new Promise((r) => setTimeout(r, 25));
    }
    const out = await bloom.documentEngine.getDownload(job.id);
    return Buffer.from(out!.bytes).toString("utf8");
  } finally {
    await bloom.stop();
  }
}

/** Number of annotations of a given /Subtype across all pages. */
export async function annotCount(bytes: Uint8Array, subtype?: string) {
  const { PDFName, PDFArray, PDFDict } = await import("pdf-lib");
  const doc = await pdfDoc(bytes);
  let n = 0;
  for (const p of doc.getPages()) {
    const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i, PDFDict);
      const st = a.get(PDFName.of("Subtype"))?.toString();
      if (!subtype || st === `/${subtype}`) n++;
    }
  }
  return n;
}

/** Image XObjects drawn on a page (counts names in /Resources /XObject with /Subtype /Image). */
export async function pageImages(bytes: Uint8Array, pageIndex = 0) {
  const { PDFName, PDFDict, PDFStream } = await import("pdf-lib");
  const doc = await pdfDoc(bytes);
  const res = doc.getPage(pageIndex).node.Resources();
  const xobjs = res?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const out: { name: string; smask: boolean }[] = [];
  if (!xobjs) return out;
  for (const [k, v] of xobjs.entries()) {
    const s = doc.context.lookup(v);
    if (s instanceof PDFStream && s.dict.get(PDFName.of("Subtype"))?.toString() === "/Image") {
      out.push({ name: k.toString(), smask: !!s.dict.get(PDFName.of("SMask")) });
    }
  }
  return out;
}

/** Converts a point in PDF user space (origin bottom-left, 100% zoom) to page coordinates. */
export async function pdfPoint(page: Page, x: number, y: number, pageHeight = 841.89) {
  const box = (await page.getByTestId("page-canvas").boundingBox())!;
  const scale = box.height / pageHeight;
  return { x: box.x + x * scale, y: box.y + (pageHeight - y) * scale };
}

/** Clicks a tool in the left tool rail (desktop) or bottom strip (mobile). */
export async function pickTool(page: Page, id: string) {
  await page.locator(`button[data-tool="${id}"]`).first().click();
  await expect(page.locator(`button[data-tool="${id}"]`).first()).toHaveAttribute("aria-pressed", "true");
}

/** Download the edited PDF with the main Download button. */
export async function downloadPdf(page: Page) {
  const dl = await download(page, page.getByTitle("Download original / edited PDF (no recompression)"));
  expect(magic(dl.bytes)).toBe("pdf");
  return dl;
}

/** Opens the editor, clicks a text line and replaces its content. */
export async function editLine(page: Page, at: { x: number; y: number }, newText: string) {
  await page.mouse.click(at.x, at.y);
  const ta = page.getByLabel("Edit line");
  await expect(ta).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(newText);
  await page.keyboard.press("Enter");
  await expect(ta).toHaveCount(0);
}

/** Opens a PDF with pdf.js — an independent reader — and returns page count + first-page text. */
export async function openWithPdfJs(bytes: Uint8Array, password?: string) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0 }).promise;
  const content = await (await doc.getPage(1)).getTextContent();
  const text = content.items.map((i) => ("str" in i ? i.str : "")).join(" ");
  return { pages: doc.numPages, text };
}

/** Decoded content stream(s) of a page, as text. */
export async function pageContent(bytes: Uint8Array, pageIndex = 0) {
  const { PDFArray, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const doc = await pdfDoc(bytes);
  const node = doc.getPage(pageIndex).node;
  const contents = node.Contents();
  const streams = contents instanceof PDFArray
    ? Array.from({ length: contents.size() }, (_, i) => contents.lookup(i))
    : [contents];
  return streams
    .map((s) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : ""))
    .join("\n");
}
