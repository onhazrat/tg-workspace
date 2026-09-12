"""Expensive post-merge work follows runtime inputs, not the event alone.

The Playwright workflow already classifies the files changed by both pull
requests and pushes.  A historical fetch workaround overwrote that answer for
every push, so a two-Markdown-file merge built two images and ran four browser
shards even though the classifier had correctly returned ``false``.

Keep the classifier authoritative and make its failure visible in the required
summary job.  Staging has no cheap classifier job, so its push trigger carries
the exact set of files consumed by the Compose deployment.  ``workflow_dispatch``
remains the operator escape hatch when staging must be refreshed manually.
"""

from __future__ import annotations

import pathlib
from typing import Any

import yaml

_ROOT = pathlib.Path(__file__).resolve().parents[3]
_WORKFLOWS = _ROOT / ".github" / "workflows"

STAGING_DEPLOY_INPUTS = {
    ".dockerignore",
    ".github/workflows/deploy-staging.yml",
    "backend/**",
    "bun.lock",
    "compose.yml",
    "frontend/**",
    "package.json",
    "pyproject.toml",
    "scripts/postgres-init/**",
    "uv.lock",
}


def _workflow(name: str) -> dict[str, Any]:
    parsed = yaml.load((_WORKFLOWS / name).read_text(), Loader=yaml.BaseLoader)
    assert isinstance(parsed, dict), f"{name} is not a workflow mapping"
    return parsed


def test_playwright_uses_the_file_classifier_for_main_pushes() -> None:
    workflow = _workflow("playwright.yml")
    changes = workflow["jobs"]["changes"]

    assert changes["outputs"]["changed"] == "${{ steps.filter.outputs.changed }}", (
        "Playwright is overriding its file classifier; docs-only main pushes will "
        "build images and run every browser shard"
    )
    assert all(
        step.get("name") != "Treat push as changed" for step in changes["steps"]
    ), "the historical push override has returned"


def test_a_classifier_failure_fails_the_playwright_summary() -> None:
    workflow = _workflow("playwright.yml")
    summary = workflow["jobs"]["alls-green-playwright"]

    assert "changes" in summary["needs"], (
        "the required Playwright summary cannot see a failed classifier"
    )
    allowed_skips = {
        job.strip() for job in summary["steps"][0]["with"]["allowed-skips"].split(",")
    }
    assert "changes" not in allowed_skips, (
        "a failed classifier may silently skip the suite and still report green"
    )


def test_staging_pushes_only_follow_deployment_inputs() -> None:
    workflow = _workflow("deploy-staging.yml")
    push_paths = set(workflow["on"]["push"]["paths"])

    assert "workflow_dispatch" in workflow["on"], (
        "staging lost its manual recovery path"
    )
    assert push_paths == STAGING_DEPLOY_INPUTS, (
        "staging's trigger drifted from the files its Compose deployment consumes: "
        f"missing={sorted(STAGING_DEPLOY_INPUTS - push_paths)}, "
        f"unexpected={sorted(push_paths - STAGING_DEPLOY_INPUTS)}"
    )
