export type PhotoView = { scale: number; x: number; y: number };
type Size = { width: number; height: number };

// At most two CSS pixels per original pixel, with a practical 16× fit limit.
export function photoScaleLimit(fitScale: number) {
  return Math.max(fitScale, Math.min(fitScale * 16, 2));
}

export function boundPhotoView(view: PhotoView, image: Size, viewport: Size): PhotoView {
  const bound = (offset: number, length: number, available: number) => length <= available
    ? (available - length) / 2 : Math.max(available - length, Math.min(0, offset));
  return { scale: view.scale, x: bound(view.x, image.width * view.scale, viewport.width), y: bound(view.y, image.height * view.scale, viewport.height) };
}

export function zoomPhotoAt(view: PhotoView, anchor: { x: number; y: number }, scale: number): PhotoView {
  return { scale, x: anchor.x - (anchor.x - view.x) * scale / view.scale, y: anchor.y - (anchor.y - view.y) * scale / view.scale };
}

export function photoPreviewScale(image: Size, displayWidth: number, dpr: number) {
  return Math.min(1, Math.max(1600 / Math.max(image.width, image.height), displayWidth * dpr / image.width));
}

// Only tap/face-selection transitions animate; direct manipulation stays immediate.
export function animatePhotoView(from: PhotoView, to: PhotoView, draw: (view: PhotoView) => void) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { draw(to); return () => {}; }
  let frame = 0;
  const started = performance.now();
  const step = (now: number) => {
    const progress = Math.min(1, (now - started) / 240), eased = 1 - (1 - progress) ** 3;
    draw({ scale: from.scale + (to.scale - from.scale) * eased, x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased });
    if (progress < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}
