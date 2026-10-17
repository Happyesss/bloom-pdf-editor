import { expect, test, type Page } from "@playwright/test";
import { openInEditor, trackErrors } from "./helpers";

async function noHorizontalOverflow(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, "page scrolls sideways").toBeLessThanOrEqual(width);
}

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1440, height: 900 } },
  { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

for (const scheme of ["light", "dark"] as const) {
  for (const vp of VIEWPORTS) {
    test.describe(`${scheme} · ${vp.name}`, () => {
      test.use({ colorScheme: scheme, viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch });

      test("landing page renders cleanly", async ({ page }) => {
        const errors = trackErrors(page);
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1 })).toContainText("Edit your PDF");
        await expect(page.getByRole("img", { name: "BloomPDF" })).toBeVisible();
        await expect(page.getByTestId("upload-zone")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(scheme === "dark");
        const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
        expect(font).toMatch(/Inter/i);
        await noHorizontalOverflow(page);
        expect(errors).toEqual([]);
      });

      test("editor renders cleanly", async ({ page }) => {
        const errors = trackErrors(page);
        await openInEditor(page);
        await expect(page.getByTestId("page-indicator")).toHaveText("1 / 3");
        await noHorizontalOverflow(page);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        expect(bg).toBe(scheme === "dark" ? "rgb(7, 8, 11)" : "rgb(244, 241, 238)");
        if (vp.name === "mobile") {
          // Opens fitted to the screen width rather than at 100%.
          const box = (await page.getByTestId("page-canvas").boundingBox())!;
          expect(box.width).toBeLessThanOrEqual(vp.viewport.width);
          await expect(page.getByTitle("Show page thumbnails")).toBeVisible();
        } else {
          await expect(page.getByTestId("zoom-level")).toHaveText("100%");
          await expect(page.getByTestId("page-thumb")).toHaveCount(3);
        }
        expect(errors).toEqual([]);
      });
    });
  }
}

test("theme toggle switches and persists", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(html).toHaveClass(/dark/);
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Toggle theme" }).click();
  await expect(html).not.toHaveClass(/dark/);
});

test("rejects files that are not PDFs", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").filter({ hasText: "isn't a PDF" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test("a broken PDF shows a friendly error", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nthis is not really a pdf") });
  await page.waitForURL("**/editor");
  await expect(page.getByText("We couldn't open this PDF")).toBeVisible();
  await page.getByRole("button", { name: "Go Back" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("/editor with nothing loaded goes back home", async ({ page }) => {
  await page.goto("/editor");
  await expect(page).toHaveURL(/\/$/);
});
