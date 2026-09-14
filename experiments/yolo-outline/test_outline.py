import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import numpy as np
from PIL import Image

import outline


class OutlineTests(unittest.TestCase):
    def setUp(self):
        self.photo = Image.new("RGB", (400, 300), (210, 220, 230))

    def mask(self, x, y, width=90, height=150):
        mask = np.zeros((300, 400), dtype=bool)
        mask[y:y + height, x:x + width] = True
        return mask

    def test_two_people_sorted_and_colored_without_changing_original(self):
        left, right = self.mask(25, 80), self.mask(260, 80)
        before = np.asarray(self.photo).copy()
        result, ids = outline.render_people(self.photo, [right, left])
        pixels = np.asarray(result)
        self.assertEqual(ids, ["person_001", "person_002"])
        self.assertEqual(result.size, self.photo.size)
        np.testing.assert_array_equal(np.asarray(self.photo), before)
        np.testing.assert_array_equal(pixels[180, 25], outline.color_for(0))
        np.testing.assert_array_equal(pixels[180, 260], outline.color_for(1))
        np.testing.assert_array_equal(pixels[280, 200], before[280, 200])
        expected = np.rint(before[180, 60] * .75 + outline.PURPLE * .25).astype(np.uint8)
        np.testing.assert_array_equal(pixels[180, 60], expected)

    def test_holes_remain_background_and_overlap_is_tinted_once(self):
        first = self.mask(30, 60, 180, 210)
        first[170:220, 70:120] = False
        second = self.mask(150, 80, 180, 180)
        result, _ = outline.render_people(self.photo, [first, second])
        pixels = np.asarray(result)
        np.testing.assert_array_equal(pixels[195, 95], np.asarray(self.photo)[195, 95])
        expected = np.rint(np.asarray(self.photo)[200, 180] * .75 + outline.PURPLE * .25).astype(np.uint8)
        np.testing.assert_array_equal(pixels[200, 180], expected)

    def test_empty_detection_preserves_image(self):
        result, ids = outline.render_people(self.photo, [])
        self.assertEqual(ids, [])
        np.testing.assert_array_equal(result, self.photo)

    def test_single_person_and_empty_mask(self):
        result, ids = outline.render_people(self.photo, [self.mask(50, 60), np.zeros((300, 400))])
        self.assertEqual(ids, ["person_001"])
        self.assertEqual(result.size, self.photo.size)

    def test_eight_distinct_colors_and_deterministic_extra_colors(self):
        self.assertEqual(len(set(outline.color_for(i) for i in range(16))), 16)
        self.assertEqual(outline.color_for(9), outline.color_for(9))

    def test_misaligned_mask_is_rejected(self):
        with self.assertRaises(ValueError):
            outline.render_people(self.photo, [np.ones((100, 100))])

    def test_missing_corrupt_and_valid_upload(self):
        with self.assertRaisesRegex(ValueError, "먼저"):
            outline.read_photo(None)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "photo.png"
            path.write_bytes(b"not a photo")
            with self.assertRaisesRegex(ValueError, "읽지 못했습니다"):
                outline.read_photo(path)
            self.photo.save(path)
            before = path.read_bytes()
            self.assertEqual(outline.read_photo(path).size, self.photo.size)
            self.assertEqual(path.read_bytes(), before)

    def test_model_is_reused(self):
        outline.get_segmenter.cache_clear()
        try:
            with patch.object(outline, "Segmenter") as factory:
                self.assertIs(outline.get_segmenter(), outline.get_segmenter())
                factory.assert_called_once_with()
        finally:
            outline.get_segmenter.cache_clear()

    def test_mps_failure_retries_on_cpu(self):
        segmenter = outline.Segmenter.__new__(outline.Segmenter)
        segmenter.device = "mps"
        segmenter.model = Mock()
        segmenter.model.predict.side_effect = [RuntimeError("MPS backend failed"), [SimpleNamespace(masks=None)]]
        self.assertEqual(segmenter.predict(self.photo), [])
        self.assertEqual(segmenter.device, "cpu")
        segmenter.model.to.assert_called_once_with("cpu")
        self.assertEqual([call.kwargs["device"] for call in segmenter.model.predict.call_args_list], ["mps", "cpu"])

    def test_unrelated_model_error_is_not_retried(self):
        segmenter = outline.Segmenter.__new__(outline.Segmenter)
        segmenter.device = "mps"
        segmenter.model = Mock()
        segmenter.model.predict.side_effect = RuntimeError("invalid weights")
        with self.assertRaisesRegex(RuntimeError, "invalid weights"):
            segmenter.predict(self.photo)
        segmenter.model.predict.assert_called_once()


if __name__ == "__main__":
    unittest.main()
