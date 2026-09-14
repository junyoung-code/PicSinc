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

    def test_inner_hole_and_tiny_island_are_not_outlined(self):
        mask = self.mask(30, 60, 180, 210)
        mask[160:220, 70:120] = False
        mask[230:233, 330:333] = True
        before = mask.copy()
        result, ids = outline.render_people(self.photo, [mask])
        pixels = np.asarray(result)
        # The hole stays background, including its edge; the island keeps fill only.
        np.testing.assert_array_equal(pixels[190, 70], np.asarray(self.photo)[190, 70])
        expected = np.rint(np.asarray(self.photo)[231, 331] * .75 + outline.PURPLE * .25).astype(np.uint8)
        np.testing.assert_array_equal(pixels[231, 331], expected)
        np.testing.assert_array_equal(mask, before)
        self.assertEqual(ids, ['person_001'])

    def test_large_detached_part_still_has_outline(self):
        mask = self.mask(30, 60, 100, 210) | self.mask(220, 150, 40, 80)
        result, _ = outline.render_people(self.photo, [mask])
        np.testing.assert_array_equal(np.asarray(result)[190, 220], outline.color_for(0))

    def test_duplicate_keeps_higher_score_and_ids_are_contiguous(self):
        low, high = self.mask(30, 60), self.mask(32, 60)
        other = self.mask(260, 70)
        kept = outline.filter_duplicate_masks([low, high, other], [.4, .9, .8])
        self.assertEqual(len(kept), 2)
        self.assertIs(kept[0], high)
        self.assertIs(kept[1], other)
        _, ids = outline.render_people(self.photo, kept)
        self.assertEqual(ids, ['person_001', 'person_002'])

    def test_low_score_contained_fragment_is_removed(self):
        person = self.mask(30, 60, 180, 210)
        fragment = self.mask(60, 180, 60, 60)
        kept = outline.filter_duplicate_masks([fragment, person], [.27, .86])
        self.assertEqual(len(kept), 1)
        self.assertIs(kept[0], person)

    def test_contained_similar_sized_duplicates_are_removed(self):
        person = self.mask(30, 60, 180, 210)
        duplicate = self.mask(30, 60, 120, 210)
        kept = outline.filter_duplicate_masks([person, duplicate], [.32, .39])
        self.assertEqual(len(kept), 1)
        self.assertIs(kept[0], duplicate)

    def test_overlapping_people_and_separate_small_person_survive(self):
        left = self.mask(30, 60, 160, 210)
        right = self.mask(130, 60, 160, 210)
        small = self.mask(330, 180, 30, 50)
        masks = [left, right, small]
        kept = outline.filter_duplicate_masks(masks, [.85, .4, .27])
        self.assertEqual(len(kept), 3)
        for actual, expected in zip(kept, masks):
            self.assertIs(actual, expected)

    def test_confident_contained_person_is_not_treated_as_fragment(self):
        person = self.mask(30, 60, 180, 210)
        small = self.mask(60, 180, 60, 60)
        self.assertEqual(len(outline.filter_duplicate_masks([person, small], [.9, .8])), 2)

    def test_predict_filters_duplicates_before_returning_masks(self):
        segmenter = outline.Segmenter.__new__(outline.Segmenter)
        result = Mock()
        result.masks.data.cpu.return_value.numpy.return_value = np.stack([self.mask(30, 60)] * 2)
        result.boxes.conf.cpu.return_value.numpy.return_value = np.array([.8, .3])
        segmenter._predict = Mock(return_value=result)
        self.assertEqual(len(segmenter.predict(self.photo)), 1)

    def test_predict_refines_filtered_masks_using_original_photo(self):
        segmenter = outline.Segmenter.__new__(outline.Segmenter)
        result = Mock()
        result.masks.data.cpu.return_value.numpy.return_value = np.stack([
            self.mask(30, 60, 160, 210), self.mask(130, 60, 160, 210)])
        result.boxes.conf.cpu.return_value.numpy.return_value = np.array([.8, .7])
        segmenter._predict = Mock(return_value=result)
        with patch.object(outline, 'resolve_overlaps', return_value=['refined']) as refine:
            self.assertEqual(segmenter.predict(self.photo), ['refined'])
            self.assertIs(refine.call_args.args[0], self.photo)
            self.assertEqual(len(refine.call_args.args[1]), 2)

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
