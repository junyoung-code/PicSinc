"""Small file-based bridge for the local Next.js editor; no web server."""
import base64
from contextlib import redirect_stdout
from io import BytesIO
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from outline import get_segmenter, read_photo, visible_contours, render_people


def export_regions(photo, masks):
    width, height = photo.size
    regions = []
    for mask in masks:
        mask = np.asarray(mask, dtype=bool)
        if mask.shape != (height, width):
            raise ValueError("Mask dimensions differ from the displayed photo")
        contours = visible_contours(mask)
        if not contours:
            continue
        points = np.concatenate(contours).reshape(-1, 2)
        left, top = points.min(axis=0)
        right, bottom = points.max(axis=0)
        png = BytesIO()
        Image.fromarray(mask.astype(np.uint8) * 255).save(png, format="PNG")
        regions.append({"box": {"x": int(left), "y": int(top), "width": int(right-left+1), "height": int(bottom-top+1)}, "maskPngBase64": base64.b64encode(png.getvalue()).decode("ascii")})
    preview, _ = render_people(photo, masks)
    preview_png = BytesIO()
    preview.save(preview_png, format="PNG")
    regions.sort(key=lambda r: (r["box"]["y"], r["box"]["x"]))
    return {"width": width, "height": height, "previewPngBase64": base64.b64encode(preview_png.getvalue()).decode("ascii"), "regions": [{"id": f"person_{i+1:03d}", **r} for i, r in enumerate(regions)]}


if __name__ == "__main__":
    # Keep model diagnostics out of the machine-readable output file.
    with redirect_stdout(sys.stderr):
        photo = read_photo(sys.argv[1])
        result = export_regions(photo, get_segmenter().predict(photo))
    Path(sys.argv[2]).write_text(json.dumps(result), encoding="utf-8")
