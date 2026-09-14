"""Use local image colors/edges to split two-person mask conflicts."""

import logging

import cv2
import numpy as np


def resolve_overlaps(photo, masks):
    """Only subtract contested pixels; never extend a mask or change the source.

    Exclusive interiors provide automatic GrabCut seeds. This is a color-based
    heuristic, not a depth/body model. Missing seeds and three-way conflicts stay
    unchanged rather than choosing a person by ID or detection confidence.
    """
    if len(masks) < 2:
        return masks
    image = np.asarray(photo.convert('RGB'))
    height, width = image.shape[:2]
    counts = np.zeros((height, width), dtype=np.uint16)
    for mask in masks:
        if mask.shape != (height, width):
            raise ValueError('마스크와 원본 사진의 크기가 다릅니다.')
        counts += mask
    if not np.any(counts == 2):
        return masks

    result = [mask.copy() for mask in masks]
    boxes = [cv2.boundingRect(mask.astype(np.uint8)) for mask in masks]
    margin = max(12, round(max(height, width) * .02))
    for i, first in enumerate(masks):
        for j in range(i + 1, len(masks)):
            x, y, w, h = boxes[i]
            ox, oy, ow, oh = boxes[j]
            x0, y0 = max(x, ox), max(y, oy)
            x1, y1 = min(x + w, ox + ow), min(y + h, oy + oh)
            if x0 >= x1 or y0 >= y1:
                continue
            region = np.s_[y0:y1, x0:x1]
            conflict = first[region] & masks[j][region] & (counts[region] == 2)
            if not conflict.any():
                continue
            cx, cy, cw, ch = cv2.boundingRect(conflict.astype(np.uint8))
            x0, y0, x1, y1 = (max(0, x0 + cx - margin), max(0, y0 + cy - margin),
                              min(width, x0 + cx + cw + margin), min(height, y0 + cy + ch + margin))
            region = np.s_[y0:y1, x0:x1]
            a, b = first[region], masks[j][region]
            conflict = a & b & (counts[region] == 2)
            crop = image[region]
            # Bound CPU graph size, then restore decisions to original pixels.
            ratio = min(1, 640 / max(crop.shape[:2]))
            size = (max(1, round(crop.shape[1] * ratio)), max(1, round(crop.shape[0] * ratio)))
            crop = cv2.resize(crop, size, interpolation=cv2.INTER_AREA)
            resize_mask = lambda m: cv2.resize(m.astype(np.uint8), size, interpolation=cv2.INTER_NEAREST).astype(bool)
            aa, bb = resize_mask(a), resize_mask(b)
            exclusive = counts[region] == 1
            seed_a = cv2.erode(resize_mask(a & exclusive).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
            seed_b = cv2.erode(resize_mask(b & exclusive).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
            if seed_a.sum() < 5 or seed_b.sum() < 5:
                continue
            labels = np.full(aa.shape, cv2.GC_BGD, dtype=np.uint8)
            labels[bb] = cv2.GC_PR_BGD
            labels[aa] = cv2.GC_PR_FGD
            labels[seed_a] = cv2.GC_FGD
            labels[seed_b] = cv2.GC_BGD
            try:
                cv2.setRNGSeed(0)
                cv2.grabCut(crop, labels, None, np.zeros((1, 65)), np.zeros((1, 65)),
                            3, cv2.GC_INIT_WITH_MASK)
            except cv2.error:
                logging.warning('Overlap refinement failed; preserving the original masks', exc_info=True)
                continue
            belongs_a = (labels == cv2.GC_FGD) | (labels == cv2.GC_PR_FGD)
            belongs_a = cv2.resize(belongs_a.astype(np.uint8), (x1 - x0, y1 - y0),
                                  interpolation=cv2.INTER_NEAREST).astype(bool)
            result[i][region][conflict & ~belongs_a] = False
            result[j][region][conflict & belongs_a] = False
    return result
