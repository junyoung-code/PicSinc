import base64
from io import BytesIO
import tempfile
from pathlib import Path
import unittest

import numpy as np
from PIL import Image
from export_regions import export_regions
from outline import read_photo, render_people


class ExportRegionsTests(unittest.TestCase):
    def test_full_resolution_binary_png_preserves_holes_and_order(self):
        photo = Image.new("RGB", (30, 20))
        left = np.zeros((20, 30), dtype=bool)
        left[2:15, 2:12] = True
        left[6:9, 5:8] = False
        right = np.zeros_like(left)
        right[3:18, 18:28] = True
        before = left.copy()
        result = export_regions(photo, [right, left])
        self.assertEqual((result['width'], result['height']), photo.size)
        preview = Image.open(BytesIO(base64.b64decode(result['previewPngBase64'])))
        np.testing.assert_array_equal(np.asarray(preview), np.asarray(render_people(photo, [right, left])[0]))
        self.assertEqual([r['id'] for r in result['regions']], ['person_001', 'person_002'])
        decoded = np.asarray(Image.open(BytesIO(base64.b64decode(result['regions'][0]['maskPngBase64']))))
        np.testing.assert_array_equal(decoded, left.astype(np.uint8) * 255)
        np.testing.assert_array_equal(left, before)
        self.assertEqual(export_regions(photo, [])['regions'], [])
        with self.assertRaises(ValueError):
            export_regions(photo, [np.zeros((2, 3))])

    def test_exif_uses_display_dimensions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rotated.jpg'
            exif = Image.Exif(); exif[274] = 6
            Image.new('RGB', (20, 30)).save(path, exif=exif)
            photo = read_photo(path)
            self.assertEqual(photo.size, (30, 20))
            result = export_regions(photo, [np.ones((20, 30), dtype=bool)])
            self.assertEqual((result['width'], result['height']), photo.size)
