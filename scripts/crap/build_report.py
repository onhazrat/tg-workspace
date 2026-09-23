"""Print a CRAP summary and write the self-contained HTML report.

CRAP = cc^2 * (1 - cov)^3 + cc, per function; above 30 is the usual threshold.

Usage: python3 scripts/crap/build_report.py <backend.json> <frontend.json> <out.html>
         --commit SHA --backend-tests TEXT --backend-line-cov TEXT --frontend-tests TEXT
"""

import argparse
import datetime
import json
from pathlib import Path
from typing import Any

TEMPLATE = Path(__file__).with_name("report.template.html")
THRESHOLD = 30


def crap(r: dict[str, Any]) -> float:
    return float(r["cc"] ** 2 * (1 - r["cov"]) ** 3 + r["cc"])


def summarize(label: str, rows: list[dict[str, Any]]) -> None:
    scores = sorted(crap(r) for r in rows)
    bad = [r for r in rows if crap(r) > THRESHOLD]

    def p(q: float) -> float:
        return scores[int(q * (len(scores) - 1))]

    print(
        f"{label:9} {len(rows):5} functions  median {p(0.5):5.1f}  p90 {p(0.9):6.1f}  "
        f"p99 {p(0.99):7.0f}  max {scores[-1]:6.0f}  >{THRESHOLD}: {len(bad)} "
        f"({100 * len(bad) / len(rows):.1f}%), {sum(r['cc'] > THRESHOLD for r in bad)} too complex to test under"
    )
    for r in sorted(rows, key=crap, reverse=True)[:5]:
        print(
            f"    {crap(r):7.0f}  cc={r['cc']:3} cov={100 * r['cov']:3.0f}%  {r['file']}:{r['line']} {r['name']}"
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("backend")
    ap.add_argument("frontend")
    ap.add_argument("out")
    ap.add_argument("--commit", required=True)
    ap.add_argument("--backend-tests", required=True)
    ap.add_argument("--backend-line-cov", required=True)
    ap.add_argument("--frontend-tests", required=True)
    a = ap.parse_args()

    sides = [
        json.loads(Path(a.backend).read_text()),
        json.loads(Path(a.frontend).read_text()),
    ]
    summarize("backend", sides[0])
    summarize("frontend", sides[1])

    files: list[str] = []
    index: dict[str, int] = {}
    packed = []
    for side, rows in enumerate(sides):
        for r in rows:
            fi = index.setdefault(r["file"], len(files))
            if fi == len(files):
                files.append(r["file"])
            packed.append([side, fi, r["line"], r["name"], r["cc"], round(r["cov"], 3)])
    data = json.dumps({"files": files, "rows": packed}, separators=(",", ":"))

    html = TEMPLATE.read_text()
    for key, value in {
        "__DATA__": data,
        "__COMMIT__": a.commit,
        "__DATE__": datetime.datetime.now(datetime.UTC).date().isoformat(),
        "__BACKEND_TESTS__": a.backend_tests,
        "__BACKEND_LINE_COV__": a.backend_line_cov,
        "__FRONTEND_TESTS__": a.frontend_tests,
    }.items():
        assert key in html, f"template lost its {key} placeholder"
        html = html.replace(key, value)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(f"report: {out}")


if __name__ == "__main__":
    main()
