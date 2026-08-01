"""Every response-model alias must match what the serialisers actually emit.

The wire format is camelCase, but `services/serialization.py` does not derive it
mechanically: `_CAMEL_OVERRIDES` renames a couple of dozen columns explicitly,
and two of them are not camelisations of the column name at all —
`model_config_json` ships as **`modelConfig`** and `log_type` ships as
**`type`**.

Guessing wrong is silent and destructive. A response model that declares
`alias="modelConfigJson"` does not fail: it simply matches nothing on the way
in, defaults the field to `None`, and then *renames the key* on the way out. The
endpoint keeps returning 200 while dropping a column's value and emitting a key
no client has ever seen. That happened while writing B5 and was caught only
because a value assertion sat next to the key-set assertion.

This test makes the override table authoritative for every response model, so
the next family cannot reintroduce it. It is deliberately a whole-package sweep
rather than a per-model check — the point is that new modules are covered the
moment they are added, without anyone remembering to opt in.
"""

from __future__ import annotations

import importlib
import pkgutil

from pydantic import BaseModel

import app.schemas
from app.services.serialization import to_camel

#: Fields whose wire name legitimately differs from `to_camel(field_name)`.
#:
#: The escape hatch exists because `to_camel` describes how *database columns*
#: are serialised. A response model field that is not a column is not governed
#: by it, and for those this test would be wrong rather than the model.
#:
#: Everything here is one case: `JobsStatusResponse`'s keys are **job ids** from
#: `app.jobs.settings.JOB_IDS`, not columns. `auto_sync` is the identifier
#: itself, snake_case by design, and the frontend reads it that way
#: (`App.tsx` → `status.auto_sync?.pauseUntil`). Camelising them would break the
#: client and desynchronise the response from `JOB_IDS`.
#:
#: Add an entry only for a field that genuinely is not a column, with a comment.
EXEMPT: set[tuple[str, str]] = {
    ("JobsStatusResponse", "auto_sync"),
    ("JobsStatusResponse", "auto_summary"),
    ("JobsStatusResponse", "translation_batch"),
}


def _response_models() -> list[type[BaseModel]]:
    """Every Pydantic model declared under `app.schemas`, imported fresh."""
    found: list[type[BaseModel]] = []
    for info in pkgutil.iter_modules(app.schemas.__path__):
        module = importlib.import_module(f"app.schemas.{info.name}")
        for name in dir(module):
            obj = getattr(module, name)
            if (
                isinstance(obj, type)
                and issubclass(obj, BaseModel)
                and obj is not BaseModel
                and obj.__module__ == module.__name__
            ):
                found.append(obj)
    return found


def test_the_sweep_actually_finds_the_schema_modules() -> None:
    """Guards the guard: a broken import would make every assertion vacuous."""
    models = _response_models()
    assert len(models) > 40, f"only found {len(models)} models — sweep is broken"
    names = {m.__name__ for m in models}
    # One representative from each family converted so far.
    assert {
        "SummaryResponse",
        "ChannelResponse",
        "PostResponse",
        "DiscoverCandidateResponse",
        "LLMLogResponse",
        "DbStatsResponse",
    } <= names


def test_every_alias_matches_the_serialiser() -> None:
    mismatches: list[str] = []
    for model in _response_models():
        for field_name, field in model.model_fields.items():
            if (model.__name__, field_name) in EXEMPT:
                continue
            declared = field.alias or field_name
            expected = to_camel(field_name)
            if declared != expected:
                mismatches.append(
                    f"{model.__module__}.{model.__name__}.{field_name}: "
                    f"declared {declared!r}, serialiser emits {expected!r}"
                )
    assert not mismatches, "alias mismatches:\n  " + "\n  ".join(mismatches)
