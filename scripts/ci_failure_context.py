"""Every failed or flaky Playwright test of a CI run, with its error and page snapshot.

    python3 scripts/ci_failure_context.py <run-id>

Downloads the run's `blob-report-*` artifacts into `.scratch-local/ci-<run-id>/`,
then prints, per failed attempt, the test, its status and attempt, the error
without colour codes, and where its `error-context.md` (the page snapshot at
the failure) and trace landed. A test that failed and then passed is flaky,
which still fails CI (`--fail-on-flaky-tests`).

Reading this by hand took eight tool calls on PR #227: list the artifacts,
download, unzip twice, find the attachment in `report.jsonl`, grep the trace.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
GH_REPO = "onhazrat/tg-workspace"
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def titles(suites: list[dict], trail: tuple[str, ...] = ()) -> dict[str, str]:
    """testId -> `file:line › describe › test` from an `onProject` suite tree."""
    found: dict[str, str] = {}
    for suite in suites:
        here = trail + ((suite["title"],) if suite.get("title") else ())
        for entry in suite.get("entries", []):
            if "testId" in entry:
                where = f"{entry['location']['file']}:{entry['location']['line']}"
                found[entry["testId"]] = " › ".join((where, *here[1:], entry["title"]))
            else:
                found.update(titles([entry], here))
    return found


def failures(report: Path) -> list[str]:
    """One block of text per failed attempt in one shard's `report.jsonl`."""
    names: dict[str, str] = {}
    attempts: dict[str, list[str]] = {}
    attached: dict[str, list[str]] = {}
    blocks: list[str] = []
    for line in report.read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        if event["method"] == "onProject":
            names.update(titles(event["params"]["project"]["suites"]))
        # A blob report sends attachments as their own events, before the end.
        if event["method"] == "onAttach":
            attached.setdefault(event["params"]["resultId"], []).extend(
                str(report.parent / a["path"])
                for a in event["params"]["attachments"]
                if a.get("path") and a["name"] in ("error-context", "trace")
            )
        if event["method"] != "onTestEnd":
            continue
        test_id = event["params"]["test"]["testId"]
        result = event["params"]["result"]
        attempts.setdefault(test_id, []).append(result["status"])
        if result["status"] in ("passed", "skipped"):
            continue
        error = _ANSI.sub("", "\n".join(e["message"] for e in result["errors"]))
        files = attached.get(result["id"], [])
        attempt = len(attempts[test_id])
        blocks.append(
            f"## {names.get(test_id, test_id)}\n"
            f"{result['status']}, attempt {attempt}\n\n"
            + "\n".join(error.splitlines()[:15])
            + "".join(f"\n-> {f}" for f in files)
        )
    flaky = [
        names.get(t, t) for t, s in attempts.items() if s[-1] == "passed" and len(s) > 1
    ]
    blocks.extend(f"FLAKY (failed, then passed on retry): {name}" for name in flaky)
    return blocks


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        sys.stderr.write(__doc__ or "")
        return 2
    run = argv[1]
    out = REPO / ".scratch-local" / f"ci-{run}"
    # `gh run download` refuses to overwrite, so a second look reuses the first.
    if not out.exists():
        out.mkdir(parents=True)
        subprocess.run(
            ["gh", "run", "download", run, "--repo", GH_REPO, "-p", "blob-report-*"],
            cwd=out,
            check=True,
        )
    blocks: list[str] = []
    for archive in sorted(out.glob("blob-report-*/*.zip")):
        shard = archive.parent / "unzipped"
        with zipfile.ZipFile(archive) as z:
            z.extractall(shard)
        for report in shard.glob("*.jsonl"):
            blocks.extend(failures(report))
    print("\n\n".join(blocks) if blocks else f"No failed attempts in run {run}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
