# Brand assets

Four files, two jobs.

## Full lockups — hero use

- `brandeis-lockup-dark.png` (1300×445) — white wordmark, gold tagline.
- `brandeis-lockup-light.png` (1400×296) — navy wordmark, gold tagline.
  Cropped from a 3072×2048 export that was mostly transparent padding.

Both were supplied as `.svg` files that are **rasters in disguise**: a single
`<image>` element holding a base64 PNG, zero `<path>` data. They do not scale
and cannot be recoloured, so they are used as images, not as the mark.

**Use them large, and match the revision to the ground.** At 26px (nav
height) the outlined letterforms and the record's data grid collapse into an
illegible smear. These are hero lockups, ~120px and up.

## Marks — header use

- `mark-dark.png`, `mark-light.png` — the prism cropped out of the lockups
  above, downscaled to 124px of content on a shared **252×124** canvas.

`<BrandMarkRaster>` swaps them with `<picture>` + `prefers-color-scheme`, and
`<BrandLockup>` sets the type beside them. Each render has its glow baked
into the pixels: the dark rev vanishes on the brand ground and reads as a
dirty grey plate on paper, and the light rev's navy inverts that problem.

To regenerate them from a new pair of renders, two steps are load-bearing:

**The dark revision is keyed off black.** It was rendered as glow on solid
black and the black survived the crop — 43% of every pixel the file drew was
near-opaque black, which painted a visible plate around the mark on the nav's
near-black ground. The artwork is additive light, so luminance is coverage:
`alpha := max(r,g,b)`, colour unpremultiplied back off black. Key at full
resolution, before the downscale, or the edges resample against a halo.

**The canvas is shared.** The two revisions have genuinely different content
widths (the light rev draws more of the incoming beam), so the narrower is
centred with transparent padding. Crop them tight instead and the header's
layout box changes width the moment a visitor's OS flips theme. If you
regenerate one, regenerate both, onto the same canvas.

## Which asset where

Anything that needs to recolour from tokens, run at favicon size, or animate
uses `<BrandMark>` in `src/app/_components/ui.tsx` — hand-authored SVG on
brand tokens. Header chrome uses the raster, because it is the approved
artwork and one mark everywhere beats two drawings of the same idea.

To replace the rasters with a true vector, export with text converted to
outlines and shapes as paths (Illustrator: Save As → SVG, *Preserve
Illustrator Editing* off; Figma: Export → SVG with "Outline text" on). A
correct export contains `<path>` elements. A file containing
`<image ... base64>` is a bitmap in disguise, like all of these.
