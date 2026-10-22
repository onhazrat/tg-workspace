"""The pre-commit check that keeps em dashes out of added lines.

Old lines keep theirs until somebody edits them: the hook reads the staged
diff, so only a line a commit adds or rewrites has to change.
"""

from __future__ import annotations

import importlib.util
import pathlib

_SCRIPT = pathlib.Path(__file__).resolve().parents[3] / "scripts/check_em_dashes.py"
_spec = importlib.util.spec_from_file_location("check_em_dashes", _SCRIPT)
assert _spec is not None and _spec.loader is not None
check_em_dashes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_em_dashes)

#: The character itself, built so this file never holds one.
DASH = chr(0x2014)

DIFF = """\
diff --git a/backend/app/x.py b/backend/app/x.py
--- a/backend/app/x.py
+++ b/backend/app/x.py
@@ -1,2 +1,2 @@
-# an old line <dash> removed
+# a new line <dash> added
 # context <dash> untouched
+# a clean line
diff --git a/frontend/src/client/types.gen.ts b/frontend/src/client/types.gen.ts
--- a/frontend/src/client/types.gen.ts
+++ b/frontend/src/client/types.gen.ts
@@ -1 +1 @@
+ * generated <dash> never ours to rewrite
diff --git a/docs/new.md b/docs/new.md
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1 @@
+A new doc <dash> with a dash.
""".replace("<dash>", DASH)


def test_only_added_lines_in_our_own_files_are_flagged() -> None:
    assert check_em_dashes.offenders(DIFF) == [
        f"backend/app/x.py:1: # a new line {DASH} added",
        f"docs/new.md:1: A new doc {DASH} with a dash.",
    ]


def test_a_diff_with_no_em_dash_passes() -> None:
    assert check_em_dashes.offenders(DIFF.replace(DASH, "-")) == []
