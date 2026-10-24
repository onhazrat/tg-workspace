"""Every ADR has a row in `docs/adr/README.md`, and every row has an ADR.

The index was hand-kept and drifted: when the ADRs moved out of `docs/migration/`
on 2026-10-25, eight of the 35 (023, 024, 026, 027, 028, 032, 033, 034) had no
row, so a reader browsing the index never learned that ADR-024 had superseded
part of ADR-023. A missing row now fails here rather than in a reader's head.

The ADRs also live in exactly one folder. A branch cut before the move that adds
an ADR to `docs/migration/` fails the second test on its first rebase.
"""

import pathlib
import re

REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
ADR_DIR = REPO_ROOT / "docs" / "adr"

_ROW_LINK = re.compile(r"^\| \[ADR-\d{3}\]\(\./(ADR-\d{3}-[a-z0-9-]+\.md)\)", re.M)


def test_the_index_lists_every_adr_and_nothing_else() -> None:
    on_disk = {path.name for path in ADR_DIR.glob("ADR-*.md")}
    indexed = _ROW_LINK.findall((ADR_DIR / "README.md").read_text())

    assert on_disk, "found no ADRs; has docs/adr/ moved?"
    assert len(indexed) == len(set(indexed)), "an ADR has two rows in the index"
    assert on_disk - set(indexed) == set(), "ADRs with no row in docs/adr/README.md"
    assert set(indexed) - on_disk == set(), "index rows linking to no ADR"


def test_adrs_live_only_in_docs_adr() -> None:
    strays = sorted(
        str(path.relative_to(REPO_ROOT))
        for path in (REPO_ROOT / "docs").rglob("ADR-*.md")
        if path.parent != ADR_DIR
    )
    assert strays == [], "ADRs outside docs/adr/"
