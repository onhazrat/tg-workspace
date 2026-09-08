"""Synchronize ``.env.example`` and the runtime environment catalog.

The application has three places that declare environment variables:

* ``Settings`` fields in ``backend/app/core/config.py``;
* Vite/process environment reads in the frontend; and
* Compose interpolation.

This script discovers all three from source. The curated part of the example
remains the home of operational comments, deploy-ready values, and deliberate
default overrides. Missing variables are appended to a clearly marked generated
section. ``--check`` makes drift a CI/pre-commit failure.
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ENV_EXAMPLE = ROOT / ".env.example"
CATALOG = ROOT / "backend/app/core/env_catalog.generated.json"
FRONTEND_CATALOG = ROOT / "frontend/src/lib/env-catalog.generated.ts"
CONFIG_SOURCE = ROOT / "backend/app/core/config.py"
COMPOSE_SOURCES = (
    ROOT / "compose.yml",
    ROOT / "compose.override.yml",
    ROOT / "compose.traefik.yml",
)
GENERATED_MARKER = "# --- Auto-discovered variables (generated; do not reorder) ---"
SENSITIVE_NAMES = {
    "DEFAULT_PROXY_URLS",
    "TOR_SOCKS_PROXY",
}
SENSITIVE_SUFFIXES = ("_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_DSN")
VITE_BUILT_INS = {"BASE_URL", "DEV", "MODE", "PROD", "SSR"}


@dataclass(frozen=True)
class EnvSpec:
    name: str
    scope: str
    default: str | int | float | bool | None
    required: bool = False
    sensitive: bool = False


def _safe_eval(node: ast.expr) -> Any:
    """Evaluate the small constant-expression subset used by Settings defaults."""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
        value = _safe_eval(node.operand)
        return -value if isinstance(node.op, ast.USub) else value
    if isinstance(node, ast.BinOp):
        left, right = _safe_eval(node.left), _safe_eval(node.right)
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Div):
            return left / right
    raise ValueError("not a static scalar default")


def backend_specs() -> list[EnvSpec]:
    tree = ast.parse(CONFIG_SOURCE.read_text())
    settings_class = next(
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "Settings"
    )
    specs: list[EnvSpec] = []
    for node in settings_class.body:
        if not isinstance(node, ast.AnnAssign) or not isinstance(node.target, ast.Name):
            continue
        name = node.target.id
        if not name.isupper():
            continue
        required = node.value is None
        default: str | int | float | bool | None = None
        if node.value is not None:
            try:
                candidate = _safe_eval(node.value)
                if candidate is None or isinstance(candidate, (str, int, float, bool)):
                    default = candidate
            except (TypeError, ValueError):
                # Default factories (notably SECRET_KEY) are intentionally not
                # executed: generated examples must be stable and contain no secret.
                pass
        specs.append(
            EnvSpec(
                name=name,
                scope="backend_runtime",
                default=default,
                required=required,
                sensitive=is_sensitive(name),
            )
        )
    return specs


def frontend_source_paths() -> list[Path]:
    frontend = ROOT / "frontend"
    ignored_parts = {"dist", "node_modules"}
    return [
        path
        for path in frontend.rglob("*")
        if path.suffix in {".ts", ".tsx", ".js", ".mjs"}
        and path != FRONTEND_CATALOG
        and not ignored_parts.intersection(path.parts)
    ]


def frontend_names() -> set[str]:
    text = "\n".join(path.read_text() for path in frontend_source_paths())
    patterns = (
        r"import\.meta\.env\.([A-Z][A-Z0-9_]*)",
        r"viteEnv\?\.([A-Z][A-Z0-9_]*)",
        r"process\.env(?:\?\.)?\.([A-Z][A-Z0-9_]*)",
        r"process\.env\[(['\"])([A-Z][A-Z0-9_]*)\1\]",
    )
    names: set[str] = set()
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            names.add(match.group(2) if match.lastindex == 2 else match.group(1))
    return names - VITE_BUILT_INS


def frontend_defaults() -> dict[str, str | int | float | bool | None]:
    """Read fallbacks from the small ``parse*Env(viteEnv?.NAME, value)`` DSL."""
    text = (ROOT / "frontend/src/lib/env.ts").read_text()
    defaults: dict[str, str | int | float | bool | None] = {
        "VITE_API_KEY": "",
        "VITE_API_URL": "",
    }
    pattern = re.compile(
        r"viteEnv\?\.(VITE_[A-Z0-9_]+),\s*"
        r"((?:[0-9_]+(?:\s*\*\s*[0-9_]+)*)|(?:\"[^\"]*\"))",
        re.MULTILINE,
    )
    for match in pattern.finditer(text):
        name, expression = match.groups()
        try:
            value = ast.literal_eval(expression)
        except (SyntaxError, ValueError):
            try:
                value = _safe_eval(ast.parse(expression, mode="eval").body)
            except (SyntaxError, TypeError, ValueError):
                continue
        if value is None or isinstance(value, (str, int, float, bool)):
            defaults[name] = value
    return defaults


def python_environment_names() -> set[str]:
    """Discover direct ``os.environ`` reads outside the Settings model."""
    names: set[str] = set()
    for source_root in (ROOT / "backend", ROOT / "scripts"):
        for path in source_root.rglob("*.py"):
            try:
                tree = ast.parse(path.read_text())
            except (SyntaxError, UnicodeDecodeError):
                continue
            for node in ast.walk(tree):
                if isinstance(node, ast.Call) and node.args:
                    func = node.func
                    is_env_call = (
                        isinstance(func, ast.Attribute)
                        and func.attr in {"get", "getenv"}
                        and (
                            (
                                isinstance(func.value, ast.Attribute)
                                and isinstance(func.value.value, ast.Name)
                                and func.value.value.id == "os"
                                and func.value.attr == "environ"
                            )
                            or (
                                isinstance(func.value, ast.Name)
                                and func.value.id == "os"
                                and func.attr == "getenv"
                            )
                        )
                    )
                    if is_env_call and isinstance(node.args[0], ast.Constant):
                        name = node.args[0].value
                        if isinstance(name, str) and re.fullmatch(
                            r"[A-Z][A-Z0-9_]*", name
                        ):
                            names.add(name)
                if isinstance(node, ast.Subscript):
                    value = node.value
                    if not (
                        isinstance(value, ast.Attribute)
                        and isinstance(value.value, ast.Name)
                        and value.value.id == "os"
                        and value.attr == "environ"
                    ):
                        continue
                    key = node.slice
                    if (
                        isinstance(key, ast.Constant)
                        and isinstance(key.value, str)
                        and re.fullmatch(r"[A-Z][A-Z0-9_]*", key.value)
                    ):
                        names.add(key.value)
    return names


def compose_defaults() -> dict[str, str | None]:
    text = "\n".join(path.read_text() for path in COMPOSE_SOURCES)
    defaults: dict[str, str | None] = {}
    for match in re.finditer(
        r"\$\{([A-Z][A-Z0-9_]*)(?:(?::-|-)([^}?]*))?(?:\?[^}]*)?}", text
    ):
        name, default = match.group(1), match.group(2)
        defaults.setdefault(name, default if default not in (None, "") else None)
    return defaults


def is_sensitive(name: str) -> bool:
    return name in SENSITIVE_NAMES or name.endswith(SENSITIVE_SUFFIXES)


def discovered_specs() -> list[EnvSpec]:
    backend = backend_specs()
    by_name = {spec.name: spec for spec in backend}
    vite_defaults = frontend_defaults()
    for name in sorted(frontend_names()):
        by_name.setdefault(
            name,
            EnvSpec(
                name=name,
                scope="frontend_build" if name.startswith("VITE_") else "tooling",
                default=vite_defaults.get(name),
                # Every VITE_* value is public: Vite embeds it in the browser
                # bundle. Calling one secret here would promise protection the
                # build cannot provide.
                sensitive=is_sensitive(name) and not name.startswith("VITE_"),
            ),
        )
    for name, default in sorted(compose_defaults().items()):
        by_name.setdefault(
            name,
            EnvSpec(
                name=name,
                scope="compose",
                default=default,
                sensitive=is_sensitive(name),
            ),
        )
    for name in sorted(python_environment_names()):
        by_name.setdefault(
            name,
            EnvSpec(
                name=name,
                scope="tooling",
                default=None,
                sensitive=is_sensitive(name),
            ),
        )
    return sorted(by_name.values(), key=lambda spec: (spec.scope, spec.name))


def render_value(value: str | float | bool | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)


def synchronize_example(original: str, specs: list[EnvSpec]) -> str:
    lines = original.splitlines()
    present: set[str] = set()
    output: list[str] = []

    # A previous generated tail is rebuilt from discovery on every run.
    marker_index = next(
        (index for index, line in enumerate(lines) if line == GENERATED_MARKER),
        len(lines),
    )
    for line in lines[:marker_index]:
        # A commented assignment is deliberately documented but inactive.
        # Counting it prevents required Compose inputs such as Traefik's
        # USERNAME/HASHED_PASSWORD from being re-added as empty active values.
        match = re.match(r"^\s*(?:#\s*)?([A-Z][A-Z0-9_]*)=", line)
        if match:
            present.add(match.group(1))
        # Never rewrite curated values. The existing default guard owns
        # bool/int drift and its SKIP map owns intentional divergence.
        output.append(line)

    missing = [spec for spec in specs if spec.name not in present]
    while output and not output[-1].strip():
        output.pop()
    output.extend(["", "", GENERATED_MARKER])
    current_scope = ""
    for spec in missing:
        if spec.scope != current_scope:
            current_scope = spec.scope
            output.extend(["", f"# [{current_scope}]"])
        qualifier = "required" if spec.required else "optional"
        if spec.sensitive:
            qualifier += ", sensitive"
        output.append(f"# {qualifier}; discovered from source")
        output.append(f"{spec.name}={render_value(spec.default)}")
    output.append("")
    return "\n".join(output)


def render_catalog(specs: list[EnvSpec]) -> str:
    payload = {
        "generatedBy": "scripts/generate_env_example.py",
        "variables": [asdict(spec) for spec in specs],
    }
    return json.dumps(payload, indent=2, sort_keys=True) + "\n"


def render_frontend_catalog(specs: list[EnvSpec]) -> str:
    names = sorted(spec.name for spec in specs if spec.scope == "frontend_build")
    lines = [
        "// Generated by scripts/generate_env_example.py. Do not edit.",
        "// Explicit property reads let Vite replace every public build value.",
        "export const frontendBuildEnvironment: Readonly<Record<string, unknown>> = {",
    ]
    # Playwright loads shared frontend modules directly in Node, where
    # ``import.meta.env`` is absent. Optional access keeps that path safe while
    # retaining the explicit property reads Vite needs for build replacement.
    lines.extend(f'  "{name}": import.meta.env?.{name},' for name in names)
    lines.extend(["}", ""])
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check", action="store_true", help="fail if generated files are stale"
    )
    args = parser.parse_args()

    specs = discovered_specs()
    expected_example = synchronize_example(ENV_EXAMPLE.read_text(), specs)
    expected_catalog = render_catalog(specs)
    expected_frontend_catalog = render_frontend_catalog(specs)
    stale = []
    if ENV_EXAMPLE.read_text() != expected_example:
        stale.append(str(ENV_EXAMPLE.relative_to(ROOT)))
    if not CATALOG.exists() or CATALOG.read_text() != expected_catalog:
        stale.append(str(CATALOG.relative_to(ROOT)))
    if (
        not FRONTEND_CATALOG.exists()
        or FRONTEND_CATALOG.read_text() != expected_frontend_catalog
    ):
        stale.append(str(FRONTEND_CATALOG.relative_to(ROOT)))

    if args.check:
        if stale:
            sys.stderr.write(
                "Environment artifacts are stale: " + ", ".join(stale) + "\n"
            )
            sys.stderr.write("Run: python3 scripts/generate_env_example.py\n")
            return 1
        return 0

    ENV_EXAMPLE.write_text(expected_example)
    CATALOG.write_text(expected_catalog)
    FRONTEND_CATALOG.write_text(expected_frontend_catalog)
    sys.stdout.write(f"Synchronized {len(specs)} environment variables\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
