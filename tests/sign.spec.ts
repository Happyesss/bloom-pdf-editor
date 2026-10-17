import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { download, downloadPdf, fx, openInEditor, pageImages, pdfDoc, pickTool, trackErrors } from "./helpers";

async function createTypedSignature(page: Page, name = "Asha Gardener") {
  await page.getByRole("button", { name: "Create signature" }).click();
  const dialog = page.getByRole("dialog", { name: "Create signature" });
  await dialog.getByRole("tab", { name: "Type" }).or(dialog.getByRole("button", { name: "Type", exact: true })).first().click();
  await dialog.getByPlaceholder("Type your name").fill(name);
  await dialog.getByRole("button", { name: "Save to library" }).click();
  await expect(dialog).toBeHidden();
}

test("create a typed signature, place it on the page and download it", async ({ page }) => {
  const errors = trackErrors(page);
  await openInEditor(page);
  await pickTool(page, "sign");
  await createTypedSignature(page);
  const card = page.getByTestId("options-panel").locator("[draggable=true]").first();
  await expect(card).toBeVisible();
  await card.dragTo(page.getByTestId("page-canvas"), { targetPosition: { x: 400, y: 760 } });
  await expect(page.getByTestId("page-canvas").getByRole("img", { name: "Signature" })).toHaveCount(1);

  const { bytes } = await downloadPdf(page);
  const images = await pageImages(bytes, 0);
  // The photo plus the signature, which keeps its transparency.
  expect(images).toHaveLength(2);
  expect(images.some((i) => i.smask)).toBe(true);
  expect(errors).toEqual([]);
});

test("draw a signature", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "sign");
  await page.getByRole("button", { name: "Create signature" }).click();
  const dialog = page.getByRole("dialog", { name: "Create signature" });
  const pad = dialog.locator("canvas").first();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 120);
  await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(box.x + 40 + i * 18, box.y + 120 - Math.sin(i / 2) * 40);
  await page.mouse.up();
  await dialog.getByRole("button", { name: "Save to library" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("options-panel").locator("[draggable=true] img")).toHaveCount(1);
});

test("digitally sign with an imported certificate and validate it", async ({ page }) => {
  await openInEditor(page);
  await pickTool(page, "sign");
  await page.getByRole("button", { name: "Import / manage certificates" }).click();
  const dialog = page.getByRole("dialog", { name: "Certificates" });
  await dialog.getByLabel("Paste PEM").fill(readFileSync(fx("signer.pem"), "utf8"));
  await dialog.getByRole("button", { name: "Import PEM" }).click();
  await expect(dialog.getByText(/Ready to sign|private key/i).first()).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Ready to sign")).toBeVisible();

  await page.getByRole("button", { name: "Digitally sign document" }).click();
  await expect(page.getByRole("button", { name: "Digitally sign document" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByTestId("error-toast")).toHaveCount(0);
  await page.getByRole("button", { name: "Validate all signatures" }).click();
  await expect(page.getByTestId("validation-status")).toHaveText("Valid");

  // The downloaded file must keep a valid signature.
  const { bytes } = await download(page, page.getByTitle("Download original / edited PDF (no recompression)"));
  expect(Buffer.from(bytes).toString("latin1")).toContain("/ByteRange");
  // Other readers can find the signature field too.
  const fields = (await pdfDoc(bytes)).getForm().getFields();
  expect(fields.map((f) => f.constructor.name)).toContain("PDFSignature");
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({ name: "signed.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
  await page.waitForURL("**/editor");
  await pickTool(page, "sign");
  await page.getByRole("button", { name: "Validate all signatures" }).click();
  await expect(page.getByTestId("validation-status")).toHaveText("Valid");
});
