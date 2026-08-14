# Brand assets

Four files, two jobs.

## Full lockups — hero use

- `brandeis-lockup-dark.png` (1600×248) — white wordmark, gold tagline.
  **Rev 2026-08-13b**, cropped/downscaled from the owner's 2000×731
  transparent render supplied in-session: gold data-dashes streaming into a
  document sheet (the old prism-triangle drawing is retired). ⚠ The render's
  tagline carries stray accents ("FÓR", "RECÓRDS") — flagged to the owner at
  handoff; replace this file from a corrected render when one exists.
- `brandeis-lockup-light.png` (1600×301) — navy wordmark, gold tagline.
  **PREVIOUS drawing, currently UNREFERENCED by code** (the nav is pinned
  dark, so every lockup placement renders the dark rev). Kept only so a
  future light-ground placement fails loudly to the old art rather than
  silently to nothing; regenerate it from a light-ground render of the NEW
  drawing before using it anywhere.

They are rasters: they do not scale past the source and cannot be
recoloured, so they are used as images, not as the mark.

**Owner directive 2026-08-13: these renders ARE the logo, everywhere.** No
re-typeset wordmark, no vector redraw. `<BrandLockup>` renders the full
lockup image; the nav sizes it at 1.6×`--lockup` (≈58px tall at desktop nav
size), which was verified legible in both themes — below roughly 40px of
image height the letterforms do start to smear, which is why the ≤640px nav
collapses to the mark crop instead of shrinking the lockup further.
Match the revision to the ground: theme-swap on grounds that follow the
visitor, pin the dark revision on grounds that are dark in both themes
(marketing footer).

## Marks — header use

- `mark-dark.png`, `mark-light.png` — the mark (data-dashes + document
  sheet) cropped out of the 2026-08-13b lockup render (everything left of
  the gap before the wordmark), fitted inside a shared **252×124** canvas
  and centred. The new drawing is ALL GOLD with no ground-specific ink, so
  both files currently carry the SAME image — kept as two files because
  `<BrandMarkRaster>`'s `<picture>` swap references both, and a future
  render pair may diverge again.

`<BrandMarkRaster>` swaps them with `<picture>` + `prefers-color-scheme`, and
`<BrandLockup>` sets the type beside them.

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

The rasters, everywhere (owner directive 2026-08-13): `<BrandLockup>` for
the full lockup, `<BrandMarkRaster>` for the mark alone. The hand-authored
`<BrandMark>` SVG was REMOVED with that directive — do not redraw the mark
in code. With the 2026-08-13b render the last hand-drawn derivative
(`src/app/icon.svg`, the old prism) was replaced by `src/app/icon.png` —
a 64px crop of the render's document glyph, so even the favicon is the
owner's pixels now. `apple-icon.png` (mark on the board's plum) and
`opengraph-image.png` (lockup on dark paper) are composed from the same
render; `favicon.ico` is still the OLD drawing (ico needs a tool sharp
doesn't have) — regenerate it when convenient.

To replace the rasters with a true vector, export with text converted to
outlines and shapes as paths (Illustrator: Save As → SVG, *Preserve
Illustrator Editing* off; Figma: Export → SVG with "Outline text" on). A
correct export contains `<path>` elements. A file containing
`<image ... base64>` is a bitmap in disguise — the first-round assets
arrived exactly that way.
