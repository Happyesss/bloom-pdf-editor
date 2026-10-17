import { expect, test } from "@playwright/test";
import { downloadPdf, fx, openInEditor, pdfPoint, pdfText, pickTool, trackErrors } from "./helpers";

test.beforeEach(async ({ page }) => {
  page.on("dialog", (d) => d.accept());
});

const imageCount = (text: string) => (text.match(/\[Image/g) ?? []).length;

test("add an image to the page", async ({ page }) => {
  const errors = trackErrors(page);
  await openInEditor(page);
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(fx("small.png"));
  await expect(page.locator('img[alt="floating"]')).toBeVisible();
  const { bytes } = await downloadPdf(page);
  expect(imageCount(await pdfText(bytes))).toBe(2);
  expect(errors).toEqual([]);
});

test("delete an embedded image, then restore it from the bin", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "select");
  const img = await pdfPoint(page, 250, 450);
  await page.mouse.click(img.x, img.y);
  await expect(page.getByText("Image Properties")).toBeVisible();
  await page.getByRole("button", { name: "Delete (Save to Bin)" }).click();

  let { bytes } = await downloadPdf(page);
  expect(imageCount(await pdfText(bytes))).toBe(0);

  await expect(page.getByText("Removed Images")).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(page.locator('img[alt="floating"]')).toBeVisible();
  ({ bytes } = await downloadPdf(page));
  expect(imageCount(await pdfText(bytes))).toBe(1);
});

test("move an embedded image and undo it", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "select");
  const img = await pdfPoint(page, 250, 450);
  await page.mouse.click(img.x, img.y);
  const frame = page.locator(".border-\\[\\#3b82f6\\]").first();
  await expect(frame).toBeVisible();
  const before = (await frame.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  const { bytes } = await downloadPdf(page);
  expect(imageCount(await pdfText(bytes))).toBe(1);
});
