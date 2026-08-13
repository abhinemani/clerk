# Brand assets

Two revisions of the owner's approved full lockup, one per theme:

- `brandeis-lockup-dark.png` (1300×445) — white wordmark, gold tagline.
- `brandeis-lockup-light.png` (1400×296) — navy wordmark, gold tagline.
  Cropped from a 3072×2048 export that was mostly transparent padding.

Both were supplied as `.svg` files that are **rasters in disguise**: a single
`<image>` element holding a base64 PNG, zero `<path>` data. They do not scale
and cannot be recoloured, so they are used as images, not as the mark.

**Use them large, and match the revision to the ground.** Two things were
measured:

- At 26px (nav height) the outlined letterforms and the record's data grid
  collapse into an illegible smear. These are hero lockups, ~120px and up.
- Each render has its glow baked into the pixels. The dark rev vanishes on
  the brand ground and reads as a dirty grey plate on paper; the light rev's
  navy wordmark inverts the problem. `<picture>` + `prefers-color-scheme`
  picks the right one.

Everything smaller uses `<BrandMark>` / `<BrandLockup>` in
`src/app/_components/ui.tsx`: hand-authored SVG on brand tokens, legible at
favicon size, recolouring per theme. Two kinds of asset, two jobs — do not
swap one for the other.

To replace these with a true vector, export with text converted to outlines
and shapes as paths (Illustrator: Save As → SVG, *Preserve Illustrator
Editing* off; Figma: Export → SVG with "Outline text" on). A correct export
contains `<path>` elements. A file containing `<image ... base64>` is a
bitmap in disguise, like both of these.
