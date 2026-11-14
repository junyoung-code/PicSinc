# MOIRA splash

Two-second, silent, 1920 × 1080 / 60 fps web intro. The original Figma characters bounce, converge, and become the original MOIRA wordmark with all five colors.

- `index.html`: editable HyperFrames composition.
- `assets/`: original local vector layers and GSAP runtime.
- `.media/manifest.jsonl`: Figma source node IDs and asset hashes.
- `renders/moira-splash.mp4`: rendered delivery.

Run `npm run dev` for the timeline editor and `npm run check` to verify the composition. Render with `npm run render -- --fps 60 --quality delivery --output renders/moira-splash.mp4`.

Figma source: [Brand & Foundations](https://www.figma.com/design/RuyZOuRcQIN6M5RYjR6vJE/?node-id=6-2).

The video uses original transparent SVG layers; opaque PNG exports are reference files only. The original black wordmark is preserved as a silhouette and colored through a mask. No source Figma nodes are changed.

## Verification

Rendered `renders/moira-splash.mp4`: H.264, 1920×1080, 60 fps, exactly 120 frames / 2.000 seconds, 601,086 bytes, no audio. Full FFmpeg decode passed. `check-result.json` records passing runtime, layout, motion and contrast checks. The single-scene nested clip receives one non-blocking Studio row-structure warning. `snapshots/render-contact-sheet.jpg` was visually inspected at 0.2-second intervals.

The scaffold's CLI pin was upgraded from 0.7.76 to 0.8.149 before the successful final checks and render.
