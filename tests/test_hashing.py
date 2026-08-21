from pathlib import Path
from PIL import Image
from src.hashing import (
    assign_exact_duplicate_groups,
    assign_near_duplicate_groups,
    compute_perceptual_hashes,
)
from src.models import FileRecord


def test_exact_duplicate_grouping(tmp_path):
    f1 = tmp_path / "f1.txt"
    f2 = tmp_path / "f2.txt"
    f3 = tmp_path / "f3.txt"

    f1.write_text("Identical content")
    f2.write_text("Identical content")
    f3.write_text("Different content")

    r1 = FileRecord(file_id="1", abs_path=f1, rel_path=Path("f1.txt"), filename="f1.txt", extension=".txt", file_size_bytes=10, sha256="samehash123")
    r2 = FileRecord(file_id="2", abs_path=f2, rel_path=Path("f2.txt"), filename="f2.txt", extension=".txt", file_size_bytes=10, sha256="samehash123")
    r3 = FileRecord(file_id="3", abs_path=f3, rel_path=Path("f3.txt"), filename="f3.txt", extension=".txt", file_size_bytes=10, sha256="diffhash456")

    dup_groups = assign_exact_duplicate_groups([r1, r2, r3])
    assert dup_groups == 1
    assert r1.duplicate_group_id is not None
    assert r1.duplicate_group_id == r2.duplicate_group_id
    assert r3.duplicate_group_id is None


def test_perceptual_hashing_and_near_dups(tmp_path):
    img_p1 = tmp_path / "img1.png"
    img_p2 = tmp_path / "img2.png"

    # Create solid color test images
    img1 = Image.new("RGB", (100, 100), color="blue")
    img1.save(img_p1)

    img2 = Image.new("RGB", (100, 100), color="blue")
    img2.save(img_p2)

    r1 = FileRecord(file_id="img1", abs_path=img_p1, rel_path=Path("img1.png"), filename="img1.png", extension=".png", file_size_bytes=500, file_category="image", sha256="hash1")
    r2 = FileRecord(file_id="img2", abs_path=img_p2, rel_path=Path("img2.png"), filename="img2.png", extension=".png", file_size_bytes=500, file_category="image", sha256="hash2")

    compute_perceptual_hashes([r1, r2])
    assert r1.perceptual_hash is not None
    assert r2.perceptual_hash is not None

    near_groups = assign_near_duplicate_groups([r1, r2], hamming_threshold=8)
    assert near_groups == 1
    assert r1.near_duplicate_group_id == r2.near_duplicate_group_id
