#!/usr/bin/env python3
"""Build the citation pairs and counts from the stored References (DIR-05, ADR-028).

    uv run python backend/scripts/backfill_citation_pairs.py

The migration creates `tg_citation_pairs` and `tg_citation_counts` empty; the
References writer keeps both current after that, so this runs once after the
deploy that carries DIR-05. It walks the References by citing handle and then
the pairs by handle, one transaction per batch, and overwrites rather than
adds, so an interrupted run can simply be started again and a re-run changes
nothing. Beside a live worker, a Reference written in the middle of a batch
can leave one count short; a second run settles it.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from sqlalchemy import func
from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import CitationCount, CitationPair
from app.services.post_references import fill_citations

logger = logging.getLogger("backfill_citation_pairs")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--batch-size", type=int, default=2000, help="handles per transaction"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    started = time.monotonic()
    with Session(engine) as session:
        fill_citations(session, batch=args.batch_size)
        pairs = session.exec(select(func.count()).select_from(CitationPair)).one()
        counts = session.exec(select(func.count()).select_from(CitationCount)).one()
    logger.info(
        "%d citation pairs, %d handles counted, in %.0fs",
        pairs,
        counts,
        time.monotonic() - started,
    )


if __name__ == "__main__":
    main()
