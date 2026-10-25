"""The pre-commit check that fails a Playwright spec naming a test id nothing renders.

Renaming a test id in `frontend/src` breaks the e2e specs that name it, which
the commit never touches and which run only in CI. These pin how an id
resolves: as a quoted string in the app's source, or through a template given
as a test id, whose leading placeholder names a prefix that itself renders.
"""

from __future__ import annotations

import importlib.util
import pathlib

_SCRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts/check_test_ids.py"
_spec = importlib.util.spec_from_file_location("check_test_ids", _SCRIPT)
assert _spec is not None and _spec.loader is not None
check_test_ids = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_test_ids)

SOURCE = """
<TgButton data-testid="directory-bound-submit" />
export function Spread({ testId = "spread" }) {}
<div data-testid={`${testId}-bar-${i}`} />
<Spread testId="requests-spread" />
<div
  data-testid={
    `row-${kind}`
  }
/>
<FacetMenu testId={`post-filter-${facet}`} />
<div data-testid={`${testId}-funnel-${row.id}`} />
const option = { "data-testid": `history-kind-${k}` }
"""


def _offenders(spec: str) -> list[str]:
    return check_test_ids.offenders({"frontend/tests/x.spec.ts": spec}, SOURCE)


def test_an_id_resolves_as_a_string_or_through_a_template() -> None:
    assert (
        _offenders(
            'page.getByTestId("directory-bound-submit")\n'
            "page.getByTestId('spread-bar-1')\n"
            "page.getByTestId(`requests-spread-bar-30`)\n"
        )
        == []
    )


def test_a_renamed_id_is_flagged_though_a_template_could_spell_it() -> None:
    # `${testId}-bar-${i}` matches it, but nothing names "directory-bound".
    assert _offenders(
        'await page.getByTestId("spread-bar-1").click()\n'
        'await page.getByTestId("directory-bound-bar-1").click()\n'
    ) == ["frontend/tests/x.spec.ts:2: directory-bound-bar-1"]


def test_a_placeholder_after_the_prefix_holds_data() -> None:
    assert (
        _offenders(
            'getByTestId("row-a1")\n'
            'getByTestId("history-kind-summary")\n'
            # A prefix that is itself a template given as a testId prop.
            'getByTestId("post-filter-media-funnel-photo")\n'
        )
        == []
    )
    assert _offenders('getByTestId("rows-a1")') == [
        "frontend/tests/x.spec.ts:1: rows-a1"
    ]


def test_an_id_built_in_the_spec_is_left_to_the_spec() -> None:
    assert _offenders("getByTestId(chart)\ngetByTestId(/^requests-spread-bar-/)") == []
