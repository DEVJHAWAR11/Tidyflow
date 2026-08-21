import tempfile
from pathlib import Path
from src.scanner import scan_directory
from src.config import TidyConfig
from src.graph import route_node


def test_ignore_list():
    with tempfile.TemporaryDirectory() as temp_dir:
        input_dir = Path(temp_dir)
        ignore_file = input_dir / ".tidyignore"
        ignore_file.write_text("*.log\nignore_dir\n")

        (input_dir / "test.txt").write_text("hello")
        (input_dir / "app.log").write_text("skip me")

        ignore_dir = input_dir / "ignore_dir"
        ignore_dir.mkdir()
        (ignore_dir / "secret.txt").write_text("skip me too")

        keep_dir = input_dir / "keep_dir"
        keep_dir.mkdir()
        (keep_dir / "keep.txt").write_text("keep me")

        cfg = TidyConfig(input_dir=input_dir)
        records = scan_directory(cfg)

        filenames = [r.filename for r in records if not r.skipped]

        assert "test.txt" in filenames
        assert "keep.txt" in filenames
        assert "app.log" not in filenames
        assert "secret.txt" not in filenames


def test_large_file_routing():
    # 51 MB
    state = {"file_path": "big.mp4", "size": 51 * 1024 * 1024}
    res = route_node(state)
    assert res.get("category") == "Large_Files"

    # 49 MB
    state = {"file_path": "small.mp4", "size": 49 * 1024 * 1024}
    res = route_node(state)
    assert res.get("category") != "Large_Files"
