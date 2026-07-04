#!/usr/bin/env python3
"""Capture Telegram web-view HTML for post-media investigation fixtures.

Dev/investigation only — not wired into the sync pipeline.

Examples:
  uv run python scripts/capture_scrape_html.py --channels durov,ReutersWorldChannel
  uv run python scripts/capture_scrape_html.py --posts durov/123
  uv run python scripts/capture_scrape_html.py --urls 'https://t.me/s/durov?before=100'
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from bs4 import BeautifulSoup
from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

from app.core.config import settings
from app.services.network import fetch_with_retry

DEFAULT_OUTPUT_DIR = _REPO_ROOT / "backend" / "tests" / "fixtures" / "live"

_MEDIA_SELECTORS: dict[str, str] = {
    "photo": ".tgme_widget_message_photo_wrap",
    "video": ".tgme_widget_message_video_player",
    "voice": ".tgme_widget_message_voice",
    "document": ".tgme_widget_message_document",
    "poll": ".tgme_widget_message_poll_question",
    "link_preview": ".tgme_widget_message_link_preview",
    "grouped": ".tgme_widget_message_grouped_wrap",
}


def _resolve_proxies() -> list[str]:
    proxies = list(settings.default_proxies)
    if settings.TOR_ENABLED:
        tor = settings.TOR_SOCKS_PROXY
        if tor not in proxies:
            proxies.append(tor)
    return proxies


def _normalize_channel(name: str) -> str:
    return name.strip().lstrip("@")


def _channel_root_url(channel: str) -> str:
    return f"https://t.me/s/{_normalize_channel(channel)}"


def _post_url(channel: str, post_id: str | int) -> str:
    return f"https://t.me/s/{_normalize_channel(channel)}/{post_id}"


def _attr_str(value: str | list[str] | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _extract_post_ids(html: str) -> list[int]:
    soup = BeautifulSoup(html, "html.parser")
    ids: set[int] = set()
    for el in soup.select(".tgme_widget_message"):
        data_post = _attr_str(el.get("data-post"))
        post_id: int | None = None
        if data_post:
            tail = data_post.rsplit("/", 1)[-1]
            if tail.isdigit():
                post_id = int(tail)
        if post_id is None:
            date_link = el.select_one(".tgme_widget_message_date")
            href = _attr_str(date_link.get("href") if date_link else None)
            if href:
                match = re.search(r"/(\d+)$", href)
                if match:
                    post_id = int(match.group(1))
        if post_id is not None:
            ids.add(post_id)
    return sorted(ids)


def _classify_message(el: Any) -> dict[str, Any]:
    kinds = [kind for kind, sel in _MEDIA_SELECTORS.items() if el.select_one(sel)]
    has_caption = bool(el.select_one(".tgme_widget_message_text"))
    data_post = _attr_str(el.get("data-post")) or ""
    channel, _, post_id_str = data_post.partition("/")
    post_id = int(post_id_str) if post_id_str.isdigit() else None
    return {
        "channel": channel or None,
        "post_id": post_id,
        "kinds": kinds,
        "has_caption": has_caption,
    }


def _scan_media_in_html(html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(html, "html.parser")
    return [_classify_message(el) for el in soup.select(".tgme_widget_message")]


def _basename_for_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.rstrip("/")
    parts = [p for p in path.split("/") if p]

    if len(parts) >= 3 and parts[0] == "s":
        channel = parts[1]
        if parts[2].isdigit():
            return f"{channel}_{parts[2]}"
        before = parse_qs(parsed.query).get("before", [None])[0]
        if before and before.isdigit():
            return f"{channel}_{before}"
        return f"{channel}_root"

    if len(parts) == 2 and parts[0] == "s":
        channel = parts[1]
        before = parse_qs(parsed.query).get("before", [None])[0]
        if before and before.isdigit():
            return f"{channel}_{before}"
        return f"{channel}_root"

    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", url)[:120]
    return safe or "capture"


def _write_sidecar(
    *,
    output_dir: Path,
    basename: str,
    url: str,
    html: str,
    status: str,
    telemetry: dict[str, Any],
    error: str | None = None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    html_path = output_dir / f"{basename}.html"
    meta_path = output_dir / f"{basename}.meta.json"
    html_path.write_text(html if isinstance(html, str) else "", encoding="utf-8")
    meta = {
        "url": url,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "post_ids_found": _extract_post_ids(html) if html else [],
        "media_scan": _scan_media_in_html(html) if html else [],
        "telemetry": telemetry,
    }
    if error:
        meta["error"] = error
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return html_path


async def _fetch_and_save(
    *,
    url: str,
    output_dir: Path,
    basename: str | None = None,
    proxies: list[str],
) -> dict[str, Any]:
    stem = basename or _basename_for_url(url)
    try:
        html, telemetry = await fetch_with_retry(
            url,
            proxies=proxies or None,
            tor_auto_rotate=settings.TOR_ENABLED,
        )
        path = _write_sidecar(
            output_dir=output_dir,
            basename=stem,
            url=url,
            html=html,
            status="ok",
            telemetry=telemetry,
        )
        return {"url": url, "basename": stem, "path": str(path), "status": "ok"}
    except Exception as exc:  # noqa: BLE001
        telemetry = getattr(exc, "telemetry", {"success": False, "error": str(exc)})
        _write_sidecar(
            output_dir=output_dir,
            basename=stem,
            url=url,
            html="",
            status="error",
            telemetry=telemetry,
            error=str(exc),
        )
        return {"url": url, "basename": stem, "status": "error", "error": str(exc)}


def _parse_csv(raw: str | None) -> list[str]:
    if not raw:
        return []
    return [item.strip() for item in raw.split(",") if item.strip()]


def _parse_posts(raw: str | None) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    for token in _parse_csv(raw):
        if "/" not in token:
            print(f"WARNING: skipping invalid --posts entry (need channel/id): {token}")
            continue
        channel, post_id = token.split("/", 1)
        items.append((channel, post_id))
    return items


def _coverage_from_meta_files(output_dir: Path) -> dict[str, list[str]]:
    coverage: dict[str, list[str]] = {kind: [] for kind in _MEDIA_SELECTORS}
    for meta_path in sorted(output_dir.glob("*.meta.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for row in meta.get("media_scan") or []:
            basename = meta_path.name.removesuffix(".meta.json")
            post_id = row.get("post_id")
            label = f"{basename}#{post_id}" if post_id else basename
            for kind in row.get("kinds") or []:
                if kind in coverage and label not in coverage[kind]:
                    coverage[kind].append(label)
    return coverage


def _suggest_gap_fill_posts(output_dir: Path) -> list[tuple[str, str]]:
    """Pick one post per uncovered media kind from existing channel captures."""
    seen_kinds: set[str] = set()
    suggestions: list[tuple[str, str]] = []
    for meta_path in sorted(output_dir.glob("*_root.meta.json")):
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        for row in meta.get("media_scan") or []:
            kinds = row.get("kinds") or []
            channel = row.get("channel")
            post_id = row.get("post_id")
            if not channel or not post_id:
                continue
            for kind in kinds:
                if kind not in seen_kinds:
                    seen_kinds.add(kind)
                    suggestions.append((channel, str(post_id)))
    return suggestions


async def _run(args: argparse.Namespace) -> int:
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    proxies = _resolve_proxies()
    targets: list[tuple[str, str | None]] = []

    for channel in _parse_csv(args.channels):
        targets.append(
            (_channel_root_url(channel), f"{_normalize_channel(channel)}_root")
        )

    for channel, post_id in _parse_posts(args.posts):
        stem = f"{_normalize_channel(channel)}_{post_id}"
        targets.append((_post_url(channel, post_id), stem))

    for url in _parse_csv(args.urls):
        targets.append((url, _basename_for_url(url)))

    if args.gap_fill:
        for channel, post_id in _suggest_gap_fill_posts(output_dir):
            stem = f"{_normalize_channel(channel)}_{post_id}"
            post_path = output_dir / f"{stem}.html"
            if post_path.exists():
                continue
            targets.append((_post_url(channel, post_id), stem))

    if not targets:
        print(
            "Nothing to capture — pass --channels, --urls, and/or --posts",
            file=sys.stderr,
        )
        return 1

    results: list[dict[str, Any]] = []
    for url, basename in targets:
        print(f"Fetching {url} -> {basename}.html")
        result = await _fetch_and_save(
            url=url,
            output_dir=output_dir,
            basename=basename,
            proxies=proxies,
        )
        results.append(result)
        if result["status"] == "ok":
            print(f"  saved {result['path']}")
        else:
            print(f"  ERROR: {result.get('error')}", file=sys.stderr)

    ok = sum(1 for r in results if r["status"] == "ok")
    print(f"\nCaptured {ok}/{len(results)} targets in {output_dir}")

    coverage = _coverage_from_meta_files(output_dir)
    missing = [kind for kind, hits in coverage.items() if not hits]
    if missing:
        print(f"Missing media kinds in fixtures: {', '.join(missing)}")
    else:
        print("All tracked media kinds present in at least one fixture scan.")

    return 0 if ok else 1


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch Telegram web-view HTML and save investigation fixtures.",
    )
    parser.add_argument(
        "--channels",
        help="Comma-separated channel usernames (captures latest /s/ page)",
    )
    parser.add_argument(
        "--urls",
        help="Comma-separated full t.me/s URLs (channel, before=, or single-post)",
    )
    parser.add_argument(
        "--posts",
        help="Comma-separated channel/post_id pairs for single-post pages",
    )
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Directory for .html + .meta.json sidecars (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--gap-fill",
        action="store_true",
        help="After channel captures, fetch single-post pages for unseen media kinds",
    )
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args)))


if __name__ == "__main__":
    main()
