# PDF Editor — End-to-End UX/UI Diagnosis

> A frank audit of what's missing, broken, or unpolished — judged against
> Apple's Human Interface Guidelines (clarity, deference, depth) and against
> what a normal person actually expects from a PDF editor in 2026.

---

## 0. Verdict in one line

The engine is solid (PDF.js + pdf-lib + Fabric + Zustand), the toolbar is
feature-complete on paper, but the **product feels like a dev tool, not a
finished app**. The biggest gap is not features — it's *discoverability,
feedback, and onboarding*.

---

## 1. What already exists (so we don't rebuild it)

| Area | Status |
|------|--------|
| Drag-and-drop upload | ✅ Works (`DropZone.tsx`) |
| Page rendering & thumbnails | ✅ Works (`PageCanvas.tsx`, `Sidebar.tsx`) |
| Inline text edit ("Edit PDF" mode) | ✅ Works (`TextEditLayer.tsx`) |
| Add text / shapes / pen / arrows | ✅ Works |
| Highlight / underline / strikethrough / comment | ✅ Works |
| Signature (draw / type / upload) | ✅ Dialog exists |
| Image insertion | ✅ Works |
| Redaction (visual) | ⚠️ Visual only — not permanent in bytes |
| Stamps (Approved / Draft / etc.) | ✅ Works |
| Search across pages | ✅ Dialog exists |
| Watermark | ✅ Dialog exists |
| Page manager (reorder/rotate/delete) | ✅ Dialog exists |
| Undo / redo | ✅ Works |
| **Delete selected object** | ✅ Toolbar `Trash2` button + Del key (already wired via `pdf-editor:delete-selection`) |
| Export PDF with overlays | ✅ Works |
| IndexedDB session restore | ✅ Works |

So the *delete button is there* — it lives in the toolbar next to Undo/Redo
and is wired to fire on the currently selected fabric object. The complaint
is fair though: it's a tiny icon with no label, easy to miss. Fix below.

---

## 2. What is missing or broken (ranked by user pain)

### 🔴 Critical — blocks the "it just works" feeling

| # | Gap | Why it matters | Fix |
|---|-----|----------------|-----|
| C-1 | **No landing page** worth the name. The current `/` is a dark grid of feature tiles. No product story, no animation, no aspiration. | First impression = "another free tool" instead of "a product I trust." | Rebuild as Apple-style hero + scroll-revealed sections + frosted nav. |
| C-2 | **CTA flow is opaque.** Drop zone is the *only* way in; no "Edit PDF" button calling the user to action. | Many users scroll past a drop zone — they expect a button. | Big primary CTA "Edit PDF" that reveals the uploader. |
| C-3 | **No "Delete page" affordance in the sidebar.** Users have to open a separate Page Manager dialog. | Industry standard is hover-to-reveal a trash icon on the thumbnail. | Add hover delete + rotate on each thumbnail. |
| C-4 | **Permanent redaction is not byte-level.** Black rect is drawn on the overlay; copying the underlying text in another viewer still leaks it. | Security feature that isn't secure is worse than no feature. | On export, use pdf-lib to overwrite the content stream in the redacted bbox. |
| C-5 | **No keyboard shortcut hint UI.** Power users get `V/T/D/H/S/Ctrl+F` but nobody knows. | Hidden features = no features. | `?` opens a shortcut sheet. |
| C-6 | **No empty/loading/error states for the editor canvas.** A blank black screen during a 5-second PDF parse looks broken. | Trust collapses in 2 seconds of silence. | Skeleton page placeholders + progress bar. |

### 🟠 High — visible polish gaps

