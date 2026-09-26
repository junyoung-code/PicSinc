import base64
from io import BytesIO
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image


module_path = Path(__file__).with_name("compare-worker-quality.py")
spec = importlib.util.spec_from_file_location("compare_worker_quality", module_path)
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


def png(values):
    image = Image.new("L", (2, 2))
    image.putdata(values)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class QualityTests(unittest.TestCase):
    def test_detection_rejects_missing_person_and_mask_regression(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "reference.json"
            candidate = Path(directory) / "candidate.json"
            row = {"id": "person_001", "maskPngBase64": base64.b64encode(png([255, 255, 0, 0])).decode()}
            reference.write_text(json.dumps({"width": 2, "height": 2, "regions": [row]}))
            candidate.write_text(json.dumps({"width": 2, "height": 2, "regions": []}))
            with self.assertRaisesRegex(ValueError, "Person count"):
                quality.compare_detection(reference, candidate)
            candidate.write_text(json.dumps({"width": 2, "height": 2, "regions": [{**row, "maskPngBase64": base64.b64encode(png([255, 0, 0, 0])).decode()}]}))
            with self.assertRaisesRegex(ValueError, "below 0.98"):
                quality.compare_detection(reference, candidate)

    def test_composition_rejects_one_changed_pixel(self):
        with tempfile.TemporaryDirectory() as directory:
            reference = Path(directory) / "reference.png"
            candidate = Path(directory) / "candidate.png"
            Image.new("RGB", (2, 2), "red").save(reference)
            Image.new("RGB", (2, 2), "red").save(candidate)
            quality.compare_composition(reference, candidate)
            image = Image.open(candidate)
            image.putpixel((0, 0), (254, 0, 0))
            image.save(candidate)
            with self.assertRaisesRegex(ValueError, "pixels differ"):
                quality.compare_composition(reference, candidate)

    def test_preview_extracts_png(self):
        with tempfile.TemporaryDirectory() as directory:
            result = Path(directory) / "result.json"
            output = Path(directory) / "preview.png"
            expected = png([0, 255, 255, 0])
            result.write_text(json.dumps({"previewPngBase64": base64.b64encode(expected).decode()}))
            quality.save_preview(result, output)
            self.assertEqual(output.read_bytes(), expected)


if __name__ == "__main__":
    unittest.main()
