import { expect, test } from "@playwright/test";
import { downloadPdf, fx, openInEditor, pdfDoc } from "./helpers";

test("fill a text field and tick a checkbox", async ({ page }) => {
  await openInEditor(page, fx("form.pdf"));
  const panel = page.getByTestId("options-panel");
  await expect(panel.getByText("Form Fields (3)")).toBeVisible();
  await panel.getByRole("button", { name: /full_name/ }).click();
  await panel.getByLabel("Field value").fill("Asha Gardener");
  await panel.getByRole("button", { name: /subscribe/ }).click();
  await panel.getByRole("button", { name: "Unchecked — click to check" }).click();
  await expect(panel.getByRole("button", { name: "Checked — click to uncheck" })).toBeVisible();

  const { bytes } = await downloadPdf(page);
  const form = (await pdfDoc(bytes)).getForm();
  expect(form.getTextField("full_name").getText()).toBe("Asha Gardener");
  expect(form.getCheckBox("subscribe").isChecked()).toBe(true);
});

test("flatten form fields", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await openInEditor(page, fx("form.pdf"));
  const panel = page.getByTestId("options-panel");
  await panel.getByRole("button", { name: /full_name/ }).click();
  await panel.getByLabel("Field value").fill("Flat Value");
  await panel.getByRole("button", { name: "Flatten All" }).click();
  await expect(panel.getByText("No AcroForm fields on this page.", { exact: false })).toBeVisible();
  const { bytes } = await downloadPdf(page);
  expect((await pdfDoc(bytes)).getForm().getFields()).toHaveLength(0);
});
