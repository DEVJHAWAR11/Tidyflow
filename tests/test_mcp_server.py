import tempfile
from pathlib import Path
from src.mcp_server import (
    is_path_allowed,
    set_allowed_directories,
    list_files,
    copy_file,
    delete_file,
    move_file,
)


def test_mcp_dynamic_allow_list():
    with tempfile.TemporaryDirectory() as temp_dir:
        safe_dir = Path(temp_dir) / "safe"
        safe_dir.mkdir()

        unsafe_dir = Path(temp_dir) / "unsafe"
        unsafe_dir.mkdir()

        set_allowed_directories([str(safe_dir)])

        assert is_path_allowed(str(safe_dir)) is True
        assert is_path_allowed(str(safe_dir / "doc.pdf")) is True
        assert is_path_allowed(str(unsafe_dir)) is False
        assert is_path_allowed(str(unsafe_dir / "doc.pdf")) is False

        # Copy in safe dir
        src = safe_dir / "src.txt"
        src.write_text("safe content")
        dest = safe_dir / "dest.txt"

        assert copy_file(str(src), str(dest)) == "Success"
        assert dest.exists()

        # Copy to unsafe destination
        unsafe_dest = unsafe_dir / "dest.txt"
        assert "Error" in copy_file(str(src), str(unsafe_dest))

        # List files
        assert "src.txt" in list_files(str(safe_dir))
        assert "Error" in list_files(str(unsafe_dir))

        # Delete file
        assert delete_file(str(dest)) == "Success"
        assert not dest.exists()


def test_copy_and_move_never_replace_an_existing_file(tmp_path):
    set_allowed_directories([tmp_path])
    src = tmp_path / "report.txt"
    src.write_text("new report")
    existing = tmp_path / "Finance" / "report.txt"
    existing.parent.mkdir()
    existing.write_text("the user's own report")

    assert "already exists" in copy_file(str(src), str(existing))
    assert "already exists" in move_file(str(src), str(existing))
    # Given a folder, the file would land inside it, so the same rule applies there.
    assert "already exists" in copy_file(str(src), str(existing.parent))
    assert "already exists" in move_file(str(src), str(existing.parent))

    assert existing.read_text() == "the user's own report"
    assert src.read_text() == "new report"


def test_copy_and_move_into_a_folder(tmp_path):
    set_allowed_directories([tmp_path])
    (tmp_path / "a.txt").write_text("a")
    (tmp_path / "b.txt").write_text("b")
    folder = tmp_path / "Docs"
    folder.mkdir()

    assert copy_file(str(tmp_path / "a.txt"), str(folder)) == "Success"
    assert move_file(str(tmp_path / "b.txt"), str(folder)) == "Success"
    assert (folder / "a.txt").read_text() == "a" and (tmp_path / "a.txt").exists()
    assert (folder / "b.txt").read_text() == "b" and not (tmp_path / "b.txt").exists()


def test_an_interrupted_copy_or_move_leaves_no_partial_file(tmp_path, monkeypatch):
    import src.mcp_server as mcp

    set_allowed_directories([tmp_path])
    src = tmp_path / "big.bin"
    src.write_bytes(b"x" * 1000)
    dest = tmp_path / "out" / "big.bin"

    def disk_full(source, destination, *args, **kwargs):
        Path(destination).write_bytes(b"x" * 10)
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(mcp.shutil, "copy2", disk_full)
    assert "No space left" in copy_file(str(src), str(dest))
    assert not dest.exists()

    monkeypatch.setattr(mcp.shutil, "move", disk_full)
    assert "No space left" in move_file(str(src), str(dest))
    assert not dest.exists()
    assert src.read_bytes() == b"x" * 1000
