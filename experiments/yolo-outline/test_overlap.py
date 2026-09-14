import unittest
from unittest.mock import patch

import numpy as np
import cv2
from PIL import Image

from overlap import resolve_overlaps


class OverlapTests(unittest.TestCase):
    def fixture(self):
        pixels = np.full((100, 160, 3), (25, 35, 45), dtype=np.uint8)
        pixels[10:90, 10:70] = (180, 30, 30)
        pixels[10:90, 70:150] = (30, 180, 180)
        left = np.zeros((100, 160), dtype=bool)
        right = left.copy()
        left[10:90, 10:100] = True
        right[10:90, 60:150] = True
        return Image.fromarray(pixels), [left, right]

    def test_image_edge_decides_ownership_and_preserves_other_pixels(self):
        photo, masks = self.fixture()
        before = [m.copy() for m in masks]
        original = np.asarray(photo).copy()
        result = resolve_overlaps(photo, masks)
        overlap = masks[0] & masks[1]
        self.assertFalse(np.any(result[0] & result[1]))
        np.testing.assert_array_equal(result[0] | result[1], masks[0] | masks[1])
        self.assertTrue(result[0][50, 65])
        self.assertTrue(result[1][50, 85])
        for i in range(2):
            np.testing.assert_array_equal(result[i][~overlap], masks[i][~overlap])
            np.testing.assert_array_equal(masks[i], before[i])
        np.testing.assert_array_equal(photo, original)

    def test_reversing_people_does_not_reverse_visual_ownership(self):
        photo, masks = self.fixture()
        forward = resolve_overlaps(photo, masks)
        backward = resolve_overlaps(photo, masks[::-1])
        for a, b in zip(forward, backward[::-1]):
            np.testing.assert_array_equal(a, b)

    def test_empty_single_and_disjoint_masks_do_not_run_grabcut(self):
        photo, masks = self.fixture()
        masks[0][:, 60:] = False
        with patch('overlap.cv2.grabCut') as grabcut:
            for group in ([], masks[:1], masks):
                result = resolve_overlaps(photo, group)
                for a, b in zip(result, group):
                    np.testing.assert_array_equal(a, b)
            grabcut.assert_not_called()

    def test_containment_without_reliable_seeds_is_unchanged(self):
        photo, masks = self.fixture()
        small = np.zeros_like(masks[0])
        small[30:50, 30:50] = True
        result = resolve_overlaps(photo, [masks[0], small])
        np.testing.assert_array_equal(result[0], masks[0])
        np.testing.assert_array_equal(result[1], small)

    def test_three_way_overlap_is_unchanged(self):
        photo, masks = self.fixture()
        third = masks[0] & masks[1]
        result = resolve_overlaps(photo, masks + [third])
        for a, b in zip(result, masks + [third]):
            np.testing.assert_array_equal(a, b)

    def test_grabcut_failure_preserves_masks(self):
        photo, masks = self.fixture()
        with patch('overlap.cv2.grabCut', side_effect=cv2.error('failed')):
            with self.assertLogs(level='WARNING'):
                result = resolve_overlaps(photo, masks)
        for a, b in zip(result, masks):
            np.testing.assert_array_equal(a, b)

    def test_large_image_restores_original_resolution_and_union(self):
        photo, masks = self.fixture()
        photo = photo.resize((1600, 1000), Image.Resampling.NEAREST)
        masks = [np.repeat(np.repeat(m, 10, axis=0), 10, axis=1) for m in masks]
        result = resolve_overlaps(photo, masks)
        self.assertFalse(np.any(result[0] & result[1]))
        np.testing.assert_array_equal(result[0] | result[1], masks[0] | masks[1])
        self.assertTrue(result[0][500, 650])
        self.assertTrue(result[1][500, 850])


if __name__ == '__main__':
    unittest.main()
