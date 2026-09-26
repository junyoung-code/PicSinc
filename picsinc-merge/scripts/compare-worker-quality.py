"""Compare private Mac and Windows outputs locally; print metrics, never image data."""
import argparse
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image


def image_bytes(value):
    with Image.open(BytesIO(base64.b64decode(value, validate=True))) as image:
        return np.asarray(image.convert("L")) > 0


def compare_detection(reference_path, candidate_path):
    reference = json.loads(Path(reference_path).read_text(encoding="utf-8"))
    candidate = json.loads(Path(candidate_path).read_text(encoding="utf-8"))
    if (reference["width"], reference["height"]) != (candidate["width"], candidate["height"]):
        raise ValueError("Detection dimensions changed")
    expected = {region["id"]: region for region in reference["regions"]}
    actual = {region["id"]: region for region in candidate["regions"]}
    if len(expected) != len(reference["regions"]) or len(actual) != len(candidate["regions"]) or expected.keys() != actual.keys():
        raise ValueError("Person count or region IDs changed")
    scores = {}
    for region_id in expected:
        left = image_bytes(expected[region_id]["maskPngBase64"])
        right = image_bytes(actual[region_id]["maskPngBase64"])
        if left.shape != right.shape or left.shape != (reference["height"], reference["width"]):
            raise ValueError("Mask dimensions changed")
        union = np.logical_or(left, right).sum()
        scores[region_id] = float(np.logical_and(left, right).sum() / union) if union else 1.0
    minimum = min(scores.values(), default=1.0)
    print(f"people={len(scores)} minimum_mask_iou={minimum:.4f}")
    if minimum < 0.98:
        raise ValueError("Mask overlap is below 0.98; inspect the affected contours")


def read_png(path):
    with Image.open(path) as image:
        if image.format != "PNG" or image.mode == "P":
            raise ValueError("Output must be a non-palette PNG")
        return np.asarray(image.convert("RGBA"))


def compare_composition(reference_path, candidate_path, original_path=None, mask_path=None):
    reference = read_png(reference_path)
    candidate = read_png(candidate_path)
    if reference.shape != candidate.shape:
        raise ValueError("Composition dimensions changed")
    changed = int(np.count_nonzero(np.any(reference != candidate, axis=2)))
    print(f"width={reference.shape[1]} height={reference.shape[0]} changed_pixels={changed}")
    if changed:
        raise ValueError("Decoded PNG pixels differ; inspect the cause before release")
    if original_path and mask_path:
        with Image.open(original_path) as image:
            original = np.asarray(image.convert("RGBA"))
        with Image.open(mask_path) as image:
            selected = np.asarray(image.convert("L")) > 0
        if original.shape != reference.shape or selected.shape != reference.shape[:2]:
            raise ValueError("Original or mask dimensions differ from output")
        if np.any(reference[~selected] != original[~selected]):
            raise ValueError("Unselected pixels differ from the original")


def save_preview(result_path, output_path):
    result = json.loads(Path(result_path).read_text(encoding="utf-8"))
    data = base64.b64decode(result["previewPngBase64"], validate=True)
    with Image.open(BytesIO(data)) as image:
        if image.format != "PNG":
            raise ValueError("Detection preview must be PNG")
    Path(output_path).write_bytes(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="kind", required=True)
    for kind in ("detection", "composition"):
        command = subcommands.add_parser(kind)
        command.add_argument("reference")
        command.add_argument("candidate")
        if kind == "composition":
            command.add_argument("--original")
            command.add_argument("--mask")
    preview = subcommands.add_parser("preview")
    preview.add_argument("result")
    preview.add_argument("output")
    args = parser.parse_args()
    if args.kind == "detection":
        compare_detection(args.reference, args.candidate)
    elif args.kind == "composition":
        if bool(args.original) != bool(args.mask):
            parser.error("--original and --mask must be provided together")
        compare_composition(args.reference, args.candidate, args.original, args.mask)
    else:
        save_preview(args.result, args.output)


if __name__ == "__main__":
    main()
