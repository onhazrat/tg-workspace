"""Configuration rows say ".env" only for names a dotenv file actually assigns.

`dotenv_names_in` reads names, never values, from the files `Settings`
configures. CI has no `.env`, so the cached wrapper alone would leave the scan
untested; these cases drive it with temporary files.
"""

from pathlib import Path

from app.services.settings_configuration import dotenv_names_in


def test_reads_assigned_names_and_ignores_comments_and_values(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    env.write_text(
        "# FAKE_COMMENT=1\n"
        "POSTGRES_DB=app\n"
        "  export secret_key = abc\n"
        "not an assignment\n"
        "EMPTY=\n"
    )
    assert dotenv_names_in(".env", [tmp_path]) == {"POSTGRES_DB", "SECRET_KEY", "EMPTY"}


def test_relative_path_is_tried_under_each_root_in_turn(tmp_path: Path) -> None:
    first, second = tmp_path / "cwd", tmp_path / "backend"
    first.mkdir()
    second.mkdir()
    (second / ".env").write_text("FROM_BACKEND=1\n")
    assert dotenv_names_in(".env", [first, second]) == {"FROM_BACKEND"}


def test_several_files_merge_and_a_missing_one_is_skipped(tmp_path: Path) -> None:
    a = tmp_path / "a.env"
    a.write_text("ALPHA=1\n")
    absolute_b = tmp_path / "b.env"
    absolute_b.write_text("BETA=2\n")
    configured = ("a.env", absolute_b, "missing.env")
    assert dotenv_names_in(configured, [tmp_path]) == {"ALPHA", "BETA"}


def test_no_configured_file_means_no_names(tmp_path: Path) -> None:
    assert dotenv_names_in(None, [tmp_path]) == frozenset()
    assert dotenv_names_in(".env", [tmp_path]) == frozenset()
