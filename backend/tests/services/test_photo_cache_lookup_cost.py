"""Guard: an on-disk image cache must not enumerate its directory per lookup.

`channel_photos` and `post_thumbnails` are twins — same `_META_SUFFIX`, same
`_meta_path`/`_read_meta`/`_find_image_path`/`has_cached_*` shape, same bounded
set of writable extensions. `post_thumbnails` was fixed to probe those
extensions instead of globbing; `channel_photos` was not, and a wildcard glob
enumerates the whole directory on every call. `channel_to_camel` asks once per
channel, so on staging that turned a channel list into 2,068 scans of a
16,276-entry directory: 30 of the 33 seconds the request took, growing
quadratically because both terms grow together.

These tests assert the reason rather than the implementation — lookup cost must
not scale with how many things are being looked up — so they hold whether the
fix stays an extension probe or becomes something else, and they fail if either
twin drifts back.
"""

from __future__ import annotations

import os
import pathlib
import uuid
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Channel
from app.services import channel_photos, post_thumbnails
from app.services.channels import list_channels
from tests.utils.setting_groups import add_test_channel


class _ScanCounter:
    def __init__(self) -> None:
        self.count = 0


@contextmanager
def count_directory_scans() -> Iterator[_ScanCounter]:
    """Count every way this codebase can enumerate a directory.

    Patching `os.scandir` alone would not do: `glob`'s internal globber binds it
    as a staticmethod at class-definition time, so a `Path.glob` call sails past
    a later patch and the guard becomes one that cannot fail. Wrap the entry
    points themselves.
    """
    counter = _ScanCounter()
    originals: dict[tuple[object, str], object] = {
        (pathlib.Path, "glob"): pathlib.Path.glob,
        (pathlib.Path, "iterdir"): pathlib.Path.iterdir,
        (os, "scandir"): os.scandir,
        (os, "listdir"): os.listdir,
    }

    def wrap(original):  # type: ignore[no-untyped-def]
        def wrapper(*args, **kwargs):  # type: ignore[no-untyped-def]
            counter.count += 1
            return original(*args, **kwargs)

        return wrapper

    try:
        for (target, name), original in originals.items():
            setattr(target, name, wrap(original))
        yield counter
    finally:
        for (target, name), original in originals.items():
            setattr(target, name, original)


@pytest.mark.parametrize(
    "enumerate_a_directory",
    [
        pytest.param(lambda d: list(d.glob("*.py")), id="Path.glob"),
        pytest.param(lambda d: list(d.iterdir()), id="Path.iterdir"),
        pytest.param(lambda d: os.listdir(d), id="os.listdir"),
        pytest.param(lambda d: list(os.scandir(d)), id="os.scandir"),
        pytest.param(lambda d: list(d.glob("*/*.py")), id="Path.glob-recursive"),
    ],
)
def test_the_counter_actually_counts(
    enumerate_a_directory: Callable[[Path], object],
) -> None:
    """The guard's own instrument, checked against every enumeration route.

    A counter blind to one of these is a guard that cannot fail — the exact
    failure mode CLAUDE.md warns about. Asserts "counted at all", not an exact
    tally: one `Path.glob` legitimately routes through `os.scandir` as well.
    """
    with count_directory_scans() as counter:
        enumerate_a_directory(Path(__file__).parent)
    assert counter.count > 0


def _populate(directory: Path, stems: list[str]) -> None:
    for stem in stems:
        (directory / f"{stem}.jpg").write_bytes(b"x")
        (directory / f"{stem}.meta.json").write_text("{}", encoding="utf-8")


@pytest.mark.parametrize(
    ("dir_setting", "module", "stems", "hit", "miss"),
    [
        pytest.param(
            "CHANNEL_PHOTO_DIR",
            channel_photos,
            [f"chan{i}" for i in range(50)],
            lambda: channel_photos.has_cached_photo("chan7"),
            lambda: channel_photos.has_cached_photo("absent"),
            id="channel_photos",
        ),
        pytest.param(
            "POST_THUMB_DIR",
            post_thumbnails,
            [f"chan_{i}" for i in range(50)],
            lambda: post_thumbnails.has_cached_thumb("chan", 7),
            lambda: post_thumbnails.has_cached_thumb("chan", 999),
            id="post_thumbnails",
        ),
    ],
)
def test_a_single_lookup_does_not_enumerate_the_cache_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    dir_setting: str,
    module: object,
    stems: list[str],
    hit: Callable[[], bool],
    miss: Callable[[], bool],
) -> None:
    monkeypatch.setattr(module.settings, dir_setting, str(tmp_path))  # type: ignore[attr-defined]
    _populate(tmp_path, stems)

    with count_directory_scans() as counter:
        found = hit()
        absent = miss()

    assert found is True
    assert absent is False
    assert counter.count == 0, (
        f"{dir_setting} lookup enumerated its directory {counter.count} time(s); "
        "cost must not depend on how many files the cache holds"
    )


def test_channel_list_lookup_cost_does_not_scale_with_channel_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The property the operator actually feels, end to end.

    Ten channels and a hundred must cost the same number of directory scans. A
    glob per channel makes these differ by an order of magnitude; anything that
    resolves avatars without walking the directory keeps them equal.
    """
    monkeypatch.setattr(channel_photos.settings, "CHANNEL_PHOTO_DIR", str(tmp_path))

    observed: list[int] = []
    for target in (10, 100):
        with Session(engine) as session:
            existing = len(session.exec(select(Channel)).all())
            new_ids = [f"cost-{i}" for i in range(existing, target)]
            for channel_id in new_ids:
                add_test_channel(session, channel_id)
            session.commit()
            # Half the channels have a cached avatar, half do not: both the
            # found and the not-found path must stay cheap.
            _populate(tmp_path, [cid for cid in new_ids if int(cid[5:]) % 2 == 0])

            with count_directory_scans() as counter:
                # `TENANCY_ENFORCED` is off by default, so scoping is a no-op
                # and any user id sees every channel — this test is about
                # avatar-lookup cost, not the seam.
                rows = list_channels(session, user_id=uuid.uuid4())

        assert len(rows) == target
        observed.append(counter.count)

    assert observed[0] == observed[1], (
        f"listing 10 channels cost {observed[0]} directory scan(s) and 100 cost "
        f"{observed[1]}: avatar lookup is scaling with channel count"
    )


@pytest.fixture(autouse=True)
def _reset_photo_dir_memo() -> Generator[None]:
    """`_photo_dir`/`_thumb_dir` memoise their mkdir per path; keep tests honest."""
    yield
    channel_photos._photo_dirs_ready.clear()
    post_thumbnails._thumb_dirs_ready.clear()