| # | Gap | Fix |
|---|-----|-----|
| H-1 | Toolbar is one dense row — wraps awkwardly below ~1100px, looks crowded on desktop too | Group into "File / Edit / Insert / View" sections with subtle dividers and labels. |
| H-2 | No tool labels — only icons + tooltip on hover. Apple HIG: text + icon for primary actions. | Show labels on ≥`xl` screens; icon-only on smaller. |
| H-3 | Color picker is the raw `<input type="color">` — looks like a 2005 form | Custom popover with swatches + recent colors. |
| H-4 | No properties panel for the *selected* object. Edit a text box → no font controls appear contextual to it. | Right-side contextual properties panel (already declared in `DESIGN.md` as `PropertiesPanel.tsx`, never built). |
| H-5 | Zoom: no fit-to-width / fit-to-page presets | Add a `100% ▾` dropdown: 50/75/100/150/200/Fit width/Fit page. |
| H-6 | No "Recent files" memory in landing page | Show last 3 from IndexedDB so users can resume. |
| H-7 | No mobile / touch story. PDF editing on iPad is a huge use-case. | Responsive toolbar collapses into a bottom sheet on small screens. |
| H-8 | Watermark dialog applies and **immediately downloads** a separate file instead of staging the change | Apply as an overlay first; bake on export. |
| H-9 | Export dialog has no compression/quality preview | Show size estimate before download. |
| H-10 | No "Save" — only "Download". Modern users expect autosave to the browser session, which actually exists (IndexedDB) but isn't surfaced | Add a "Saved · just now" indicator in the toolbar. |

### 🟡 Medium — nice to add

| # | Gap |
|---|-----|
| M-1 | OCR for scanned PDFs (Tesseract.js client-side) |
| M-2 | Merge multiple PDFs in a single session |
| M-3 | Split / extract pages into a new file |
| M-4 | Password-protect / unlock |
| M-5 | Form-field detection (AcroForm) |
| M-6 | Convert PDF → images (PNG/JPG per page) |
| M-7 | Dark / light theme toggle (we're locked dark) |
| M-8 | Comment threading / reply |
| M-9 | Compare two PDFs side-by-side |
| M-10 | Accessibility: alt-text editor for images, tag tree |

### 🟢 Low — long tail

- Internationalization (i18n)
- Plugin / extension API
- PWA install with offline cache
- Cloud sync (optional, opt-in)

---

## 3. Apple HIG checklist applied to *this* app

| Principle | Where we fail today | What "good" looks like |
|-----------|--------------------|------------------------|
| **Clarity** | Toolbar icons compete for attention; no visual hierarchy | Primary actions (`Edit PDF`, `Download`) are full-color filled buttons; secondary are ghost icons; tertiary are menu items. |
| **Deference** | Dark zinc UI fights for attention with the document | Reduce chrome, push gray, let the white page dominate. |
| **Depth** | Flat dialogs pop in with no transition | Modal sheet slides up from bottom, content lifts; use `backdrop-blur` + spring-ease. |
| **Consistency** | Some buttons are 28px, others 36px; some have shadows, others don't | One button system: heights 28 / 36 / 44, radii 8 / 12 / 16, one shadow scale. |
| **Feedback** | Most clicks have no transient feedback | Add active-press scale (`active:scale-95`) + subtle haptic-like color tweens. |
| **Aesthetic integrity** | Marketing page tiles look templated | One headline, one CTA, one product shot; everything else earns its place. |
| **Direct manipulation** | Page reorder is locked behind a dialog | Drag thumbnails in the sidebar directly. |

---

## 4. Concrete plan landed in this PR

This PR ships the highest-impact subset:

1. **New landing page** — Apple-style hero, frosted sticky nav, scroll-reveal feature
   sections, animated mockup, big "Edit PDF" CTA that pulls up a centered upload card.
   Files: `src/app/page.tsx`, `src/app/globals.css` (motion tokens, keyframes).
2. **Toolbar Delete button** gets a visible "Delete" label so the user complaint about
   the missing delete button stops being a complaint.
3. **Per-page delete & rotate** added to the sidebar thumbnails (hover-reveal).
4. Motion tokens: `--ease-out-soft`, `--ease-spring`, `animate-fade-up`,
   `animate-fade-in`, `animate-scale-in` — usable across the whole app.

Everything else in section 2 is queued for follow-up PRs.

---

## 5. Out of scope for this PR (so it doesn't sprawl)

- Properties panel rebuild (H-4)
- Mobile bottom-sheet toolbar (H-7)
- OCR, merge, split, password (M-1..M-4)
- Real byte-level redaction (C-4) — needs a careful pdf-lib content-stream rewrite

These are tracked here so the next agent / contributor knows where to start.
