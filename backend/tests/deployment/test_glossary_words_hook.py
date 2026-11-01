"""The pre-commit check that keeps GLOSSARY.md's checked words out of code."""

from __future__ import annotations

import importlib.util
import pathlib

_ROOT = pathlib.Path(__file__).resolve().parents[3]
_spec = importlib.util.spec_from_file_location(
    "check_glossary_words", _ROOT / "scripts/check_glossary_words.py"
)
assert _spec is not None and _spec.loader is not None
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)

#: The checked words, built in pieces so this file never holds one.
LAG, JU = "lag" + "ging", "ju"

GLOSSARY = """\
**Behind**:
Routine lag.
_Avoid_: stale, <lag>, <ju>st synced
_Checked_: <lag>, <ju>st synced

**Left out**:
_Avoid_: excluded
""".replace("<lag>", LAG).replace("<ju>st", JU + "st")

DIFF = (
    """\
diff --git a/backend/app/x.py b/backend/app/x.py
--- a/backend/app/x.py
+++ b/backend/app/x.py
@@ -1,2 +1,5 @@
-<LAG> = 1
+<LAG> = 1
+if is<Ju>Synced(c): pass
+stale = excluded = flagging = 0
 <lag>_context = 0
+cg_<lag> = 2
diff --git a/docs/adr/ADR-1.md b/docs/adr/ADR-1.md
--- /dev/null
+++ b/docs/adr/ADR-1.md
@@ -0,0 +1 @@
+Avoid "<lag>" here.
""".replace("<LAG>", LAG.upper())
    .replace("<lag>", LAG)
    .replace("<Ju>", JU.title() + "st")
)


def test_checked_words_come_from_the_checked_line_only() -> None:
    assert hook.checked(GLOSSARY) == {LAG: "Behind", f"{JU}st synced": "Behind"}


def test_an_added_code_line_fails_in_any_identifier_style() -> None:
    assert hook.offenders(DIFF, hook.checked(GLOSSARY)) == [
        f'backend/app/x.py:1: "{LAG}" (say Behind)',
        f'backend/app/x.py:2: "{JU}st synced" (say Behind)',
        f'backend/app/x.py:5: "{LAG}" (say Behind)',
    ]


def test_the_real_glossary_checks_words_no_code_uses_today() -> None:
    phrases = hook.checked((_ROOT / "GLOSSARY.md").read_text())
    assert LAG in phrases
    assert "stale" not in phrases
