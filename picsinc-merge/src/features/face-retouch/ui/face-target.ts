// The tap target over a face in the personal overview. A side face or a tight detection used to
// give a sliver of a box whose corner marks ran into each other (11/13 phone test). Keep it face
// shaped: at least 3 wide for 4 tall, never wider than tall, grown around the same centre and
// kept inside the photo. Boxes are fractions of the photo; width/height are the photo in pixels.
export type Box = { x: number; y: number; width: number; height: number };
export function faceTargetBox(box: Box, width: number, height: number): Box {
  let w = box.width * width, h = box.height * height;
  if (w < h * .75) w = h * .75;
  if (h < w) h = w;
  w = Math.min(w, width); h = Math.min(h, height);
  const cx = (box.x + box.width / 2) * width, cy = (box.y + box.height / 2) * height;
  const left = Math.min(Math.max(0, cx - w / 2), width - w), top = Math.min(Math.max(0, cy - h / 2), height - h);
  return { x: left / width, y: top / height, width: w / width, height: h / height };
}
