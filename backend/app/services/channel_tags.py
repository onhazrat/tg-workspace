"""Channel tag normalization helpers."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Literal, TypedDict

TagSource = Literal["manual", "ai"]
LEGACY_ASSIGNED_AT = 0


class ChannelTag(TypedDict):
    name: str
    source: TagSource
    assignedAt: int


def _normalize_name(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    return name or None


def _normalize_source(raw: Any) -> TagSource:
    return "ai" if raw == "ai" else "manual"


def _normalize_assigned_at(raw: Any) -> int:
    if isinstance(raw, (int, float)) and raw >= 0:
        return int(raw)
    return LEGACY_ASSIGNED_AT


def normalize_channel_tags(raw: Any) -> list[ChannelTag]:
    if not isinstance(raw, list):
        return []
    deduped: dict[str, ChannelTag] = {}
    for entry in raw:
        if isinstance(entry, str):
            name = _normalize_name(entry)
            if name is None:
                continue
            key = name.lower()
            if key in deduped:
                continue
            deduped[key] = {
                "name": name,
                "source": "manual",
                "assignedAt": LEGACY_ASSIGNED_AT,
            }
            continue
        if not isinstance(entry, dict):
            continue
        name = _normalize_name(entry.get("name"))
        if name is None:
            continue
        key = name.lower()
        if key in deduped:
            continue
        deduped[key] = {
            "name": name,
            "source": _normalize_source(entry.get("source")),
            "assignedAt": _normalize_assigned_at(entry.get("assignedAt")),
        }
    return list(deduped.values())


def get_tag_names(raw: Any) -> list[str]:
    return [tag["name"] for tag in normalize_channel_tags(raw)]


def reject_reserved_virtual_group_tags(raw: Any) -> None:
    from fastapi import HTTPException

    for tag in normalize_channel_tags(raw):
        if tag["name"].lower().startswith("group:"):
            raise HTTPException(
                status_code=400,
                detail="Tags starting with 'group:' are reserved for setting groups",
            )


def collect_all_channel_tags(channels: Iterable[dict[str, Any] | Any]) -> list[str]:
    names: set[str] = set()
    for channel in channels:
        tags = (
            channel.get("tags")
            if isinstance(channel, dict)
            else getattr(channel, "tags", [])
        )
        names.update(get_tag_names(tags))
    return sorted(names)
