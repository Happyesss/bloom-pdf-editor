import { expect, test } from "@playwright/test";
import { downloadPdf, fx, openInEditor, pageImages, pdfText, pickTool, trackErrors } from "./helpers";

test("apply a text watermark to every page, then scan and remove it", async ({ page }) => {
  const errors = trackErrors(page);
  await openInEditor(page);
  await pickTool(page, "watermark");
  await page.getByLabel("Watermark text").fill("CONFIDENTIAL");
  const preview = page.getByRole("switch", { name: "Live preview" });
  await expect(preview).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("page-canvas").getByText("CONFIDENTIAL").first()).toBeVisible();
  await preview.click();
  await expect(page.getByTestId("page-canvas").getByText("CONFIDENTIAL")).toHaveCount(0);
  await page.getByRole("button", { name: "Add watermark" }).click();
  await expect(page.getByRole("dialog", { name: "Watermark applied" })).toBeVisible();
  await page.getByRole("button", { name: "Okay" }).click();

  let { bytes } = await downloadPdf(page);
  expect((await pdfText(bytes)).match(/CONFIDENTIAL/g)?.length).toBe(3);

  await page.getByRole("button", { name: "Scan for Watermarks" }).click();
  await page.getByRole("button", { name: "Remove Selected" }).click();
  await page.getByRole("button", { name: "Yes, Remove" }).click();
  ({ bytes } = await downloadPdf(page));
  expect((await pdfText(bytes)).match(/CONFIDENTIAL/g)?.length ?? 0).toBeLessThan(3);
  expect(errors).toEqual([]);
});

test("apply an image watermark", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "watermark");
  await page.getByRole("button", { name: "Image", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "ADD IMAGE" }).click();
  await (await chooser).setFiles(fx("small.png"));
  await expect(page.getByText("Loaded: small.png")).toBeVisible();
  await page.getByRole("button", { name: "Add watermark" }).click();
  await page.getByRole("button", { name: "Okay" }).click();
  const { bytes } = await downloadPdf(page);
  // Page 3 had no images before.
  expect((await pageImages(bytes, 2)).length).toBeGreaterThan(0);
});
