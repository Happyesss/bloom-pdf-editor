// Generates sample input files for the editor end-to-end tests (tests/fixtures).
// Run: npm run fixtures
// tests/fixtures/encrypted.pdf (AES-256, password "bloom123") is checked in — it
// comes from bloompdf/tests/fixtures because pdf-lib cannot encrypt.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests", "fixtures");
mkdirSync(out, { recursive: true });
const save = (name, data) => {
  writeFileSync(join(out, name), data);
  console.log("  ✓", name, `${Math.round((data.length ?? data.byteLength) / 1024)} KB`);
};

// ── PNG encoder (RGB, no filtering) ─────────────────────────────────────────
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const photo = png(480, 320, (x, y) => {
  const sun = Math.hypot(x - 340, y - 100) < 50 ? 60 : 0;
  return [Math.min(255, 232 - y * 0.2 + sun), Math.min(255, 140 + x * 0.15 + sun), Math.min(255, 160 + (y - x) * 0.1)].map((v) => Math.max(0, Math.round(v)));
});
const small = png(160, 100, (x, y) => [232, 96 + ((x * y) % 80), 122]);
save("small.png", small);

// ── Multi-page PDF with text, a table and an image ──────────────────────────
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const img = await doc.embedPng(photo);
  doc.setTitle("BloomPDF Editor Test");

  let p = doc.addPage([595.28, 841.89]);
  p.drawText("Quarterly Garden Report", { x: 60, y: 770, size: 26, font: bold, color: rgb(0.1, 0.1, 0.1) });
  const para = "Bloom is a privacy-first PDF editor. Every edit runs inside the browser, so files never leave the device. This paragraph spans several lines so that conversion tools can rebuild flowing text from the page layout.";
  let y = 730;
  let line = "";
  for (const w of para.split(" ")) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, 12) > 470) { p.drawText(line, { x: 60, y, size: 12, font }); y -= 17; line = w; } else line = t;
  }
  p.drawText(line, { x: 60, y, size: 12, font });
  p.drawText("Contact: hello@bloompdf.app", { x: 60, y: y - 30, size: 12, font });
  p.drawImage(img, { x: 60, y: 300, width: 420, height: 280 });
  p.drawText("Figure 1: Sunset over the tulip field", { x: 60, y: 282, size: 10, font, color: rgb(0.4, 0.4, 0.4) });

  p = doc.addPage([595.28, 841.89]);
  p.drawText("Sales by Region", { x: 60, y: 770, size: 20, font: bold });
  const rows = [["Region", "Q1", "Q2", "Growth"], ["North", "1,200.50", "1,450.00", "20.8%"], ["South", "980.00", "1,010.25", "3.1%"], ["East", "2,340.75", "2,100.00", "-10.3%"]];
  rows.forEach((r, i) => r.forEach((c, j) => p.drawText(c, { x: 60 + j * 120, y: 720 - i * 24, size: 12, font: i === 0 ? bold : font })));
  p.drawText("Totals are unaudited.", { x: 60, y: 600, size: 11, font });

  p = doc.addPage([595.28, 841.89]);
  p.drawText("Appendix", { x: 60, y: 770, size: 20, font: bold });
  p.drawText("The third page gives page tools room to work.", { x: 60, y: 740, size: 11, font });
  save("sample.pdf", await doc.save());
}

// ── Fillable form ───────────────────────────────────────────────────────────
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  const form = doc.getForm();
  page.drawText("Membership Application", { x: 60, y: 770, size: 20, font });
  page.drawText("Full name", { x: 60, y: 715, size: 11, font });
  form.createTextField("full_name").addToPage(page, { x: 160, y: 705, width: 300, height: 24 });
  page.drawText("Email", { x: 60, y: 675, size: 11, font });
  form.createTextField("email").addToPage(page, { x: 160, y: 665, width: 300, height: 24 });
  page.drawText("Subscribe", { x: 60, y: 635, size: 11, font });
  form.createCheckBox("subscribe").addToPage(page, { x: 160, y: 628, width: 18, height: 18 });
  save("form.pdf", await doc.save());
}
