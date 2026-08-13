# Brand assets

Four files, two jobs.

## Full lockups — hero use

- `brandeis-lockup-dark.png` (1600×295) — white wordmark, gold tagline.
- `brandeis-lockup-light.png` (1600×301) — navy wordmark, gold tagline.

Both are cropped and downscaled from the owner's 4096px transparent PNG
renders (2026-08-13). Unlike the first round of assets, these were rendered
with a real alpha channel — no black plate to key off. They are still
rasters: they do not scale past the source and cannot be recoloured, so they
are used as images, not as the mark.

**Use them large, and match the revision to the ground.** At 26px (nav
height) the outlined letterforms and the record's data grid collapse into an
illegible smear. These are hero lockups, ~120px and up.

## Marks — header use

- `mark-dark.png`, `mark-light.png` — the prism cropped out of the lockup
  renders above (everything left of the gap before the wordmark), fitted
  inside a shared **252×124** canvas and centred.

`<BrandMarkRaster>` swaps them with `<picture>` + `prefers-color-scheme`, and
`<BrandLockup>` sets the type beside them. Each render has its glow baked
into the pixels: the dark rev vanishes on the brand ground and reads as a
dirty grey plate on paper, and the light rev's navy inverts that problem.

To regenerate them from a new pair of renders, two steps are load-bearing:

**Downscale premultiplied.** Resample RGB×alpha, then unpremultiply — the
soft glow edges otherwise resample against whatever colour sits in the
transparent pixels and grow a halo. (The previous renders were worse: glow
on solid black with no alpha at all, which needed `alpha := max(r,g,b)`
keying before any of this. If a future render arrives flattened like that
again, key it at full resolution, before the downscale.)

**The canvas is shared.** The two revisions have genuinely different content
proportions (the prisms run slightly wider than 252:124, so each is fitted
by width — dark lands at 252×114 of content, light at 252×118 — and centred
vertically). Crop them tight instead and the header's layout box changes
the moment a visitor's OS flips theme. If you regenerate one, regenerate
both, onto the same canvas.

## Which asset where

Anything that needs to recolour from tokens, run at favicon size, or animate
uses `<BrandMark>` in `src/app/_components/ui.tsx` — hand-authored SVG on
brand tokens. Header chrome uses the raster, because it is the approved
artwork and one mark everywhere beats two drawings of the same idea.

To replace the rasters with a true vector, export with text converted to
outlines and shapes as paths (Illustrator: Save As → SVG, *Preserve
Illustrator Editing* off; Figma: Export → SVG with "Outline text" on). A
correct export contains `<path>` elements. A file containing
`<image ... base64>` is a bitmap in disguise — the first-round assets
arrived exactly that way.
