# Brand assets

`brandeis-lockup-dark.png` — the owner's APPROVED full lockup (1300×445,
transparent background), extracted from the supplied `.svg`. That file was a
raster wrapped in an SVG element: one `<image>` with a base64 PNG, zero path
data. It is not a vector, so it does not scale and cannot be recoloured.

**Use it only large, and only on dark grounds.** Two things were measured:

- At 26px (nav height) the outlined letterforms and the record's data grid
  collapse into an illegible smear. This is a hero lockup, ~120px and up.
- The render has a soft glow baked into the pixels. On the brand dark ground
  it disappears; on white it reads as a dirty grey plate around the artwork.

Everything smaller or light-mode uses `<BrandMark>` / `<BrandLockup>` in
`src/app/_components/ui.tsx`: hand-authored SVG on brand tokens, legible at
favicon size, and it recolours per style. Two assets, two jobs — do not swap
one for the other.

To replace this with a true vector, the designer needs to export with text
converted to outlines and shapes as paths (Illustrator: "Save As → SVG" with
*Preserve Illustrator Editing* off and no rasterisation; Figma: select the
frame → Export → SVG, with "Outline text" on). A correct export contains
`<path>` elements. If the file contains `<image ... base64>`, it is a bitmap
in disguise.
