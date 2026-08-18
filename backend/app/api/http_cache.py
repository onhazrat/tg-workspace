"""Conditional-request plumbing: ETags, and the `If-None-Match` comparison.

Two route families need this — cached images in `routes/telegram.py` and the
channel reads in `routes/data/channels.py` — and the comparison is the part
worth having in one place. It is four lines with two easy mistakes in them (a
multi-valued header, and a proxy that weakened the validator in transit), which
is exactly the shape of thing that gets fixed in one copy and not the other.

The two callers differ in freshness policy, deliberately, and that difference
stays at the call site:

* images get `max-age`, because an avatar that changed a minute ago is not worth
  a round trip; and
* the channel reads get `no-cache`, which still revalidates every time but takes
  a bodiless 304 when nothing changed. The list is 494 KB gzipped and
  `refetchOnWindowFocus` asks for it on every focus, so the saving is the body,
  not the request.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import Request, Response
from fastapi.encoders import jsonable_encoder


def etag_for(content: bytes) -> str:
    """A strong validator over the exact bytes being served."""
    return f'"{hashlib.sha256(content).hexdigest()[:32]}"'


def matches_if_none_match(request: Request, etag: str) -> bool:
    """Whether the client already holds this exact representation.

    `If-None-Match` may carry several validators, and a proxy may have made ours
    weak (`W/"..."`) in transit — so compare per entry, with the prefix stripped.
    """
    provided = request.headers.get("if-none-match", "")
    return any(tag.strip().removeprefix("W/") == etag for tag in provided.split(","))


def json_response_with_etag(
    request: Request,
    payload: Any,
    *,
    cache_control: str = "private, no-cache",
) -> Response:
    """Serialise `payload` once, and return either it or a bodiless 304.

    Hashes the response body rather than a stored resource version. A version
    column would be cheaper, but `tg_sync_meta`'s `channels` etag does not move
    when a *setting group* changes — and the channel payload merges that group's
    inherited fields in. Hashing what is actually being sent cannot go stale that
    way; the cost is that the body is still built, which is fine here because the
    bottleneck being addressed is transfer, not compute.

    `private` because these routes are authenticated: no shared cache may hold a
    response and hand it to a different operator.
    """
    body = json.dumps(jsonable_encoder(payload), separators=(",", ":")).encode()
    etag = etag_for(body)
    headers = {"ETag": etag, "Cache-Control": cache_control}

    if matches_if_none_match(request, etag):
        return Response(status_code=304, headers=headers)

    return Response(content=body, media_type="application/json", headers=headers)
