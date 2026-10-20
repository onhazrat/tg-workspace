"""The Code Configuration rows are the source's constants, each under a topic (SET-04).

The backend lists every tuning constant on the Settings page from
`app/core/constants_catalog.generated.json`, because the backend image carries
no frontend source to scan. A generated file is only as true as its last
regeneration, so the first guard runs the generator in `--check` mode: a
constant added, changed or moved without regenerating fails here (the
pre-commit hook regenerates it on commit, and this catches a commit that
skipped the hook).

The second guard is the topic map. A constant's topic is chosen per module in
`setting_declarations.CONSTANT_TOPICS`, never guessed from its path, so a module
that gains its first constant must be placed by someone who read it. A map
entry for a module that no longer has a constant fails too, so the map cannot
rot into a list nobody dares prune.

Mutations watched: change a constant's value in source without regenerating;
delete a module from `CONSTANT_TOPICS`; add a map entry for a module with no
constant; map a module to a topic the page does not have.
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys

from app.services.setting_declarations import CONSTANT_TOPICS, TOPICS
from app.services.settings_page import constants_catalog

ROOT = pathlib.Path(__file__).resolve().parents[3]
GENERATOR = ROOT / "scripts/generate_constants_catalog.py"


def test_the_constants_catalog_matches_the_source() -> None:
    result = subprocess.run(
        [sys.executable, str(GENERATOR), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_the_catalog_finds_constants_on_both_sides() -> None:
    """A walk that found nothing would pass every other guard here."""
    entries = json.loads(
        (ROOT / "backend/app/core/constants_catalog.generated.json").read_text()
    )["constants"]
    by_name = {(e["file"], e["name"]): e for e in entries}
    lease = by_name[("backend/app/services/channels.py", "CHANNEL_CLAIM_LEASE_SECONDS")]
    assert isinstance(lease["value"], int)
    assert lease["comment"], "the comment above a constant is its description"
    assert any(e["file"].startswith("frontend/src/") for e in entries)
    assert not any(".test." in e["file"] for e in entries)
    assert not any(e["name"] in {"MINUTE_MS", "_WEEK_MS"} for e in entries)


def test_every_module_with_a_constant_has_a_topic() -> None:
    modules = {entry["file"] for entry in constants_catalog()}
    unplaced = sorted(modules - set(CONSTANT_TOPICS))
    assert not unplaced, (
        "modules with a constant but no topic; add them to "
        f"setting_declarations.CONSTANT_TOPICS: {unplaced}"
    )
    stale = sorted(set(CONSTANT_TOPICS) - modules)
    assert not stale, f"CONSTANT_TOPICS names modules with no constant: {stale}"


def test_every_constant_topic_is_a_page_topic() -> None:
    topics = {topic for topic, _ in TOPICS}
    unknown = {m: t for m, t in CONSTANT_TOPICS.items() if t not in topics}
    assert not unknown, unknown
