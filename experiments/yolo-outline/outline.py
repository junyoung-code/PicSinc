"""Local person segmentation and RGB outline rendering."""

import colorsys
import os
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

CACHE = Path(__file__).resolve().parent / ".cache"
os.environ.setdefault("YOLO_CONFIG_DIR", str(CACHE / "ultralytics"))
os.environ.setdefault("MPLCONFIGDIR", str(CACHE / "matplotlib"))
os.environ.setdefault("YOLO_AUTOINSTALL", "false")

PURPLE = np.array((124, 87, 230), dtype=np.float32)
PALETTE = (
    (0, 153, 255), (0, 195, 125), (255, 150, 35), (255, 75, 160),
    (0, 210, 220), (240, 205, 30), (170, 105, 255), (245, 80, 65),
)


def color_for(index):
    if index < len(PALETTE):
        return PALETTE[index]
    hue = ((index - len(PALETTE)) * 0.61803398875 + 0.12) % 1
    return tuple(round(channel * 255) for channel in colorsys.hsv_to_rgb(hue, .7, .95))


def read_photo(path):
    if not path:
        raise ValueError("먼저 JPG 또는 PNG 사진을 올려 주세요.")
    try:
        with Image.open(path) as photo:
            if photo.format not in {"JPEG", "PNG"}:
                raise ValueError("JPG 또는 PNG 사진을 올려 주세요.")
            return ImageOps.exif_transpose(photo).convert("RGB")
    except (OSError, Image.DecompressionBombError) as error:
        raise ValueError("사진을 읽지 못했습니다. 다른 JPG 또는 PNG 파일을 올려 주세요.") from error


class Segmenter:
    def __init__(self):
        Path(os.environ["YOLO_CONFIG_DIR"]).mkdir(parents=True, exist_ok=True)
        import torch
        from ultralytics import YOLO, settings

        CACHE.mkdir(parents=True, exist_ok=True)
        settings.update({"sync": False})
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model = YOLO(str(CACHE / "yolo26n-seg.pt"))

    def predict(self, photo):
        try:
            result = self._predict(photo)
        except RuntimeError as error:
            # Only retry a Metal-specific failure, not unrelated model errors.
            if self.device != "mps" or not any(word in str(error).lower() for word in ("mps", "metal")):
                raise
            self.device = "cpu"
            self.model.to("cpu")
            result = self._predict(photo)
        if result.masks is None:
            return []
        masks = [mask.astype(bool) for mask in result.masks.data.cpu().numpy()]
        return filter_duplicate_masks(masks, result.boxes.conf.cpu().numpy())

    def _predict(self, photo):
        return self.model.predict(
            source=photo, device=self.device, classes=[0], imgsz=1024,
            conf=.25, retina_masks=True, verbose=False, save=False,
        )[0]


@lru_cache(maxsize=1)
def get_segmenter():
    return Segmenter()


def filter_duplicate_masks(masks, scores):
    """Keep confident distinct masks; do not merge or reshape their pixels."""
    areas = [np.count_nonzero(mask) for mask in masks]
    boxes = [cv2.boundingRect(mask.astype(np.uint8)) for mask in masks]
    kept = []
    for index in sorted(range(len(masks)), key=lambda i: (-float(scores[i]), i)):
        if not areas[index]:
            continue
        duplicate = False
        for other in kept:
            x, y, w, h = boxes[index]
            ox, oy, ow, oh = boxes[other]
            x0, y0, x1, y1 = max(x, ox), max(y, oy), min(x + w, ox + ow), min(y + h, oy + oh)
            if x0 >= x1 or y0 >= y1:
                continue
            intersection = np.count_nonzero(masks[index][y0:y1, x0:x1] & masks[other][y0:y1, x0:x1])
            iou = intersection / (areas[index] + areas[other] - intersection)
            coverage = intersection / min(areas[index], areas[other])
            size_ratio = min(areas[index], areas[other]) / max(areas[index], areas[other])
            almost_same = iou >= .70 or (coverage >= .95 and size_ratio >= .50)
            small_fragment = (
                coverage >= .95 and areas[index] <= areas[other] * .50
                and scores[index] < .50 and scores[other] - scores[index] >= .20
            )
            if almost_same or small_fragment:
                duplicate = True
                break
        if not duplicate:
            kept.append(index)
    return [masks[i] for i in sorted(kept)]


def visible_contours(mask):
    """Suppress inner boundaries and tiny islands in the drawing only."""
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    if not contours:
        return []
    minimum_area = max(4, cv2.contourArea(contours[0]) * .005)
    return contours[:1] + [contour for contour in contours[1:] if cv2.contourArea(contour) >= minimum_area]


def render_people(photo, masks):
    """Keep full-resolution masks (including holes); return a new image and IDs."""
    original = np.asarray(photo.convert("RGB"))
    height, width = original.shape[:2]
    people = []
    for mask in masks:
        mask = np.asarray(mask, dtype=bool)
        if mask.shape != (height, width):
            raise ValueError("마스크와 원본 사진의 크기가 다릅니다.")
        contours = visible_contours(mask)
        if contours:
            left, top, _, _ = cv2.boundingRect(np.concatenate(contours))
            people.append((top, left, mask, contours))
    people.sort(key=lambda person: person[:2])

    output = original.copy()
    if not people:
        return Image.fromarray(output), []

    # Shared pixels are tinted once, even when raw model masks overlap.
    union = np.logical_or.reduce([person[2] for person in people])
    output[union] = np.rint(original[union] * .75 + PURPLE * .25).astype(np.uint8)
    scale = max(width / 900, .5)
    thickness = max(1, round(3 * scale))
    labels = []
    for index, (top, left, mask, contours) in enumerate(people):
        person_id = f"person_{index + 1:03d}"
        color = color_for(index)
        cv2.drawContours(output, contours, -1, color, thickness, cv2.LINE_AA)
        labels.append((person_id, color, left, top))

    # Draw labels last so a nearby person's contour cannot paint over them.
    for person_id, color, left, top in labels:
        font_scale = .55 * scale
        text_thickness = max(1, round(scale))
        (text_width, text_height), baseline = cv2.getTextSize(
            person_id, cv2.FONT_HERSHEY_SIMPLEX, font_scale, text_thickness,
        )
        pad = max(2, round(4 * scale))
        x = max(pad, min(left, width - text_width - pad))
        y = min(height - baseline - pad, max(text_height + pad, top - pad))
        cv2.rectangle(output, (max(0, x - pad), max(0, y - text_height - pad)),
                      (min(width - 1, x + text_width + pad), min(height - 1, y + baseline + pad)),
                      (25, 25, 35), cv2.FILLED)
        cv2.putText(output, person_id, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                    font_scale, color, text_thickness, cv2.LINE_AA)
    return Image.fromarray(output), [label[0] for label in labels]
