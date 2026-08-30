"""`.env.example` must not quietly disagree with the code's own defaults.

Found by review of ticket 21 PR 4, where the instance was as bad as the class
gets: `config.py` moved `TENANCY_ENFORCED` to `True` and `.env.example` went on
shipping `TENANCY_ENFORCED=false`. CLAUDE.md says that file documents every
tunable, and it is what a root `.env` is built from — so a fresh install, or any
redeploy that regenerates `.env` from the template, would have run with
enforcement **off** while every test in the suite passed.

Nothing caught it, and the reason is worth keeping. `test_the_flag_ships_on`
deliberately reads `model_fields[...].default` rather than the resolved
`settings.TENANCY_ENFORCED`, because the suite is run in both flag states and
asserting the resolved value would fail the rollback rehearsal. Every probe in
`test_account_isolation.py` pins the flag on for the same reason. So the
resolved configuration went unasserted in both directions, and the one file that
decides it for a real deployment was outside the suite entirely.

## Booleans only, and that is the whole point

A general "every key matches its default" guard would be noise: most of this
file is placeholders (`changethis`), hostnames and keys that are *meant* to
differ per deployment. A boolean is the opposite — it is a switch whose two
values are both valid configurations, so a mismatch does not look wrong
anywhere. It changes behaviour silently, which is exactly the failure above.

`SKIP` names the booleans that are deliberately different, each with a reason.
An unlisted disagreement fails.
"""

from __future__ import annotations

import pathlib

import pytest

from app.core.config import Settings

#: Booleans the template deliberately sets against the code default.
#:
#: Empty today. Kept as an explicit mapping rather than deleted so the next
#: deliberate divergence lands with a reason attached, instead of somebody
#: loosening the assertion.
SKIP: dict[str, str] = {}


def _env_example() -> dict[str, str]:
    path = pathlib.Path(__file__).resolve().parents[3] / ".env.example"
    assert path.exists(), (
        f"{path} is missing — this guard is looking in the wrong place"
    )

    values: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _boolean_fields() -> dict[str, bool]:
    from pydantic_core import PydanticUndefined

    out: dict[str, bool] = {}
    for name, field in Settings.model_fields.items():
        if field.annotation is bool and field.default is not PydanticUndefined:
            out[name] = bool(field.default)
    return out


def test_the_example_has_the_keys_this_guard_is_about() -> None:
    """A guard that finds nothing passes for the wrong reason.

    If `.env.example` is ever reformatted past this parser, every comparison
    below becomes vacuous and green. This is the check that it did not.
    """
    example = _env_example()
    booleans = _boolean_fields()

    assert booleans, "no boolean settings found — the field walk is broken"
    overlap = set(example) & set(booleans)
    assert overlap, (
        "no boolean setting appears in .env.example at all, which means the "
        "parser found nothing rather than that everything agrees"
    )
    assert "TENANCY_ENFORCED" in overlap, (
        "the setting this guard was written for is not being compared"
    )


def test_every_boolean_in_the_example_matches_the_code_default() -> None:
    """The template ships what the code ships, or says why not."""
    example = _env_example()
    booleans = _boolean_fields()

    truthy = {"1", "true", "yes", "on"}
    mismatches: list[str] = []
    for key, default in booleans.items():
        if key not in example or key in SKIP:
            continue
        shipped = example[key].lower() in truthy
        if shipped != default:
            mismatches.append(
                f"{key}: .env.example says {example[key]!r}, config.py "
                f"defaults to {default}"
            )

    assert not mismatches, (
        "the deployment template disagrees with the code:\n  "
        + "\n  ".join(mismatches)
        + "\n\nA deployment built from the template runs the template's value, "
        "so this is a live behaviour difference that no other test can see. "
        "Fix the template, or add the key to SKIP with the reason it differs."
    )


@pytest.mark.parametrize("key", sorted(SKIP))
def test_every_skip_still_names_a_real_setting(key: str) -> None:
    """A skip for a setting that no longer exists is an exemption nothing
    explains — the shape the guard table's preamble warns about."""
    assert key in _boolean_fields(), (
        f"{key} is in SKIP but is not a boolean setting any more"
    )
    assert len(SKIP[key].strip()) >= 8, f"{key}'s reason does not explain itself"
