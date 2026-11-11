# Current Figma home assets

Source: Figma file `RuyZOuRcQIN6M5RYjR6vJE`, frame `656:16586`, inspected 2026-11-07.

- `window-controls.svg`: decorative window controls exported by `get_design_context`.
- `sparkle-left.svg`, `sparkle-right.svg`: decorative accents exported by `get_design_context`.
- `arrow.svg`: navigation/merge arrow exported by `get_design_context`.

- `lilac.png`, `pink.png`: transparent complete artwork frames `I656:16900;157:7146` and `I656:16901;157:7341`, exported read-only through `use_figma`. The enclosing Figma frame has a background fill, so the inner frame containing both the body group and sibling facial-feature vectors is exported. Dimensions: 72 × 72 and 70 × 70.

- `mint.png`, `peach.png`, `sky.png` (2026-11-12, participant colors a2, transparency fix N-30): rebuilt from the Figma `Brand / Character` Default variants (`8:122`, `8:152`, `27:277`). A plain PNG export of those nodes is opaque on the `#e8deff` frame colour, so the three SVG layers from `download_assets` were composited instead, at 2× and shrunk to 72 × 72: the body colour layer (placed at −11.566, −11.566), multiplied by the luminance of the soft-edge mask layer (its black square aligned to the 160 frame), plus the face layer at the Figma face position. Flattened on `#e8deff` it matches the Figma export within about 1/255 on average.

The illustration also reuses `../character-photo.png` and `../moira-logo.svg`.
