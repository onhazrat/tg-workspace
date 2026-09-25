"""The CRAP ratchet: no function may get riskier than it is today.

CRAP = cc^2 * (1 - cov)^3 + cc. Above THRESHOLD a function is too complex for
the tests it has. The ratchet fails when

  (a) a function missing from the baseline scores above THRESHOLD,
  (b) a baseline function scores more than TOLERANCE above its recorded score,
  (c) a baseline entry names no function scoring above THRESHOLD any more,
  (d) a baseline entry has no reason, or
  (e) a baseline function scores more than TOLERANCE below its recorded score.

(e) keeps the recorded score tight. Without it a function that improved could
slide back up to its old score and pass.

(c) is the same rule as the PROBED inventory in test_account_isolation.py: an
exception nothing exercises is a leftover, and a leftover here is headroom a
function could regress into without anybody noticing. A function that improved,
was renamed or was deleted takes its entry with it.

A function is keyed by file and qualified name, never by line, because lines move
on every edit. A name that occurs more than once in a file (two
`<arg of useCallback>` closures in one component) is numbered in source order:
the first keeps the bare name, the later ones get `#2`, `#3`. Anonymous closures
stay in the gate rather than being excused, because on the frontend they hold
most of the logic. Inserting a same-named closure above a baseline entry
renumbers it, which fails loudly as (a) plus (c) and never silently.

Usage:
  python3 scripts/crap/ratchet.py check  <rows.json> [<rows.json>]
  python3 scripts/crap/ratchet.py update <rows.json> [<rows.json>]

Each rows file is backend_crap.py's or frontend_crap.ts's output. Only the
baseline entries under a side whose rows were given are checked, so the backend
job never judges frontend entries. `update` rewrites the baseline from the rows,
keeps every surviving reason, and exits 1 while any entry still lacks one.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

BASELINE = Path(__file__).with_name("baseline.json")
THRESHOLD = 30.0
# Coverage is re-measured on every run, and a timing-dependent line can flip.
# The largest such step among today's entries is one statement of
# fetch_with_retry (68 statements, cc 35): +0.49. The smallest real regression
# is one more branch, and a unit of cc adds at least 1.0 to the score. 0.75 sits
# between the two: it absorbs one flipped line and still fails a second line or
# a new branch, including on compute_discover_candidates, whose 100% coverage
# leaves nothing but its cc to regress. It is symmetric: one flipped line the
# other way is noise too, and a real gain beyond it must be recorded (rule e).
TOLERANCE = 0.75
FIX = (
    "Fix it by adding tests that run it or by splitting it to cut its complexity. "
    "Only with a reason, record it: bash scripts/crap/run.sh --update-baseline, "
    "then write the reason into scripts/crap/baseline.json."
)


def crap(cc: int, cov: float) -> float:
    return cc**2 * (1 - cov) ** 3 + cc


def keyed(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Map `file::name` (plus `#n` for a repeated name) to its row."""
    seen: Counter[tuple[str, str]] = Counter()
    out: dict[str, dict[str, Any]] = {}
    for r in sorted(rows, key=lambda r: (r["file"], r["line"], r["name"])):
        seen[r["file"], r["name"]] += 1
        n = seen[r["file"], r["name"]]
        out[f"{r['file']}::{r['name']}" + (f"#{n}" if n > 1 else "")] = r
    return out


def _describe(key: str, r: dict[str, Any]) -> str:
    score = crap(r["cc"], r["cov"])
    return f"{key} (line {r['line']}): CRAP {score:.1f}, cc {r['cc']}, coverage {100 * r['cov']:.0f}%"


def check(
    rows: list[dict[str, Any]], baseline: dict[str, dict[str, Any]], sides: set[str]
) -> list[str]:
    """Return the failures for the baseline entries under `sides`."""
    fns = keyed(rows)
    mine = {k: v for k, v in baseline.items() if k.split("/", 1)[0] in sides}
    failures: list[str] = []
    for key, r in fns.items():
        score = crap(r["cc"], r["cov"])
        if score <= THRESHOLD:
            continue
        entry = mine.get(key)
        if entry is None:
            failures.append(
                f"(a) new: {_describe(key, r)} is above {THRESHOLD:g}. {FIX}"
            )
        elif score > entry["score"] + TOLERANCE:
            failures.append(
                f"(b) rose: {_describe(key, r)} is above its recorded {entry['score']} "
                f"by more than {TOLERANCE:g}. Restore the tests or complexity it lost; "
                "raise the recorded score only with a reason."
            )
        elif score < entry["score"] - TOLERANCE:
            failures.append(
                f"(e) improved: {_describe(key, r)} is below its recorded "
                f"{entry['score']} by more than {TOLERANCE:g}. Run "
                "bash scripts/crap/run.sh --update-baseline to lock in the gain."
            )
    for key, entry in sorted(mine.items()):
        found = fns.get(key)
        if found is None or crap(found["cc"], found["cov"]) <= THRESHOLD:
            now = (
                "no longer exists"
                if found is None
                else f"now scores {crap(found['cc'], found['cov']):.1f}"
            )
            failures.append(
                f"(c) stale: {key} is in the baseline at {entry['score']} but {now}. "
                "Delete the entry (or run --update-baseline) so the baseline shrinks."
            )
        if not str(entry.get("reason", "")).strip():
            failures.append(
                f"(d) no reason: {key} needs a one-line reason in {BASELINE.name}."
            )
    return failures


def update(
    rows: list[dict[str, Any]], baseline: dict[str, dict[str, Any]], sides: set[str]
) -> dict[str, dict[str, Any]]:
    """The baseline these rows would pass, keeping reasons and other sides' entries."""
    out = {k: v for k, v in baseline.items() if k.split("/", 1)[0] not in sides}
    for key, r in keyed(rows).items():
        score = crap(r["cc"], r["cov"])
        if score > THRESHOLD:
            reason = baseline.get(key, {}).get("reason", "")
            out[key] = {"score": round(score, 2), "reason": reason}
    return dict(sorted(out.items()))


def _load_rows(paths: list[str]) -> tuple[list[dict[str, Any]], set[str]]:
    rows: list[dict[str, Any]] = []
    for p in paths:
        rows += json.loads(Path(p).read_text())
    return rows, {r["file"].split("/", 1)[0] for r in rows}


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in ("check", "update"):
        print(__doc__, file=sys.stderr)
        return 2
    rows, sides = _load_rows(argv[1:])
    baseline = json.loads(BASELINE.read_text())
    if argv[0] == "update":
        new = update(rows, baseline, sides)
        BASELINE.write_text(json.dumps(new, indent=2) + "\n")
        missing = [k for k, v in new.items() if not v["reason"].strip()]
        for k in missing:
            print(f"write a one-line reason for {k} in {BASELINE}", file=sys.stderr)
        print(f"baseline: {len(new)} entries")
        return 1 if missing else 0
    failures = check(rows, baseline, sides)
    for f in failures:
        print(f"CRAP ratchet {f}", file=sys.stderr)
    checked = sum(k.split("/", 1)[0] in sides for k in baseline)
    print(
        f"CRAP ratchet ({', '.join(sorted(sides))}): {len(rows)} functions, "
        f"{checked} baseline entries, {len(failures)} failures"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
