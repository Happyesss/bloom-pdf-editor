import { expect, test, type Page } from "@playwright/test";
import { annotCount, downloadPdf, openInEditor, pdfPoint, pickTool, trackErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => d.accept());
});

async function drag(page: Page, from: [number, number], to: [number, number], steps = 12) {
  const a = await pdfPoint(page, ...from);
  const b = await pdfPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

test("draw freehand, line, arrow, rectangle and ellipse", async ({ page }) => {
  const errors = trackErrors(page);
  await openInEditor(page);
  await pickTool(page, "draw");
  await drag(page, [80, 250], [200, 220]);
  for (const [shape, y] of [["Line", 200], ["Arrow", 180], ["Rectangle", 160], ["Ellipse", 140]] as const) {
    await page.getByTitle(shape, { exact: true }).click();
    await drag(page, [300, y], [450, y - 15]);
  }
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
  const { bytes } = await downloadPdf(page);
  expect(await annotCount(bytes, "Ink")).toBe(1);
  expect(await annotCount(bytes, "Line")).toBe(2);
  expect(await annotCount(bytes, "Square")).toBe(1);
  expect(await annotCount(bytes, "Circle")).toBe(1);
  expect(errors).toEqual([]);
});

test("downloading twice does not duplicate annotations", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "draw");
  await drag(page, [80, 250], [200, 220]);
  await downloadPdf(page);
  const { bytes } = await downloadPdf(page);
  expect(await annotCount(bytes, "Ink")).toBe(1);
});

test("erase a stroke and clear the page", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "draw");
  await drag(page, [80, 250], [240, 250], 20);
  await drag(page, [80, 200], [240, 200], 20);
  await pickTool(page, "erase");
  await drag(page, [60, 250], [260, 250], 30);
  let { bytes } = await downloadPdf(page);
  expect(await annotCount(bytes, "Ink")).toBe(1);

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  ({ bytes } = await downloadPdf(page));
  expect(await annotCount(bytes)).toBe(0);
});

test("freehand highlight stroke becomes a translucent ink annotation", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "highlight");
  await drag(page, [60, 700], [400, 700], 20);
  const { bytes } = await downloadPdf(page);
  expect(await annotCount(bytes, "Ink")).toBe(1);
});

test("tool shortcuts switch tools", async ({ page }) => {
  await openInEditor(page);
  const status = page.locator("footer").last();
  for (const [key, label] of [["d", "DRAW"], ["h", "HIGHLIGHT"], ["e", "ERASE"], ["w", "WATERMARK"], ["s", "SIGN"], ["v", "SELECT"], ["t", "EDIT TEXT"]]) {
    await page.keyboard.press(key);
    await expect(status).toContainText(`TOOL: ${label}`);
  }
});
